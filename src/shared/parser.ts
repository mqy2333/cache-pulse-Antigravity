import type {
  CompactTurnSample,
  HookSessionState,
  ModelAggregate,
  ModelGrouping,
  SessionAnalysis,
  SessionMetrics,
  SpeedSource,
  TranscriptStep,
  TurnMetric,
} from './types.js';

const MAX_UI_TURNS = 80;
const MIN_HOOK_DURATION_MS = 200;
const MAX_HOOK_DURATION_MS = 600_000;
const MIN_TRANSCRIPT_DELTA_MS = 1_000;
const MAX_TRANSCRIPT_DELTA_MS = 180_000;
const MAX_HOOK_COMPARISON_DELTA_MS = 300_000;
const HOOK_TOOL_WAIT_MARGIN_MS = 3_000;
const LIVE_RECENCY_WINDOW_MS = 20_000;
const LIVE_PENDING_WINDOW_MS = 180_000;

function toNonNegativeNumber(val: unknown): number {
  if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
    return 0;
  }
  return val;
}

export function clampUnit(val: number): number {
  if (val < 0) return 0;
  if (val > 1) return 1;
  return val;
}

const EFFORT_LABELS: Record<string, string> = {
  xhigh: 'XHigh',
  high: 'High',
  medium: 'Medium',
  med: 'Medium',
  low: 'Low',
  minimal: 'Minimal',
  thinking: 'Thinking',
  fast: 'Fast',
  max: 'Max',
};

const MODEL_QUALIFIER_RE =
  /-(xhigh|high|medium|med|low|minimal|thinking|fast|max|effort|default|agy|\d{8})$/;

/**
 * Normalize a raw model ID to a family key by stripping trailing effort/mode/date qualifiers
 * and normalizing dashed decimal versions (e.g. `opus-5-5` -> `opus-5.5`).
 */
export function getModelFamilyKey(rawModel?: string | null): string {
  const trimmed = rawModel?.trim().toLowerCase() ?? '';
  if (!trimmed || trimmed === 'unknown') {
    return 'unknown';
  }
  let base = trimmed;
  while (MODEL_QUALIFIER_RE.test(base)) {
    const next = base.replace(MODEL_QUALIFIER_RE, '');
    if (!next || next === base) break;
    base = next;
  }
  return base.replace(/([a-z]+)-(\d)-(\d)(?=-|$)/g, '$1-$2.$3');
}

export function resolveModelGroupKey(
  rawModel: string | null | undefined,
  grouping: ModelGrouping = 'family',
): string {
  if (grouping === 'exact') {
    const trimmed = rawModel?.trim() ?? '';
    return trimmed || 'unknown';
  }
  return getModelFamilyKey(rawModel);
}

/**
 * Format a model key or raw model ID into a concise, human-readable label.
 */
export function formatModelDisplayName(modelKeyOrRaw?: string | null): string {
  const trimmed = modelKeyOrRaw?.trim() ?? '';
  if (!trimmed || trimmed.toLowerCase() === 'unknown') {
    return '--';
  }
  let base = trimmed.toLowerCase();
  const effortTags: string[] = [];

  while (MODEL_QUALIFIER_RE.test(base)) {
    const m = MODEL_QUALIFIER_RE.exec(base);
    if (!m) break;
    const tag = m[1];
    if (EFFORT_LABELS[tag]) {
      effortTags.unshift(EFFORT_LABELS[tag]);
    }
    const next = base.slice(0, m.index);
    if (!next) break;
    base = next;
  }

  base = base.replace(/([a-z]+)-(\d)-(\d)(?=-|$)/g, '$1-$2.$3');
  const words = base
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((tok) => {
      if (tok === 'gpt') return 'GPT';
      if (/^o\d+$/i.test(tok)) return tok.toUpperCase();
      return tok.charAt(0).toUpperCase() + tok.slice(1);
    });

  const label = words.join(' ');
  return effortTags.length > 0 ? `${label} (${effortTags.join(' ')})` : label;
}

/**
 * Extract short effort label for a raw model variant (e.g. `gemini-4-neon-xhigh` -> `XHigh`).
 */
