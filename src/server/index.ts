import * as fs from 'node:fs';
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import {
  formatModelDisplayName,
  formatPercent,
  formatSpeed,
  formatTokens,
} from '../shared/parser.js';
import { TelemetryStore, resolveDefaultDataDir } from '../shared/store.js';
import type {
  MonitorPayload,
  WindowSummaryPayload,
} from '../shared/types.js';

const APP_URI = 'ui://cache-pulse/app.html';

function parseDataDirArg(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--data-dir' && i + 1 < argv.length) {
      const next = argv[i + 1]?.trim();
      if (next) return next;
    } else if (arg.startsWith('--data-dir=')) {
      const val = arg.slice('--data-dir='.length).trim();
      if (val) return val;
    }
  }
  return resolveDefaultDataDir();
}

function resolveHtmlPath(): string {
  const override = process.env.CACHE_PULSE_HTML_PATH?.trim();
  if (override) {
    return override;
  }
  return path.join(__dirname, 'app.html');
}

function formatPlainTextSummary(payload: MonitorPayload): string {
  const s = payload.activeSession;
  if (!s) {
    return 'Cache Pulse: 暂无可用会话遥测记录，请发送一条对话消息后刷新。';
  }
  const speedStr = s.avgTokensPerSec !== null ? `${formatSpeed(s.avgTokensPerSec)} tok/s` : '-- tok/s';
  const recentStr = formatPercent(s.recentCacheHitRate);
  const sessionStr = formatPercent(s.sessionCacheHitRate);
  const cumInStr = formatTokens(s.cumulativeInputTokens);
  const cumOutStr = formatTokens(s.cumulativeOutputTokens);
  const isFallbackProject =
    s.projectName === `会话 ${s.conversationId.slice(0, 8)}`;
  const header = s.sessionTitle
    ? isFallbackProject
      ? `任务 ${s.sessionTitle}`
      : `项目 ${s.projectName} · ${s.sessionTitle}`
    : `项目 ${s.projectName}`;
  const modelScope = s.selectedModel
    ? ` [${formatModelDisplayName(s.selectedModel)}]`
    : '';
  return `${header}${modelScope} | 均速 ${speedStr} | 缓存 最近 ${recentStr} 会话 ${sessionStr} | 累计 ${cumInStr} 输出 ${cumOutStr}`;
}

function formatWindowTextSummary(summary: WindowSummaryPayload): string {
  const scopeLabel = summary.selectedModel
    ? `${summary.windowLabel} · ${formatModelDisplayName(summary.selectedModel)}`
    : summary.windowLabel;
  if (summary.sessionCount === 0) {
    return `Cache Pulse (${scopeLabel}): 该周期内暂无有效会话记录。`;
  }
  const speedStr =
    summary.avgTokensPerSec !== null
      ? `${formatSpeed(summary.avgTokensPerSec)} tok/s`
      : '-- tok/s';
  const hitStr = formatPercent(summary.overallCacheHitRate);
  const totalStr = formatTokens(summary.totalTokens);
  const cachedStr = formatTokens(summary.totalCacheReadTokens);
  const uncachedStr = formatTokens(summary.totalUncachedInputTokens);
  const outStr = formatTokens(summary.totalOutputTokens);
  const base = `Cache Pulse ${scopeLabel} | 会话 ${summary.sessionCount} 个 (${summary.stepCount} 轮) | 均速 ${speedStr} | 总命中率 ${hitStr} | 总用量 ${totalStr} (缓存 ${cachedStr} / 新输入 ${uncachedStr} / 输出 ${outStr})`;
  if (!summary.selectedModel && summary.models.length > 0) {
    const topModels = summary.models
      .slice(0, 4)
      .map(
        (m) =>
          `${m.displayName} ${formatTokens(m.totalTokens)}(${formatPercent(m.cacheHitRate)})`,
      )
      .join(', ');
    return `${base} | 分模型: ${topModels}`;
  }
  return base;
}

