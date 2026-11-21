import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_PLUGIN_DIR = path.join(ROOT_DIR, 'dist-plugin');

// Compile TypeScript shared modules to temp ESM once so node:test runs directly against src/.
const tmpTestBundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-mod-'));
const parserOut = path.join(tmpTestBundleDir, 'parser.mjs');
const aggregatorOut = path.join(tmpTestBundleDir, 'aggregator.mjs');
const storeOut = path.join(tmpTestBundleDir, 'store.mjs');
const i18nOut = path.join(tmpTestBundleDir, 'i18n.mjs');

esbuild.buildSync({
  entryPoints: [path.join(ROOT_DIR, 'src', 'shared', 'parser.ts')],
  outfile: parserOut,
  bundle: true,
  platform: 'node',
  format: 'esm',
});

esbuild.buildSync({
  entryPoints: [path.join(ROOT_DIR, 'src', 'shared', 'aggregator.ts')],
  outfile: aggregatorOut,
  bundle: true,
  platform: 'node',
  format: 'esm',
});

esbuild.buildSync({
  entryPoints: [path.join(ROOT_DIR, 'src', 'shared', 'store.ts')],
  outfile: storeOut,
  bundle: true,
  platform: 'node',
  format: 'esm',
});

esbuild.buildSync({
  entryPoints: [path.join(ROOT_DIR, 'src', 'ui', 'i18n.ts')],
  outfile: i18nOut,
  bundle: true,
  platform: 'node',
  format: 'esm',
});

const parser = await import(pathToFileURL(parserOut).href);
const aggregator = await import(pathToFileURL(aggregatorOut).href);
const storeMod = await import(pathToFileURL(storeOut).href);
const i18nMod = await import(pathToFileURL(i18nOut).href);

test.after(() => {
  fs.rmSync(tmpTestBundleDir, { recursive: true, force: true });
});

test('formatTokens, formatPercent, formatSpeed edge cases', () => {
  assert.equal(parser.formatTokens(0), '0');
  assert.equal(parser.formatTokens(-5), '0');
  assert.equal(parser.formatTokens(999), '999');
  assert.equal(parser.formatTokens(1000), '1.0k');
  assert.equal(parser.formatTokens(331100), '331.1k');
  assert.equal(parser.formatTokens(999950), '1.0M');
  assert.equal(parser.formatTokens(41900000), '41.9M');

  assert.equal(parser.formatPercent(null), '--');
  assert.equal(parser.formatPercent(0.998), '99.8%');
  assert.equal(parser.formatPercent(0.956), '95.6%');
  assert.equal(parser.formatPercent(1.2), '100.0%');

  assert.equal(parser.formatSpeed(null), '--');
  assert.equal(parser.formatSpeed(0), '--');
  assert.equal(parser.formatSpeed(102.04), '102.0');
});

test('deriveProjectName handles Windows, POSIX, trailing slashes, and file URIs', () => {
  assert.equal(
    parser.deriveProjectName('C:\\Users\\dev\\workspace\\SampleApp\\'),
    'SampleApp',
  );
  assert.equal(parser.deriveProjectName('/home/user/projects/demo/'), 'demo');
  assert.equal(
    parser.deriveProjectName('file:///C:/Users/dev/My%20Project/'),
    'My Project',
  );
  assert.equal(parser.deriveProjectName(''), null);
});

test('parseTranscriptLines ignores blank and malformed lines', () => {
  const raw = [
    '{"step_index": 0, "type": "USER_INPUT", "created_at": "2026-11-21T01:00:00Z"}',
    '',
    '{"step_index": 1, "type": "PLANNER_RESPONSE", "input_tokens": 1000, "cache_read_tokens": 9000, "output_tokens": 200, "model": "gemini-4-neon-high", "created_at": "2026-11-21T01:00:01Z"}',
    '{"step_index": 2, "type": "GENERIC", "truncated_partial_write',
  ].join('\n');

  const steps = parser.parseTranscriptLines(raw);
  assert.equal(steps.length, 2);
  assert.equal(steps[1].input_tokens, 1000);
  assert.equal(steps[1].cache_read_tokens, 9000);
  assert.equal(steps[1].output_tokens, 200);
});