export function extractModelEffortLabel(rawModel?: string | null): string | null {
  const trimmed = rawModel?.trim().toLowerCase() ?? '';
  const m = /-(xhigh|high|medium|med|low|minimal|thinking|fast|max)$/.exec(trimmed);
  if (!m) return null;
  return EFFORT_LABELS[m[1]] ?? null;
}

/**
 * Shared model rollup builder used by both single-session and multi-session window analytics.
 */
export function buildModelAggregatesFromSamples(
  sessions: Array<{ conversationId: string; samples: CompactTurnSample[] }>,
  grouping: ModelGrouping = 'family',
): ModelAggregate[] {
  const map = new Map<
    string,
    {
      sessions: Set<string>;
      variants: Set<string>;
      stepCount: number;
      cacheReadTokens: number;
      uncachedInputTokens: number;
      outputTokens: number;
      timedOutputTokens: number;
      timedDurationMs: number;
      timedStepCount: number;
    }
  >();

  for (const { conversationId, samples } of sessions) {
    for (const sample of samples) {
      const rawModel = sample.model || 'unknown';
      const key = resolveModelGroupKey(rawModel, grouping);
      let entry = map.get(key);
      if (!entry) {
        entry = {
          sessions: new Set(),
          variants: new Set(),
          stepCount: 0,
          cacheReadTokens: 0,
          uncachedInputTokens: 0,
          outputTokens: 0,
          timedOutputTokens: 0,
          timedDurationMs: 0,
          timedStepCount: 0,
        };
        map.set(key, entry);
      }
      entry.sessions.add(conversationId);
      entry.variants.add(rawModel);
      entry.stepCount += 1;
      entry.cacheReadTokens += sample.cacheReadTokens;
      entry.uncachedInputTokens += sample.inputTokens;
      entry.outputTokens += sample.outputTokens;
      if (
        sample.durationMs !== null &&
        sample.durationMs > 0 &&
        sample.outputTokens > 0
      ) {
        entry.timedOutputTokens += sample.outputTokens;
        entry.timedDurationMs += sample.durationMs;
        entry.timedStepCount += 1;
      }
    }
  }

  const list: ModelAggregate[] = [];
  for (const [model, entry] of map.entries()) {
    const totalInputTokens = entry.cacheReadTokens + entry.uncachedInputTokens;
    const totalTokens = totalInputTokens + entry.outputTokens;
    list.push({
      model,
      displayName: formatModelDisplayName(model),
      variants: Array.from(entry.variants).sort(),
      sessionCount: entry.sessions.size,
      stepCount: entry.stepCount,
      cacheReadTokens: entry.cacheReadTokens,
      uncachedInputTokens: entry.uncachedInputTokens,
      totalInputTokens,
      outputTokens: entry.outputTokens,
      totalTokens,
      cacheHitRate:
        totalInputTokens > 0
          ? clampUnit(entry.cacheReadTokens / totalInputTokens)
          : null,
      avgTokensPerSec:
        entry.timedDurationMs > 0
          ? entry.timedOutputTokens / (entry.timedDurationMs / 1000)
          : null,
      timedStepCount: entry.timedStepCount,
    });
  }

  return list.sort(
    (a, b) =>
      b.totalTokens - a.totalTokens ||
      b.stepCount - a.stepCount ||
      a.model.localeCompare(b.model),
  );
}

/**
 * Derive a human-readable project name from a filesystem path or file URI.
 */
export function deriveProjectName(rawPath?: string | null): string | null {
  if (!rawPath || typeof rawPath !== 'string') {
    return null;
  }
  let cleaned = rawPath.trim();
  if (!cleaned) {
    return null;
  }
  if (cleaned.startsWith('file://')) {
    try {
      const url = new URL(cleaned);
      cleaned = decodeURIComponent(url.pathname);
      if (/^\/[a-zA-Z]:/.test(cleaned)) {
        cleaned = cleaned.slice(1);
      }
    } catch {
      // Fallback to raw string parsing if URI is malformed.
    }
  }
  // Normalize separators and strip trailing slashes (keep drive root if only root).
  const normalized = cleaned.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized || /^[a-zA-Z]:$/.test(normalized)) {
    return normalized || null;
  }
  const idx = normalized.lastIndexOf('/');
  const base = idx >= 0 ? normalized.slice(idx + 1) : normalized;
  return base || null;
}

