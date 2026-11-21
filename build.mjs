import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_DIR = path.join(__dirname, 'dist-plugin');
const ROOT_DIST_DIR = path.join(__dirname, 'dist');
const ROOT_SCRIPTS_DIR = path.join(__dirname, 'scripts');
const ROOT_RUNTIME_FILES = [
  'plugin.json',
  'mcp_config.json',
  'hooks.json',
  'README.md',
  'README.zh-CN.md',
  'LICENSE',
];
const DEPLOY_TARGET = path.join(
  os.homedir(),
  '.gemini',
  'config',
  'plugins',
  'cache-pulse',
);

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function build() {
  fs.mkdirSync(ROOT_DIST_DIR, { recursive: true });
  fs.mkdirSync(ROOT_SCRIPTS_DIR, { recursive: true });

  // 1. Bundle MCP server (Node CJS -> ./dist/server.cjs)
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'src', 'server', 'index.ts')],
    outfile: path.join(ROOT_DIST_DIR, 'server.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    sourcemap: false,
    minify: false,
  });

  // 2. Bundle Lifecycle Hook runner (Node CJS -> ./scripts/hook-capture.cjs)
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'src', 'hook', 'capture.ts')],
    outfile: path.join(ROOT_SCRIPTS_DIR, 'hook-capture.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    sourcemap: false,
    minify: false,
  });

  // 3. Bundle UI script & inline CSS + JS into single self-contained ./dist/app.html
  const uiJsResult = await esbuild.build({
    entryPoints: [path.join(__dirname, 'src', 'ui', 'app.ts')],
    bundle: true,
    write: false,
    platform: 'browser',
    target: 'es2022',
    format: 'iife',
    minify: true,
  });

  const bundledJs = uiJsResult.outputFiles[0]?.text;
  if (!bundledJs) {
    throw new Error('Failed to bundle UI JavaScript');
  }

  const rawHtml = fs.readFileSync(
    path.join(__dirname, 'src', 'ui', 'index.html'),
    'utf8',
  );
  const rawCss = fs.readFileSync(
    path.join(__dirname, 'src', 'ui', 'styles.css'),
    'utf8',
  );

  // Escape closing style/script tags if any ever occur in bundled code
  const safeCss = rawCss.replace(/<\/style>/gi, '<\\/style>');
  const safeJs = bundledJs.replace(/<\/script>/gi, '<\\/script>');

  const finalHtml = rawHtml
    .replace('/* __INLINE_CSS__ */', () => safeCss)
    .replace('/* __INLINE_JS__ */', () => safeJs);

  if (
    finalHtml.includes('/* __INLINE_CSS__ */') ||
    finalHtml.includes('/* __INLINE_JS__ */')
  ) {
    throw new Error('Failed to inline CSS or JS into app.html');
  }

  const rootHtmlPath = path.join(ROOT_DIST_DIR, 'app.html');
  fs.writeFileSync(rootHtmlPath, finalHtml, 'utf8');

  // 4. Assemble clean runtime staging directory in ./dist-plugin for local deploy
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const fileName of ROOT_RUNTIME_FILES) {
    const srcPath = path.join(__dirname, fileName);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, path.join(OUT_DIR, fileName));
    }
  }
  for (const dirName of ['assets', 'dist', 'scripts']) {
    const srcDir = path.join(__dirname, dirName);
    if (fs.existsSync(srcDir)) {
      copyDirRecursive(srcDir, path.join(OUT_DIR, dirName));
    }
  }

  const htmlBytes = Buffer.byteLength(finalHtml, 'utf8');
  console.log(
    `[cache-pulse] Built plugin root artifacts & staging bundle in ${OUT_DIR} (app.html ${(htmlBytes / 1024).toFixed(1)} KiB)`,
  );

  if (process.argv.includes('--deploy')) {
    copyDirRecursive(OUT_DIR, DEPLOY_TARGET);
    console.log(`[cache-pulse] Deployed plugin to ${DEPLOY_TARGET}`);
  }
}

build().catch((err) => {
  console.error('[cache-pulse] Build failed:', err);
  process.exit(1);
});