test('computeSessionMetrics calculates cache rates, totals, speed sources, and turn capping', () => {
  const steps = [];
  // Build 85 turns (170 steps total)
  let tMs = Date.parse('2026-11-21T01:00:00Z');
  for (let idx = 0; idx < 85; idx++) {
    const stepIdx = idx * 2;
    const isLast = idx === 84;
    const input = isLast ? 200 : 1000;
    const cacheRead = isLast ? 99800 : 9000;
    const out = 100;
    steps.push({
      step_index: stepIdx,
      type: 'PLANNER_RESPONSE',
      model: 'gemini-4-neon-high',
      input_tokens: input,
      cache_read_tokens: cacheRead,
      output_tokens: out,
      created_at: new Date(tMs).toISOString(),
    });
    steps.push({
      step_index: stepIdx + 1,
      type: 'GENERIC',
      created_at: new Date(tMs + 2000).toISOString(),
    });
    tMs += 5000;
  }

  const hookState = {
    conversationId: 'conv-123',
    workspacePaths: ['C:\\repo\\SampleApp'],
    updatedAt: tMs,
    timings: {
      // Normal hook timing (1000ms) -> should be used as 'hook'
      '0': { stepIndex: 0, durationMs: 1000, outputTokens: 100, recordedAt: tMs },
      // Tool-wait polluted hook timing (10000ms vs 2000ms transcript delta) -> should fall back to transcript 2000ms
      '2': { stepIndex: 2, durationMs: 10000, outputTokens: 100, recordedAt: tMs },
      // Sub-200ms invalid hook timing -> should fall back to transcript 2000ms
      '4': { stepIndex: 4, durationMs: 50, outputTokens: 100, recordedAt: tMs },
    },
  };

  const metrics = parser.computeSessionMetrics({
    conversationId: 'conv-123',
    steps,
    hookState,
    now: tMs + 1000,
  });

  assert.equal(metrics.projectName, 'SampleApp');
  assert.equal(metrics.stepCount, 85);
  assert.equal(metrics.turns.length, 80); // Capped for UI payload safety
  assert.equal(metrics.turns[0].stepIndex, 10); // First 5 turns trimmed from turns list

  // Totals must include ALL 85 turns: 84 * 1000 + 200 = 84,200 uncached; 84 * 9000 + 99800 = 855,800 cached
  assert.equal(metrics.cumulativeUncachedInputTokens, 84200);
  assert.equal(metrics.cumulativeCacheReadTokens, 855800);
  assert.equal(metrics.cumulativeInputTokens, 940000);
  assert.equal(metrics.cumulativeOutputTokens, 8500);
  assert.ok(Math.abs(metrics.recentCacheHitRate - 0.998) < 1e-6);
  assert.ok(
    Math.abs(metrics.sessionCacheHitRate - 855800 / 940000) < 1e-6,
  );
  assert.equal(metrics.speedSource, 'hook');
  assert.equal(metrics.timedStepCount, 85);

  // Verify tool-wait guard directly on small synthetic slice
  const smallMetrics = parser.computeSessionMetrics({
    conversationId: 'conv-small',
    steps: steps.slice(0, 6),
    hookState,
    now: tMs + 1000,
  });
  assert.equal(smallMetrics.turns[0].speedSource, 'hook');
  assert.equal(smallMetrics.turns[0].durationMs, 1000);
  assert.equal(smallMetrics.turns[1].speedSource, 'transcript');
  assert.equal(smallMetrics.turns[1].durationMs, 2000);
  assert.equal(smallMetrics.turns[2].speedSource, 'transcript');
  assert.equal(smallMetrics.turns[2].durationMs, 2000);
});

test('computeSessionMetrics handles zero-input steps safely', () => {
  const metrics = parser.computeSessionMetrics({
    conversationId: 'abcd1234-ef56',
    steps: [
      {
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        input_tokens: 0,
        cache_read_tokens: 0,
        output_tokens: 0,
      },
    ],
    now: Date.now(),
  });
  assert.equal(metrics.projectName, '会话 abcd1234');
  assert.equal(metrics.recentCacheHitRate, null);
  assert.equal(metrics.sessionCacheHitRate, null);
  assert.equal(metrics.avgTokensPerSec, null);
  assert.equal(metrics.speedSource, 'none');
});