async function main(): Promise<void> {
  const dataDir = parseDataDirArg(process.argv.slice(2));
  const store = new TelemetryStore({ dataDir });

  const server = new McpServer({
    name: 'cache-pulse',
    version: '1.2.0',
  });

  registerAppResource(
    server,
    'Cache Pulse Monitor',
    APP_URI,
    {
      description:
        'Real-time per-session prompt cache hit rate, throughput, and token usage UI.',
      _meta: {
        ui: {
          prefersBorder: false,
        },
      },
    },
    async () => {
      const htmlPath = resolveHtmlPath();
      const html = fs.readFileSync(htmlPath, 'utf8');
      return {
        contents: [
          {
            uri: APP_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: {
              ui: {
                prefersBorder: false,
              },
            },
          },
        ],
      };
    },
  );

  registerAppTool(
    server,
    'open_monitor',
    {
      title: 'Cache Pulse',
      description:
        'Open the real-time per-session cache hit rate, token speed, and usage monitor, or query 5h / 1d / 7d multi-session aggregate statistics.',
      inputSchema: {
        sessionId: z
          .string()
          .optional()
          .describe(
            'Optional conversation ID to inspect; defaults to the currently active session.',
          ),
        window: z
          .enum(['5h', '1d', '7d'])
          .optional()
          .describe(
            'Optional time window ("5h", "1d", or "7d") to open the multi-session aggregate statistics view.',
          ),
        model: z
          .string()
          .optional()
          .describe(
            'Optional model filter key (e.g. "gemini-4-neon", "claude-opus-5.5", or exact model ID).',
          ),
        modelGrouping: z
          .enum(['family', 'exact'])
          .optional()
          .describe(
            'How model variants are grouped: "family" (merge effort tiers) or "exact" (raw model IDs).',
          ),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
      _meta: {
        ui: {
          resourceUri: APP_URI,
        },
        'com.google.antigravity/ui': {
          entrypoints: [
            { type: 'aux_pane', title: 'Cache Pulse' },
            { type: 'global', title: 'Cache Pulse' },
          ],
        },
      },
    },
    async ({ sessionId, window, model, modelGrouping }) => {
      if (window) {
        const summary = store.getWindowSummary({
          window,
          model,
          modelGrouping,
        });
        return {
          content: [{ type: 'text', text: formatWindowTextSummary(summary) }],
          structuredContent: summary as unknown as Record<string, unknown>,
        };
      }
      const payload = store.getMonitorPayload({
        sessionId,
        autoFollow: !sessionId,
        model,
        modelGrouping,
      });
      return {
        content: [{ type: 'text', text: formatPlainTextSummary(payload) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    },
  );

  registerAppTool(
    server,
    'get_metrics',
    {
      title: 'Get Session Metrics',
      description:
        'App-only polling endpoint returning updated per-session cache and token telemetry.',
      inputSchema: {
        sessionId: z.string().optional(),
        autoFollow: z.boolean().optional(),
        model: z.string().optional(),
        modelGrouping: z.enum(['family', 'exact']).optional(),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
      _meta: {
        ui: {
          visibility: ['app'],
        },
      },
    },
    async ({ sessionId, autoFollow, model, modelGrouping }) => {
      const payload = store.getMonitorPayload({
        sessionId,
        autoFollow: autoFollow ?? !sessionId,
        model,
        modelGrouping,
      });
      return {
        content: [{ type: 'text', text: formatPlainTextSummary(payload) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    },
  );

  registerAppTool(
    server,
    'get_window_summary',
    {
      title: 'Get Window Summary',
      description:
        'App-only endpoint returning 5h, 1d, or 7d multi-session aggregate cache hit rate, throughput, and token usage analytics.',
      inputSchema: {
        window: z.enum(['5h', '1d', '7d']).optional(),
        model: z.string().optional(),
        modelGrouping: z.enum(['family', 'exact']).optional(),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
      _meta: {
        ui: {
          visibility: ['app'],
        },
      },
    },
    async ({ window, model, modelGrouping }) => {
      const summary = store.getWindowSummary({
        window: window ?? '1d',
        model,
        modelGrouping,
      });
      return {
        content: [{ type: 'text', text: formatWindowTextSummary(summary) }],
        structuredContent: summary as unknown as Record<string, unknown>,
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('[cache-pulse] Fatal server error:', err);
  process.exit(1);
});