const utf8Decoder = new TextDecoder('utf-8');

/**
 * Parse a conversation title from Antigravity's annotations/*.pbtxt file.
 */
export function parseAnnotationTitle(raw: string): string | null {
  if (!raw) return null;
  const match = /(?:^|\s)title\s*:\s*"((?:\\.|[^"\\])*)"/.exec(raw);
  if (!match) return null;

  const inner = match[1];
  let out = '';
  const pendingBytes: number[] = [];

  const flushBytes = (): void => {
    if (pendingBytes.length > 0) {
      out += utf8Decoder.decode(new Uint8Array(pendingBytes));
      pendingBytes.length = 0;
    }
  };

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch !== '\\') {
      flushBytes();
      out += ch;
      continue;
    }
    const next = inner[i + 1];
    if (next === undefined) {
      flushBytes();
      out += '\\';
      break;
    }
    if (next >= '0' && next <= '7') {
      const octMatch = /^[0-7]{1,3}/.exec(inner.slice(i + 1));
      if (octMatch) {
        pendingBytes.push(parseInt(octMatch[0], 8) & 0xff);
        i += octMatch[0].length;
        continue;
      }
    }
    if (next === 'x') {
      const hexMatch = /^[0-9a-fA-F]{1,2}/.exec(inner.slice(i + 2));
      if (hexMatch) {
        pendingBytes.push(parseInt(hexMatch[0], 16) & 0xff);
        i += 1 + hexMatch[0].length;
        continue;
      }
    }
    flushBytes();
    if (next === 'u') {
      const uMatch = /^[0-9a-fA-F]{4}/.exec(inner.slice(i + 2));
      if (uMatch) {
        out += String.fromCharCode(parseInt(uMatch[0], 16));
        i += 1 + uMatch[0].length;
        continue;
      }
    }
    if (next === 'n' || next === 'r' || next === 't') {
      out += ' ';
    } else {
      out += next;
    }
    i += 1;
  }
  flushBytes();

  const cleaned = out.replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

/**
 * Derive a short session title from the first USER_INPUT message when no annotation exists.
 */
export function extractFallbackSessionTitle(
  steps: TranscriptStep[],
  maxChars = 28,
): string | null {
  for (const step of steps) {
    if (step.type !== 'USER_INPUT' || !step.content) continue;
    let text = step.content;
    const reqStart = text.indexOf('<USER_REQUEST>');
    if (reqStart >= 0) {
      text = text.slice(reqStart + '<USER_REQUEST>'.length);
      const reqEnd = text.indexOf('</USER_REQUEST>');
      if (reqEnd >= 0) {
        text = text.slice(0, reqEnd);
      } else {
        const metaIdx = text.indexOf('<ADDITIONAL_METADATA>');
        if (metaIdx >= 0) {
          text = text.slice(0, metaIdx);
        }
      }
    }
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    const chars = Array.from(cleaned);
    if (chars.length <= maxChars) {
      return cleaned;
    }
    return `${chars.slice(0, maxChars).join('')}…`;
  }
  return null;
}

/**
 * Parse transcript.jsonl defensively, ignoring blank or partially-written lines.
 */
export function parseTranscriptLines(raw: string): TranscriptStep[] {
  if (!raw) return [];
  const steps: TranscriptStep[] = [];
  const lines = raw.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed !== 'object' || parsed === null) continue;
      obj = parsed as Record<string, unknown>;
    } catch {
      // Skip incomplete or malformed JSON lines during concurrent writes.
      continue;
    }

    if (typeof obj.step_index !== 'number' || !Number.isFinite(obj.step_index)) {
      continue;
    }
    if (typeof obj.type !== 'string' || !obj.type) {
      continue;
    }

    steps.push({
      step_index: obj.step_index,
      type: obj.type,
      status: typeof obj.status === 'string' ? obj.status : undefined,
      created_at: typeof obj.created_at === 'string' ? obj.created_at : undefined,
      model: typeof obj.model === 'string' ? obj.model : undefined,
      input_tokens:
        typeof obj.input_tokens === 'number'
          ? toNonNegativeNumber(obj.input_tokens)
          : undefined,
      cache_read_tokens:
        typeof obj.cache_read_tokens === 'number'
          ? toNonNegativeNumber(obj.cache_read_tokens)
          : undefined,
      output_tokens:
        typeof obj.output_tokens === 'number'
          ? toNonNegativeNumber(obj.output_tokens)
          : undefined,
      content:
        obj.type === 'USER_INPUT' && typeof obj.content === 'string'
          ? obj.content.slice(0, 600)
          : undefined,
    });
  }

  return steps;
}