test('Hook script captures session metadata and timing via cmd /c without failing', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-hook-'));
  const dataDir = path.join(tmpRoot, 'plugin_data');
  const brainDir = path.join(tmpRoot, 'brain');
  const convId = '11111111-2222-3333-4444-555555555555';
  const transcriptPath = path.join(
    brainDir,
    convId,
    '.system_generated',
    'logs',
    'transcript.jsonl',
  );
  fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
  fs.writeFileSync(
    transcriptPath,
    JSON.stringify({
      step_index: 0,
      type: 'USER_INPUT',
      created_at: '2026-11-21T02:00:00Z',
    }) + '\n',
    'utf8',
  );

  const runHook = (payload) => {
    const isWin = process.platform === 'win32';
    const res = isWin
      ? spawnSync('cmd', ['/c', 'node ./scripts/hook-capture.cjs'], {
          cwd: DIST_PLUGIN_DIR,
          input: JSON.stringify(payload),
          env: {
            ...process.env,
            PLUGIN_DATA: dataDir,
            CACHE_PULSE_BRAIN_DIR: brainDir,
          },
          encoding: 'utf8',
        })
      : spawnSync('node', ['./scripts/hook-capture.cjs'], {
          cwd: DIST_PLUGIN_DIR,
          input: JSON.stringify(payload),
          env: {
            ...process.env,
            PLUGIN_DATA: dataDir,
            CACHE_PULSE_BRAIN_DIR: brainDir,
          },
          encoding: 'utf8',
        });
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), '{}');
  };

  try {
    runHook({
      hookEventName: 'SessionStart',
      conversationId: convId,
      workspacePaths: ['C:\\Users\\dev\\Projects\\AlphaApp'],
      transcriptPath,
      modelName: 'gemini-4-neon-high',
    });

    runHook({
      hookEventName: 'PreInvocation',
      conversationId: convId,
      workspacePaths: ['C:\\Users\\dev\\Projects\\AlphaApp'],
      transcriptPath,
      invocationNum: 1,
      initialNumSteps: 1,
    });

    // Wait 260ms so hook duration crosses 200ms threshold
    await new Promise((r) => setTimeout(r, 260));

    fs.appendFileSync(
      transcriptPath,
      JSON.stringify({
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        model: 'gemini-4-neon-high',
        input_tokens: 500,
        cache_read_tokens: 9500,
        output_tokens: 150,
        created_at: '2026-11-21T02:00:01Z',
      }) + '\n',
      'utf8',
    );

    runHook({
      hookEventName: 'PostInvocation',
      conversationId: convId,
      transcriptPath,
      invocationNum: 1,
      initialNumSteps: 1,
    });

    // Non-session folder in brain must be ignored by store
    fs.mkdirSync(path.join(brainDir, 'tempmediaStorage'), { recursive: true });

    const store = new storeMod.TelemetryStore({ dataDir, brainDir });
    const payload = store.getMonitorPayload({ autoFollow: true });
    assert.equal(payload.sessions.length, 1);
    assert.ok(payload.activeSession);
    assert.equal(payload.activeSession.projectName, 'AlphaApp');
    assert.equal(payload.activeSession.stepCount, 1);
    assert.equal(payload.activeSession.speedSource, 'hook');
    assert.ok(payload.activeSession.avgTokensPerSec > 0);
    assert.ok(Math.abs(payload.activeSession.recentCacheHitRate - 0.95) < 1e-6);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('MCP Server stdio integration and self-contained app.html checks', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-mcp-'));
  const dataDir = path.join(tmpRoot, 'plugin_data');
  const brainDir = path.join(tmpRoot, 'brain');
  const convId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const transcriptPath = path.join(
    brainDir,
    convId,
    '.system_generated',
    'logs',
    'transcript.jsonl',
  );
  fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({
        step_index: 0,
        type: 'USER_INPUT',
        created_at: '2026-11-21T02:00:00Z',
      }),
      JSON.stringify({
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        model: 'gemini-4-neon-high',
        input_tokens: 200,
        cache_read_tokens: 99800,
        output_tokens: 400,
        created_at: '2026-11-21T02:00:02Z',
      }),
      JSON.stringify({
        step_index: 2,
        type: 'GENERIC',
        created_at: '2026-11-21T02:00:06Z',
      }),
    ].join('\n') + '\n',
    'utf8',
  );

  const serverPath = path.join(DIST_PLUGIN_DIR, 'dist', 'server.cjs');
  const child = spawn('node', [serverPath, '--data-dir', dataDir], {
    env: {
      ...process.env,
      CACHE_PULSE_BRAIN_DIR: brainDir,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdoutBuf = '';
  const pending = new Map();
  let stderrText = '';

  child.stderr.on('data', (chunk) => {
    stderrText += chunk.toString('utf8');
  });

  child.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString('utf8');
    let nlIdx;
    while ((nlIdx = stdoutBuf.indexOf('\n')) !== -1) {
      const line = stdoutBuf.slice(0, nlIdx).replace(/\r$/, '');
      stdoutBuf = stdoutBuf.slice(nlIdx + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) {
          reject(new Error(JSON.stringify(msg.error)));
        } else {
          resolve(msg.result);
        }
      }
    }
  });

  let nextId = 1;
  const rpc = (method, params = {}) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(
        JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n',
      );
    });
  };
  const notify = (method, params = {}) => {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  };

  try {
    const initRes = await rpc('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {
        extensions: {
          'io.modelcontextprotocol/ui': {
            mimeTypes: ['text/html;profile=mcp-app'],
          },
        },
      },
      clientInfo: { name: 'test-client', version: '1.0.0' },
    });
    assert.equal(initRes.serverInfo.name, 'cache-pulse');
    assert.ok(initRes.capabilities.resources);
    assert.ok(initRes.capabilities.tools);

    notify('notifications/initialized');

    const toolsRes = await rpc('tools/list');
    const openTool = toolsRes.tools.find((t) => t.name === 'open_monitor');
    const getMetricsTool = toolsRes.tools.find((t) => t.name === 'get_metrics');
    const getWindowSummaryTool = toolsRes.tools.find(
      (t) => t.name === 'get_window_summary',
    );
    assert.ok(openTool);
    assert.ok(getMetricsTool);
    assert.ok(getWindowSummaryTool);
    assert.equal(openTool._meta?.ui?.resourceUri, 'ui://cache-pulse/app.html');
    assert.deepEqual(openTool._meta?.['com.google.antigravity/ui']?.entrypoints, [
      { type: 'aux_pane', title: 'Cache Pulse' },
      { type: 'global', title: 'Cache Pulse' },
    ]);
    assert.deepEqual(getMetricsTool._meta?.ui?.visibility, ['app']);
    assert.deepEqual(getWindowSummaryTool._meta?.ui?.visibility, ['app']);

    const resourcesRes = await rpc('resources/list');
    assert.ok(
      resourcesRes.resources.some((r) => r.uri === 'ui://cache-pulse/app.html'),
    );

    const readRes = await rpc('resources/read', {
      uri: 'ui://cache-pulse/app.html',
    });
    assert.equal(readRes.contents.length, 1);
    const htmlItem = readRes.contents[0];
    assert.equal(htmlItem.mimeType, 'text/html;profile=mcp-app');
    assert.ok(htmlItem.text.length > 1000);
    assert.ok(Buffer.byteLength(htmlItem.text, 'utf8') < 10 * 1024 * 1024);
    assert.doesNotMatch(htmlItem.text, /<script[^>]+src=/i);
    assert.doesNotMatch(htmlItem.text, /<link[^>]+href=["']https?:/i);
    for (const token of [
      'btn-view-summary',
      'sum-donut-svg',
      'sum-timeline-svg',
      'sum-scatter-svg',
      'sum-sessions-tbody',
      'sum-model-pills',
      'btn-donut-model',
      'btn-tl-model',
      'session-model-pills',
      'session-models-card',
      'btn-lang',
      'Avg Task Speed',
      'Overview',
      'All Models',
    ]) {
      assert.ok(htmlItem.text.includes(token), `Expected app.html to include ${token}`);
    }

    const openCall = await rpc('tools/call', {
      name: 'open_monitor',
      arguments: {},
    });
    assert.ok(openCall.content?.[0]?.text.includes('99.8%'));
    assert.equal(openCall.structuredContent?.activeSession?.conversationId, convId);
    assert.equal(openCall.structuredContent?.activeSession?.avgTokensPerSec, 100);

    const pollCall = await rpc('tools/call', {
      name: 'get_metrics',
      arguments: { autoFollow: true },
    });
    assert.equal(pollCall.structuredContent?.sessions?.length, 1);

    const exactMetricCall = await rpc('tools/call', {
      name: 'get_metrics',
      arguments: {
        autoFollow: true,
        model: 'gemini-4-neon-high',
        modelGrouping: 'exact',
      },
    });
    assert.equal(exactMetricCall.structuredContent?.activeSession?.selectedModel, 'gemini-4-neon-high');
    assert.equal(exactMetricCall.structuredContent?.activeSession?.modelGrouping, 'exact');
    assert.equal(exactMetricCall.structuredContent?.activeSession?.stepCount, 1);

    for (const win of ['5h', '1d', '7d']) {
      const winCall = await rpc('tools/call', {
        name: 'get_window_summary',
        arguments: { window: win },
      });
      assert.equal(winCall.structuredContent?.view, 'summary');
      assert.equal(winCall.structuredContent?.window, win);
      assert.ok(Array.isArray(winCall.structuredContent?.timeline));
      assert.ok(Array.isArray(winCall.structuredContent?.comparisons));
      assert.ok(Array.isArray(winCall.structuredContent?.allModels));
    }

    const filteredWinCall = await rpc('tools/call', {
      name: 'get_window_summary',
      arguments: {
        window: '7d',
        model: 'gemini-4-neon',
        modelGrouping: 'family',
      },
    });
    assert.equal(filteredWinCall.structuredContent?.selectedModel, 'gemini-4-neon');
    assert.equal(filteredWinCall.structuredContent?.modelGrouping, 'family');
    assert.equal(filteredWinCall.structuredContent?.sessionCount, 1);

    const openSummaryCall = await rpc('tools/call', {
      name: 'open_monitor',
      arguments: { window: '7d' },
    });
    assert.equal(openSummaryCall.structuredContent?.view, 'summary');
    assert.equal(openSummaryCall.structuredContent?.window, '7d');
    assert.ok(openSummaryCall.content?.[0]?.text.includes('近 7 天'));
    assert.ok(openSummaryCall.content?.[0]?.text.includes('分模型:'));

    assert.equal(stderrText, '');
  } finally {
    child.stdin.end();
    child.kill();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('computeWindowSummary handles carry-over full-session inclusion, bucket sums, and model/project rollups', () => {
  const now = Date.parse('2026-11-21T12:00:00.000Z');
  const hourMs = 3600 * 1000;
  const dayMs = 24 * hourMs;

  // Session A: started 3 days ago, triggered again 1h ago -> entire session MUST be included in 5h, 1d, 7d!
  const analysisA = parser.analyzeSession({
    conversationId: 'sess-carryover-a',
    now,
    hookState: {
      conversationId: 'sess-carryover-a',
      workspacePaths: ['C:\\repo\\ProjAlpha'],
      updatedAt: now - 1 * hourMs,
      timings: {
        '2': { stepIndex: 2, durationMs: 2000, outputTokens: 400, recordedAt: now - 1 * hourMs },
      },
    },
    steps: [
      {
        step_index: 0,
        type: 'PLANNER_RESPONSE',
        model: 'gemini-pro-orchestrator',
        input_tokens: 1000,
        cache_read_tokens: 3000,
        output_tokens: 200,
        created_at: new Date(now - 3 * dayMs).toISOString(),
      },
      {
        step_index: 1,
        type: 'GENERIC',
        created_at: new Date(now - 3 * dayMs + 2000).toISOString(),
      },
      {
        step_index: 2,
        type: 'PLANNER_RESPONSE',
        model: 'gemini-flash-worker',
        input_tokens: 500,
        cache_read_tokens: 9500,
        output_tokens: 400,
        created_at: new Date(now - 1 * hourMs).toISOString(),
      },
    ],
  });

  // Session B: 12h ago (inside 1d and 7d, outside 5h)
  const analysisB = parser.analyzeSession({
    conversationId: 'sess-1d-b',
    now,
    hookState: {
      conversationId: 'sess-1d-b',
      workspacePaths: ['C:\\repo\\ProjBeta'],
      updatedAt: now - 12 * hourMs,
      timings: {},
    },
    steps: [
      {
        step_index: 0,
        type: 'PLANNER_RESPONSE',
        model: 'gemini-pro-orchestrator',
        input_tokens: 2000,
        cache_read_tokens: 8000,
        output_tokens: 300,
        created_at: new Date(now - 12 * hourMs).toISOString(),
      },
      {
        step_index: 1,
        type: 'GENERIC',
        created_at: new Date(now - 12 * hourMs + 3000).toISOString(),
      },
    ],
  });

  // Session C: 9 days ago (outside 7d)
  const analysisC = parser.analyzeSession({
    conversationId: 'sess-old-c',
    now,
    steps: [
      {
        step_index: 0,
        type: 'PLANNER_RESPONSE',
        model: 'gemini-pro-orchestrator',
        input_tokens: 5000,
        cache_read_tokens: 5000,
        output_tokens: 100,
        created_at: new Date(now - 9 * dayMs).toISOString(),
      },
    ],
  });

  // Session D: zero-step session inside 5h (excluded)
  const analysisD = parser.analyzeSession({
    conversationId: 'sess-empty-d',
    now,
    hookState: {
      conversationId: 'sess-empty-d',
      workspacePaths: ['C:\\repo\\Empty'],
      updatedAt: now - 10_000,
      timings: {},
    },
    steps: [
      {
        step_index: 0,
        type: 'USER_INPUT',
        created_at: new Date(now - 10_000).toISOString(),
      },
    ],
  });

  const analyses = [analysisA, analysisB, analysisC, analysisD];
  const sum5h = aggregator.computeWindowSummary({ window: '5h', analyses, now });

  assert.equal(sum5h.sessionCount, 1);
  assert.equal(sum5h.stepCount, 2);
  // Carry-over step 0 + recent step 2
  assert.equal(sum5h.totalUncachedInputTokens, 1500);
  assert.equal(sum5h.totalCacheReadTokens, 12500);
  assert.equal(sum5h.totalInputTokens, 14000);
  assert.equal(sum5h.totalOutputTokens, 600);
  assert.equal(sum5h.totalTokens, 14600);
  assert.ok(Math.abs(sum5h.overallCacheHitRate - 12500 / 14000) < 1e-6);
  // Speed: (200 + 400) / ((2000 + 2000) / 1000) = 600 / 4 = 150 tok/s
  assert.ok(Math.abs(sum5h.avgTokensPerSec - 150) < 1e-6);

  // Verify carry-over timeline bucket preserves exact token totals invariant
  assert.equal(sum5h.timeline[0].isCarryOver, true);
  assert.equal(sum5h.timeline[0].label, '更早延续');
  assert.equal(sum5h.timeline[0].totalTokens, 4200);
  const bucketTokenSum = sum5h.timeline.reduce((acc, b) => acc + b.totalTokens, 0);
  assert.equal(bucketTokenSum, sum5h.totalTokens);

  // Multi-model per-turn rollup in 5h
  assert.equal(sum5h.models.length, 2);
  assert.equal(sum5h.models[0].model, 'gemini-flash-worker');
  assert.equal(sum5h.models[0].totalTokens, 10400);
  assert.equal(sum5h.models[1].model, 'gemini-pro-orchestrator');
  assert.equal(sum5h.models[1].totalTokens, 4200);

  // Comparisons monotonicity: 5h <= 1d <= 7d
  const cmp5 = sum5h.comparisons.find((c) => c.window === '5h');
  const cmp1d = sum5h.comparisons.find((c) => c.window === '1d');
  const cmp7d = sum5h.comparisons.find((c) => c.window === '7d');
  assert.equal(cmp5.sessionCount, 1);
  assert.equal(cmp1d.sessionCount, 2);
  assert.equal(cmp7d.sessionCount, 2);
  assert.ok(cmp5.totalTokens <= cmp1d.totalTokens);
  assert.ok(cmp1d.totalTokens <= cmp7d.totalTokens);
  assert.equal(cmp1d.totalTokens, 14600 + 10300);

  const sum1d = aggregator.computeWindowSummary({ window: '1d', analyses, now });
  assert.equal(sum1d.projects.length, 2);
  assert.equal(sum1d.projects[0].projectName, 'ProjAlpha');
  assert.equal(sum1d.projects[1].projectName, 'ProjBeta');
});

test('TelemetryStore.getWindowSummary scans >20 sessions without truncation and invalidates cache on file updates', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-store-win-'));
  const dataDir = path.join(tmpRoot, 'plugin_data');
  const brainDir = path.join(tmpRoot, 'brain');
  const now = Date.parse('2026-11-21T12:00:00.000Z');

  try {
    for (let i = 0; i < 25; i++) {
      const convId = `sess-${String(i).padStart(2, '0')}`;
      const tp = path.join(
        brainDir,
        convId,
        '.system_generated',
        'logs',
        'transcript.jsonl',
      );
      fs.mkdirSync(path.dirname(tp), { recursive: true });
      const ts = new Date(now - (i + 1) * 60_000).toISOString();
      const tsNext = new Date(now - (i + 1) * 60_000 + 2000).toISOString();
      fs.writeFileSync(
        tp,
        [
          JSON.stringify({
            step_index: 0,
            type: 'PLANNER_RESPONSE',
            model: 'gemini-4-neon-xhigh',
            input_tokens: 100,
            cache_read_tokens: 900,
            output_tokens: 50,
            created_at: ts,
          }),
          JSON.stringify({
            step_index: 1,
            type: 'GENERIC',
            created_at: tsNext,
          }),
        ].join('\n') + '\n',
        'utf8',
      );
    }

    const store = new storeMod.TelemetryStore({ dataDir, brainDir });
    const summary1 = store.getWindowSummary({ window: '5h', now });
    assert.equal(summary1.sessionCount, 25);
    assert.equal(summary1.totalTokens, 25 * 1050);

    // Mutate session 0 and verify cache invalidation picks up the new turn
    const targetTp = path.join(
      brainDir,
      'sess-00',
      '.system_generated',
      'logs',
      'transcript.jsonl',
    );
    fs.appendFileSync(
      targetTp,
      JSON.stringify({
        step_index: 2,
        type: 'PLANNER_RESPONSE',
        model: 'gemini-4-neon-xhigh',
        input_tokens: 200,
        cache_read_tokens: 800,
        output_tokens: 100,
        created_at: new Date(now - 5_000).toISOString(),
      }) + '\n',
      'utf8',
    );

    const summary2 = store.getWindowSummary({ window: '5h', now });
    assert.equal(summary2.sessionCount, 25);
    assert.equal(summary2.stepCount, 26);
    assert.equal(summary2.totalTokens, 25 * 1050 + 1100);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('parseAnnotationTitle and extractFallbackSessionTitle handle UTF-8, escapes, tags, and truncation', () => {
  assert.equal(
    parser.parseAnnotationTitle(
      'title:"Antigravity 插件开发实现状态栏显示" last_user_view_time:{seconds:123}',
    ),
    'Antigravity 插件开发实现状态栏显示',
  );
  assert.equal(
    parser.parseAnnotationTitle(
      'title:"Fix \\"quoted\\" \\346\\217\\222\\344\\273\\266 bug"',
    ),
    'Fix "quoted" 插件 bug',
  );
  assert.equal(parser.parseAnnotationTitle('last_user_view_time:{seconds:1}'), null);

  assert.equal(
    parser.extractFallbackSessionTitle([
      {
        step_index: 0,
        type: 'USER_INPUT',
        content: '<USER_REQUEST>\n  修复缓存命中率计算问题  \n</USER_REQUEST>',
      },
    ]),
    '修复缓存命中率计算问题',
  );

  assert.equal(
    parser.extractFallbackSessionTitle(
      [
        {
          step_index: 0,
          type: 'USER_INPUT',
          content: '<USER_REQUEST>12345678901234567890</USER_REQUEST>',
        },
      ],
      10,
    ),
    '1234567890…',
  );

  assert.equal(
    parser.extractFallbackSessionTitle([
      { step_index: 0, type: 'PLANNER_RESPONSE', input_tokens: 10 },
    ]),
    null,
  );
});

test('TelemetryStore distinguishes same-project sessions via annotation and fallback sessionTitle', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-title-'));
  const dataDir = path.join(tmpRoot, 'plugin_data');
  const brainDir = path.join(tmpRoot, 'brain');
  const annotationsDir = path.join(tmpRoot, 'annotations');
  const now = Date.parse('2026-11-21T12:00:00.000Z');

  try {
    const s1 = '11111111-1111-1111-1111-111111111111';
    const s2 = '22222222-2222-2222-2222-222222222222';
    fs.mkdirSync(path.join(dataDir, 'sessions'), { recursive: true });
    fs.mkdirSync(annotationsDir, { recursive: true });

    for (const [id, offsetMs, userText] of [
      [s1, 60_000, '<USER_REQUEST>Initial prompt one</USER_REQUEST>'],
      [s2, 30_000, '<USER_REQUEST>Investigate cache miss spike across turns</USER_REQUEST>'],
    ]) {
      const tp = path.join(brainDir, id, '.system_generated', 'logs', 'transcript.jsonl');
      fs.mkdirSync(path.dirname(tp), { recursive: true });
      fs.writeFileSync(
        tp,
        [
          JSON.stringify({
            step_index: 0,
            type: 'USER_INPUT',
            content: userText,
            created_at: new Date(now - offsetMs - 5000).toISOString(),
          }),
          JSON.stringify({
            step_index: 1,
            type: 'PLANNER_RESPONSE',
            model: 'gemini-4-neon-xhigh',
            input_tokens: 100,
            cache_read_tokens: 900,
            output_tokens: 50,
            created_at: new Date(now - offsetMs).toISOString(),
          }),
        ].join('\n') + '\n',
        'utf8',
      );
      fs.writeFileSync(
        path.join(dataDir, 'sessions', `${id}.json`),
        JSON.stringify({
          conversationId: id,
          workspacePaths: ['C:\\repo\\SameProj'],
          updatedAt: now - offsetMs,
          timings: {},
        }),
        'utf8',
      );
    }

    const annPath = path.join(annotationsDir, `${s1}.pbtxt`);
    fs.writeFileSync(annPath, 'title:"Task Alpha" last_user_view_time:{seconds:1}', 'utf8');

    const store = new storeMod.TelemetryStore({ dataDir, brainDir });
    const monitor = store.getMonitorPayload({ now });
    assert.equal(monitor.sessions.length, 2);
    const mon1 = monitor.sessions.find((x) => x.conversationId === s1);
    const mon2 = monitor.sessions.find((x) => x.conversationId === s2);
    assert.equal(mon1.projectName, 'SameProj');
    assert.equal(mon2.projectName, 'SameProj');
    assert.equal(mon1.sessionTitle, 'Task Alpha');
    assert.equal(mon2.sessionTitle, 'Investigate cache miss spike…');

    const summary1 = store.getWindowSummary({ window: '5h', now });
    assert.equal(summary1.projectCount, 1);
    assert.equal(summary1.projects[0].projectName, 'SameProj');
    assert.equal(summary1.projects[0].sessionCount, 2);
    const ws1 = summary1.sessions.find((x) => x.conversationId === s1);
    const ws2 = summary1.sessions.find((x) => x.conversationId === s2);
    assert.equal(ws1.sessionTitle, 'Task Alpha');
    assert.equal(ws2.sessionTitle, 'Investigate cache miss spike…');

    // Update annotation title and verify cache invalidation updates sessionTitle
    fs.writeFileSync(
      annPath,
      'title:"Task Alpha Renamed" last_user_view_time:{seconds:2}',
      'utf8',
    );
    const summary2 = store.getWindowSummary({ window: '5h', now });
    const ws1Updated = summary2.sessions.find((x) => x.conversationId === s1);
    assert.equal(ws1Updated.sessionTitle, 'Task Alpha Renamed');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('getModelFamilyKey and formatModelDisplayName normalize families and format effort labels', () => {
  assert.equal(parser.getModelFamilyKey('gemini-4-neon-xhigh'), 'gemini-4-neon');
  assert.equal(parser.getModelFamilyKey('gemini-4-neon-high'), 'gemini-4-neon');
  assert.equal(parser.getModelFamilyKey('gemini-4-hydrogen-xhigh'), 'gemini-4-hydrogen');
  assert.equal(parser.getModelFamilyKey('claude-opus-5-5-thinking'), 'claude-opus-5.5');
  assert.equal(parser.getModelFamilyKey('claude-opus-5.5-high'), 'claude-opus-5.5');
  assert.equal(parser.getModelFamilyKey('gemini-flash-worker-agy'), 'gemini-flash-worker');
  assert.equal(parser.getModelFamilyKey('gemini-pro-orchestrator'), 'gemini-pro-orchestrator');

  assert.equal(parser.formatModelDisplayName('gemini-4-neon'), 'Gemini 4 Neon');
  assert.equal(parser.formatModelDisplayName('gemini-4-neon-xhigh'), 'Gemini 4 Neon (XHigh)');
  assert.equal(parser.formatModelDisplayName('claude-opus-5.5'), 'Claude Opus 5.5');
  assert.equal(
    parser.formatModelDisplayName('claude-opus-5-5-thinking'),
    'Claude Opus 5.5 (Thinking)',
  );
  assert.equal(parser.formatModelDisplayName('gemini-4-hydrogen'), 'Gemini 4 Hydrogen');
  assert.equal(parser.formatModelDisplayName('gemini-flash-worker-agy'), 'Gemini Flash Worker');
  assert.equal(parser.formatModelDisplayName('unknown'), '--');
});

test('analyzeSession supports per-model filtering and family vs exact breakdown', () => {
  const t0 = Date.parse('2026-11-21T10:00:00.000Z');
  const steps = [
    {
      step_index: 0,
      type: 'PLANNER_RESPONSE',
      model: 'gemini-4-neon-high',
      input_tokens: 1000,
      cache_read_tokens: 9000,
      output_tokens: 200,
      created_at: new Date(t0).toISOString(),
    },
    {
      step_index: 1,
      type: 'GENERIC',
      created_at: new Date(t0 + 2000).toISOString(),
    },
    {
      step_index: 2,
      type: 'PLANNER_RESPONSE',
      model: 'gemini-4-neon-xhigh',
      input_tokens: 500,
      cache_read_tokens: 9500,
      output_tokens: 400,
      created_at: new Date(t0 + 5000).toISOString(),
    },
    {
      step_index: 3,
      type: 'GENERIC',
      created_at: new Date(t0 + 7000).toISOString(),
    },
    {
      step_index: 4,
      type: 'PLANNER_RESPONSE',
      model: 'gemini-4-hydrogen-xhigh',
      input_tokens: 2000,
      cache_read_tokens: 2000,
      output_tokens: 100,
      created_at: new Date(t0 + 10000).toISOString(),
    },
    {
      step_index: 5,
      type: 'GENERIC',
      created_at: new Date(t0 + 12000).toISOString(),
    },
  ];

  const famAll = parser.analyzeSession({
    conversationId: 'conv-models',
    steps,
    modelGrouping: 'family',
    now: t0 + 15000,
  });
  assert.equal(famAll.metrics.modelsBreakdown.length, 2);
  assert.equal(famAll.metrics.modelsBreakdown[0].model, 'gemini-4-neon');
  assert.equal(famAll.metrics.modelsBreakdown[0].variants.length, 2);
  assert.equal(famAll.metrics.modelsBreakdown[0].totalTokens, 20600);
  assert.equal(famAll.metrics.modelsBreakdown[1].model, 'gemini-4-hydrogen');
  assert.equal(famAll.metrics.unfilteredTotalTokens, 24700);

  const exactAll = parser.analyzeSession({
    conversationId: 'conv-models',
    steps,
    modelGrouping: 'exact',
    now: t0 + 15000,
  });
  assert.equal(exactAll.metrics.modelsBreakdown.length, 3);

  const neonOnly = parser.analyzeSession({
    conversationId: 'conv-models',
    steps,
    modelGrouping: 'family',
    modelFilter: 'gemini-4-neon',
    now: t0 + 15000,
  });
  assert.equal(neonOnly.metrics.selectedModel, 'gemini-4-neon');
  assert.equal(neonOnly.metrics.stepCount, 2);
  assert.equal(neonOnly.metrics.turns.length, 2);
  assert.equal(neonOnly.metrics.cumulativeUncachedInputTokens, 1500);
  assert.equal(neonOnly.metrics.cumulativeCacheReadTokens, 18500);
  assert.equal(neonOnly.metrics.cumulativeOutputTokens, 600);
  assert.equal(neonOnly.metrics.cumulativeTotalTokens, 20600);
  assert.ok(Math.abs(neonOnly.metrics.sessionCacheHitRate - 18500 / 20000) < 1e-6);
  // 600 tokens / 4s = 150 tok/s
  assert.ok(Math.abs(neonOnly.metrics.avgTokensPerSec - 150) < 1e-6);
  assert.equal(neonOnly.metrics.unfilteredTotalTokens, 24700);
  assert.equal(neonOnly.metrics.modelsBreakdown.length, 2);
});

test('computeWindowSummary supports per-model filtering, comparisons, and timeline byModel sums', () => {
  const now = Date.parse('2026-11-21T12:00:00.000Z');
  const hourMs = 3600 * 1000;

  const s1 = parser.analyzeSession({
    conversationId: 'win-m-1',
    now,
    hookState: {
      conversationId: 'win-m-1',
      workspacePaths: ['C:\\repo\\Proj1'],
      updatedAt: now - 1 * hourMs,
      timings: {},
    },
    steps: [
      {
        step_index: 0,
        type: 'PLANNER_RESPONSE',
        model: 'gemini-4-neon-xhigh',
        input_tokens: 1000,
        cache_read_tokens: 9000,
        output_tokens: 200,
        created_at: new Date(now - 2 * hourMs).toISOString(),
      },
      {
        step_index: 1,
        type: 'GENERIC',
        created_at: new Date(now - 2 * hourMs + 2000).toISOString(),
      },
      {
        step_index: 2,
        type: 'PLANNER_RESPONSE',
        model: 'claude-opus-5-5-thinking',
        input_tokens: 2000,
        cache_read_tokens: 2000,
        output_tokens: 100,
        created_at: new Date(now - 1 * hourMs).toISOString(),
      },
      {
        step_index: 3,
        type: 'GENERIC',
        created_at: new Date(now - 1 * hourMs + 2000).toISOString(),
      },
    ],
  });

  const s2 = parser.analyzeSession({
    conversationId: 'win-m-2',
    now,
    hookState: {
      conversationId: 'win-m-2',
      workspacePaths: ['C:\\repo\\Proj2'],
      updatedAt: now - 10 * hourMs,
      timings: {},
    },
    steps: [
      {
        step_index: 0,
        type: 'PLANNER_RESPONSE',
        model: 'claude-opus-5.5-high',
        input_tokens: 500,
        cache_read_tokens: 4500,
        output_tokens: 150,
        created_at: new Date(now - 10 * hourMs).toISOString(),
      },
      {
        step_index: 1,
        type: 'GENERIC',
        created_at: new Date(now - 10 * hourMs + 3000).toISOString(),
      },
    ],
  });

  const analyses = [s1, s2];
  const all1d = aggregator.computeWindowSummary({
    window: '1d',
    analyses,
    modelGrouping: 'family',
    now,
  });

  assert.equal(all1d.allModels.length, 2);
  assert.equal(all1d.allModels[0].model, 'gemini-4-neon');
  assert.equal(all1d.allModels[1].model, 'claude-opus-5.5');
  assert.equal(all1d.allModels[1].displayName, 'Claude Opus 5.5');
  assert.equal(all1d.allModels[1].sessionCount, 2);

  // Verify every bucket's byModel sum equals bucket.totalTokens
  for (const bucket of all1d.timeline) {
    const sliceSum = bucket.byModel.reduce((acc, s) => acc + s.totalTokens, 0);
    assert.equal(sliceSum, bucket.totalTokens);
  }

  const opusOnly = aggregator.computeWindowSummary({
    window: '1d',
    analyses,
    modelFilter: 'claude-opus-5.5',
    modelGrouping: 'family',
    now,
  });

  assert.equal(opusOnly.selectedModel, 'claude-opus-5.5');
  assert.equal(opusOnly.allModels.length, 2); // Unfiltered bar stays populated
  assert.equal(opusOnly.unfilteredSessionCount, 2);
  assert.equal(opusOnly.unfilteredTotalTokens, 10200 + 4100 + 5150);
  assert.equal(opusOnly.sessionCount, 2);
  assert.equal(opusOnly.stepCount, 2);
  assert.equal(opusOnly.totalTokens, 4100 + 5150);
  assert.equal(opusOnly.projects.length, 2);
  assert.equal(opusOnly.comparisons.find((c) => c.window === '5h').totalTokens, 4100);
  assert.equal(opusOnly.comparisons.find((c) => c.window === '1d').totalTokens, 9250);
});

test('i18n message dictionaries have exact key parity and accurate helpers', () => {
  const enKeys = Object.keys(i18nMod.MESSAGES.en).sort();
  const zhKeys = Object.keys(i18nMod.MESSAGES.zh).sort();
  assert.deepEqual(zhKeys, enKeys);

  for (const key of enKeys) {
    assert.equal(typeof i18nMod.MESSAGES.en[key], 'string');
    assert.ok(i18nMod.MESSAGES.en[key].length > 0, `Empty en message for ${key}`);
    assert.equal(typeof i18nMod.MESSAGES.zh[key], 'string');
    assert.ok(i18nMod.MESSAGES.zh[key].length > 0, `Empty zh message for ${key}`);
    const enVars = Array.from(i18nMod.MESSAGES.en[key].matchAll(/\{(\w+)\}/g), (m) => m[1]).sort();
    const zhVars = Array.from(i18nMod.MESSAGES.zh[key].matchAll(/\{(\w+)\}/g), (m) => m[1]).sort();
    assert.deepEqual(zhVars, enVars, `Placeholder mismatch for ${key}`);
  }

  assert.equal(i18nMod.detectInitialLang(undefined), 'en');
  assert.equal(i18nMod.detectInitialLang('en-US'), 'en');
  assert.equal(i18nMod.detectInitialLang('ja-JP'), 'en');
  assert.equal(i18nMod.detectInitialLang('zh-CN'), 'zh');
  assert.equal(i18nMod.detectInitialLang('ZH-TW'), 'zh');
  assert.equal(i18nMod.detectInitialLang('zh'), 'zh');

  assert.equal(i18nMod.formatCount('en', 1, 'session'), '1 session');
  assert.equal(i18nMod.formatCount('en', 3, 'session'), '3 sessions');
  assert.equal(i18nMod.formatCount('en', 1, 'turn'), '1 turn');
  assert.equal(i18nMod.formatCount('en', 4, 'turn'), '4 turns');
  assert.equal(i18nMod.formatCount('zh', 3, 'session'), '3 个会话');
  assert.equal(i18nMod.formatCount('zh', 4, 'turn'), '4 轮');

  const baseNow = 1_700_000_000_000;
  assert.equal(i18nMod.formatRelativeTimeLocalized('en', 0, baseNow), 'Unknown');
  assert.equal(i18nMod.formatRelativeTimeLocalized('zh', 0, baseNow), '未知时间');
  assert.equal(
    i18nMod.formatRelativeTimeLocalized('en', baseNow - 3000, baseNow),
    'Just now',
  );
  assert.equal(
    i18nMod.formatRelativeTimeLocalized('zh', baseNow - 3000, baseNow),
    '刚刚',
  );
  assert.equal(
    i18nMod.formatRelativeTimeLocalized('en', baseNow - 5 * 60_000, baseNow),
    '5m ago',
  );
  assert.equal(
    i18nMod.formatRelativeTimeLocalized('zh', baseNow - 5 * 60_000, baseNow),
    '5分钟前',
  );
  assert.equal(
    i18nMod.formatRelativeTimeLocalized('en', baseNow - 2 * 86_400_000, baseNow),
    '2d ago',
  );
  assert.equal(
    i18nMod.formatRelativeTimeLocalized('zh', baseNow - 2 * 86_400_000, baseNow),
    '2天前',
  );
});

test('open-source root plugin manifest and prebuilt runtime artifacts exist and are valid', () => {
  const manifestPath = path.join(ROOT_DIR, 'plugin.json');
  const mcpConfigPath = path.join(ROOT_DIR, 'mcp_config.json');
  const hooksPath = path.join(ROOT_DIR, 'hooks.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
  const hooksConfig = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));

  assert.equal(manifest.name, 'cache-pulse');
  assert.equal(manifest.version, '1.2.0');
  assert.equal(manifest.author?.name, 'mqy2333');
  assert.ok(Array.isArray(manifest.suggestedPrompts));
  assert.ok(
    manifest.suggestedPrompts.length > 0 && manifest.suggestedPrompts.length <= 3,
    `Expected 1..3 suggestedPrompts, got ${manifest.suggestedPrompts.length}`,
  );
  assert.equal(manifest.logo, 'assets/logo.svg');
  assert.ok(fs.existsSync(path.join(ROOT_DIR, manifest.logo)));

  assert.ok(mcpConfig.mcpServers?.telemetry);
  assert.ok(hooksConfig['cache-pulse-telemetry']?.PreInvocation);

  for (const relPath of [
    'LICENSE',
    'README.md',
    'README.zh-CN.md',
    'dist/server.cjs',
    'dist/app.html',
    'scripts/hook-capture.cjs',
  ]) {
    assert.ok(
      fs.existsSync(path.join(ROOT_DIR, relPath)),
      `Missing open-source artifact at repo root: ${relPath}`,
    );
  }
});