export interface ComputeSessionMetricsInput {
  conversationId: string;
  steps: TranscriptStep[];
  hookState?: HookSessionState | null;
  transcriptMtimeMs?: number;
  sessionTitle?: string | null;
  modelFilter?: string | null;
  modelGrouping?: ModelGrouping;
  now?: number;
}

/**
 * Analyze all steps of a session in a single pass, returning both capped UI metrics
 * and uncapped per-turn samples for multi-session window aggregation.
 *
 * Verified transcript.jsonl semantics:
 * `input_tokens` (uncached input) and `cache_read_tokens` (cached input) are disjoint,
 * so total prompt input tokens = `input_tokens + cache_read_tokens`.
 */
export function analyzeSession(
  input: ComputeSessionMetricsInput,
): SessionAnalysis {
  const now = input.now ?? Date.now();
  const { conversationId, steps, hookState } = input;
  const timings = hookState?.timings ?? {};
  const grouping: ModelGrouping = input.modelGrouping ?? 'family';
  const selectedModel = input.modelFilter?.trim() || null;

  let firstStepTimestampMs = Infinity;
  let lastStepTimestampMs = 0;

  const allTurnsRaw: TurnMetric[] = [];
  const allTurnSamples: CompactTurnSample[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    let parsedStepTs: number | null = null;
    if (step.created_at) {
      const ts = Date.parse(step.created_at);
      if (Number.isFinite(ts)) {
        parsedStepTs = ts;
        if (ts < firstStepTimestampMs) {
          firstStepTimestampMs = ts;
        }
        if (ts > lastStepTimestampMs) {
          lastStepTimestampMs = ts;
        }
      }
    }

    if (step.type !== 'PLANNER_RESPONSE') {
      continue;
    }

    const inputTokens = toNonNegativeNumber(step.input_tokens);
    const cacheReadTokens = toNonNegativeNumber(step.cache_read_tokens);
    const totalInputTokens = inputTokens + cacheReadTokens;
    const outputTokens = toNonNegativeNumber(step.output_tokens);
    const model = step.model?.trim() || hookState?.modelName?.trim() || 'unknown';
    const cacheHitRate =
      totalInputTokens > 0 ? clampUnit(cacheReadTokens / totalInputTokens) : null;

    // Estimate step duration and token speed.
    let durationMs: number | null = null;
    let tokensPerSec: number | null = null;
    let speedSource: SpeedSource = 'none';

    if (outputTokens > 0) {
      const nextStep = i + 1 < steps.length ? steps[i + 1] : undefined;
      let transcriptDeltaMs: number | null = null;

      if (
        nextStep &&
        nextStep.type !== 'USER_INPUT' &&
        step.created_at &&
        nextStep.created_at
      ) {
        const t0 = Date.parse(step.created_at);
        const t1 = Date.parse(nextStep.created_at);
        if (Number.isFinite(t0) && Number.isFinite(t1)) {
          const delta = t1 - t0;
          if (delta > 0) {
            transcriptDeltaMs = delta;
          }
        }
      }

      const hookTiming = timings[String(step.step_index)];
      if (
        hookTiming &&
        Number.isFinite(hookTiming.durationMs) &&
        hookTiming.durationMs >= MIN_HOOK_DURATION_MS &&
        hookTiming.durationMs <= MAX_HOOK_DURATION_MS
      ) {
        // Guard against PostInvocation firing after a slow tool call rather than right after inference.
        if (
          transcriptDeltaMs !== null &&
          transcriptDeltaMs >= MIN_TRANSCRIPT_DELTA_MS &&
          transcriptDeltaMs <= MAX_HOOK_COMPARISON_DELTA_MS &&
          hookTiming.durationMs > transcriptDeltaMs + HOOK_TOOL_WAIT_MARGIN_MS
        ) {
          durationMs = transcriptDeltaMs;
          speedSource = 'transcript';
        } else {
          durationMs = hookTiming.durationMs;
          speedSource = 'hook';
        }
      } else if (
        transcriptDeltaMs !== null &&
        transcriptDeltaMs >= MIN_TRANSCRIPT_DELTA_MS &&
        transcriptDeltaMs <= MAX_TRANSCRIPT_DELTA_MS
      ) {
        durationMs = transcriptDeltaMs;
        speedSource = 'transcript';
      }

      if (durationMs !== null && durationMs > 0) {
        tokensPerSec = outputTokens / (durationMs / 1000);
      }
    }

    allTurnSamples.push({
      stepIndex: step.step_index,
      timestampMs: parsedStepTs,
      model,
      inputTokens,
      cacheReadTokens,
      totalInputTokens,
      outputTokens,
      durationMs,
      speedSource,
    });

    allTurnsRaw.push({
      stepIndex: step.step_index,
      createdAt: step.created_at ?? '',
      model,
      inputTokens,
      cacheReadTokens,
      totalInputTokens,
      outputTokens,
      cacheHitRate,
      durationMs,
      tokensPerSec,
      speedSource,
    });
  }

  const modelsBreakdown = buildModelAggregatesFromSamples(
    [{ conversationId, samples: allTurnSamples }],
    grouping,
  );
  const unfilteredTotalTokens = allTurnSamples.reduce(
    (acc, s) => acc + s.totalInputTokens + s.outputTokens,
    0,
  );

  let cumulativeUncachedInputTokens = 0;
  let cumulativeCacheReadTokens = 0;
  let cumulativeOutputTokens = 0;

  let timedOutputSum = 0;
  let timedDurationMsSum = 0;
  let timedStepCount = 0;
  let hookTimedStepCount = 0;
  let transcriptTimedStepCount = 0;
  let hasHookTiming = false;
  let hasTranscriptTiming = false;

  const modelsUsedSet = new Set<string>();
  const modelsUsed: string[] = [];
  let activeModel: string | null = null;
  let recentCacheHitRate: number | null = null;

  const filteredTurns: TurnMetric[] = [];
  const filteredSamples: CompactTurnSample[] = [];

  for (let i = 0; i < allTurnSamples.length; i++) {
    const sample = allTurnSamples[i];
    const turn = allTurnsRaw[i];
    if (
      selectedModel !== null &&
      resolveModelGroupKey(sample.model, grouping) !== selectedModel
    ) {
      continue;
    }

    filteredSamples.push(sample);
    filteredTurns.push(turn);

    if (sample.model && sample.model !== 'unknown') {
      activeModel = sample.model;
      if (!modelsUsedSet.has(sample.model)) {
        modelsUsedSet.add(sample.model);
        modelsUsed.push(sample.model);
      }
    }

    cumulativeUncachedInputTokens += sample.inputTokens;
    cumulativeCacheReadTokens += sample.cacheReadTokens;
    cumulativeOutputTokens += sample.outputTokens;
    recentCacheHitRate = turn.cacheHitRate;

    if (sample.durationMs !== null && sample.durationMs > 0 && sample.outputTokens > 0) {
      timedOutputSum += sample.outputTokens;
      timedDurationMsSum += sample.durationMs;
      timedStepCount += 1;
      if (sample.speedSource === 'hook') {
        hasHookTiming = true;
        hookTimedStepCount += 1;
      } else if (sample.speedSource === 'transcript') {
        hasTranscriptTiming = true;
        transcriptTimedStepCount += 1;
      }
    }
  }

  if (selectedModel === null && !activeModel && hookState?.modelName?.trim()) {
    activeModel = hookState.modelName.trim();
  }

  const cumulativeInputTokens =
    cumulativeUncachedInputTokens + cumulativeCacheReadTokens;
  const cumulativeTotalTokens = cumulativeInputTokens + cumulativeOutputTokens;
  const sessionCacheHitRate =
    cumulativeInputTokens > 0
      ? clampUnit(cumulativeCacheReadTokens / cumulativeInputTokens)
      : null;

  const avgTokensPerSec =
    timedDurationMsSum > 0 ? timedOutputSum / (timedDurationMsSum / 1000) : null;
  const speedSource: SpeedSource = hasHookTiming
    ? 'hook'
    : hasTranscriptTiming
      ? 'transcript'
      : 'none';

  const lastUpdatedAt = Math.max(
    input.transcriptMtimeMs ?? 0,
    hookState?.updatedAt ?? 0,
    lastStepTimestampMs,
  );

  // Separate activity clock from file copy/stat mtime when explicit timestamps exist.
  const explicitActivityAt = Math.max(
    lastStepTimestampMs,
    hookState?.updatedAt ?? 0,
  );
  const lastActivityAt =
    explicitActivityAt > 0
      ? explicitActivityAt
      : (input.transcriptMtimeMs ?? 0);
  const firstActivityAt =
    Number.isFinite(firstStepTimestampMs) && firstStepTimestampMs > 0
      ? firstStepTimestampMs
      : lastActivityAt;

  const hasRecentActivity =
    lastUpdatedAt > 0 && now - lastUpdatedAt <= LIVE_RECENCY_WINDOW_MS;
  const hasPendingInvocation = Boolean(
    hookState?.pendingInvocation &&
      now - hookState.pendingInvocation.startedAt <= LIVE_PENDING_WINDOW_MS,
  );
  const isLive = hasRecentActivity || hasPendingInvocation;

  const projectPath = hookState?.workspacePaths?.[0] || hookState?.cwd || null;
  const projectName =
    hookState?.projectName?.trim() ||
    deriveProjectName(projectPath) ||
    `会话 ${conversationId.slice(0, 8)}`;
  const explicitTitle = input.sessionTitle?.trim() || null;
  const sessionTitle = explicitTitle || extractFallbackSessionTitle(steps);

  return {
    metrics: {
      conversationId,
      projectName,
      sessionTitle,
      projectPath,
      activeModel,
      modelsUsed,
      isLive,
      lastUpdatedAt,
      stepCount: filteredTurns.length,
      recentCacheHitRate,
      sessionCacheHitRate,
      cumulativeInputTokens,
      cumulativeCacheReadTokens,
      cumulativeUncachedInputTokens,
      cumulativeOutputTokens,
      cumulativeTotalTokens,
      avgTokensPerSec,
      speedSource,
      timedStepCount,
      timedOutputTokens: timedOutputSum,
      timedDurationMs: timedDurationMsSum,
      hookTimedStepCount,
      transcriptTimedStepCount,
      firstActivityAt,
      lastActivityAt,
      selectedModel,
      modelGrouping: grouping,
      unfilteredTotalTokens,
      modelsBreakdown,
      turns:
        filteredTurns.length > MAX_UI_TURNS
          ? filteredTurns.slice(-MAX_UI_TURNS)
          : filteredTurns,
    },
    turnSamples: filteredSamples,
  };
}

/**
 * Compute per-session cache hit rates, cumulative tokens, and throughput metrics.
 */
export function computeSessionMetrics(
  input: ComputeSessionMetricsInput,
): SessionMetrics {
  return analyzeSession(input).metrics;
}

/**
 * Format token counts concisely (e.g. 999, 331.1k, 41.9M).
 * Promotes >= 999,950 directly to 1.0M to avoid displaying "1000.0k".
 */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }
  if (value < 1_000) {
    return String(Math.round(value));
  }
  if (value < 999_950) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  if (value < 999_950_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  return `${(value / 1_000_000_000).toFixed(1)}B`;
}

export function formatPercent(fraction: number | null): string {
  if (fraction === null || !Number.isFinite(fraction)) {
    return '--';
  }
  return `${(clampUnit(fraction) * 100).toFixed(1)}%`;
}

export function formatSpeed(tokensPerSec: number | null): string {
  if (tokensPerSec === null || !Number.isFinite(tokensPerSec) || tokensPerSec <= 0) {
    return '--';
  }
  return tokensPerSec.toFixed(1);
}
