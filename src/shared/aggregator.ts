import {
  buildModelAggregatesFromSamples,
  clampUnit,
  formatModelDisplayName,
  resolveModelGroupKey,
} from './parser.js';
import type {
  CompactTurnSample,
  ModelAggregate,
  ModelGrouping,
  ProjectAggregate,
  SessionAnalysis,
  SessionMetrics,
  SpeedSource,
  TimeWindowKey,
  TimelineBucket,
  TimelineModelSlice,
  WindowComparisonItem,
  WindowSessionItem,
  WindowSummaryPayload,
} from './types.js';

export const WINDOW_CONFIG: Record<
  TimeWindowKey,
  { label: string; shortLabel: string; durationMs: number }
> = {
  '5h': {
    label: '近 5 小时',
    shortLabel: '5h',
    durationMs: 5 * 60 * 60 * 1000,
  },
  '1d': {
    label: '近 24 小时',
    shortLabel: '1d',
    durationMs: 24 * 60 * 60 * 1000,
  },
  '7d': {
    label: '近 7 天',
    shortLabel: '7d',
    durationMs: 7 * 24 * 60 * 60 * 1000,
  },
};

export const WINDOW_ORDER: TimeWindowKey[] = ['5h', '1d', '7d'];
export const MAX_WINDOW_SESSIONS_RETURNED = 100;
export const FUTURE_CLOCK_SKEW_MS = 60_000;

interface MutableTotals {
  stepCount: number;
  cacheReadTokens: number;
  uncachedInputTokens: number;
  outputTokens: number;
  timedOutputTokens: number;
  timedDurationMs: number;
  timedStepCount: number;
}

function createEmptyTotals(): MutableTotals {
  return {
    stepCount: 0,
    cacheReadTokens: 0,
    uncachedInputTokens: 0,
    outputTokens: 0,
    timedOutputTokens: 0,
    timedDurationMs: 0,
    timedStepCount: 0,
  };
}

function finalizeRates(totals: MutableTotals) {
  const totalInputTokens = totals.cacheReadTokens + totals.uncachedInputTokens;
  const totalTokens = totalInputTokens + totals.outputTokens;
  const cacheHitRate =
    totalInputTokens > 0
      ? clampUnit(totals.cacheReadTokens / totalInputTokens)
      : null;
  const avgTokensPerSec =
    totals.timedDurationMs > 0
      ? totals.timedOutputTokens / (totals.timedDurationMs / 1000)
      : null;
  return {
    totalInputTokens,
    totalTokens,
    cacheHitRate,
    avgTokensPerSec,
  };
}

/**
 * Determine whether a session was triggered/active inside [windowStartMs, now].
 * Matched sessions are always counted in full.
 */
export function isSessionInWindow(
  metrics: SessionMetrics,
  windowStartMs: number,
  now: number,
): boolean {
  return (
    metrics.stepCount > 0 &&
    metrics.lastActivityAt >= windowStartMs &&
    metrics.lastActivityAt <= now + FUTURE_CLOCK_SKEW_MS
  );
}

interface SessionHeadlineRollup {
  matched: SessionAnalysis[];
  totals: MutableTotals;
  hookTimedStepCount: number;
  transcriptTimedStepCount: number;
  hasLiveSession: boolean;
  speedSource: SpeedSource;
}

function rollupMatchedSessions(
  analyses: SessionAnalysis[],
  windowStartMs: number,
  now: number,
): SessionHeadlineRollup {
  const matched: SessionAnalysis[] = [];
  const totals = createEmptyTotals();
  let hookTimedStepCount = 0;
  let transcriptTimedStepCount = 0;
  let hasLiveSession = false;

  for (const analysis of analyses) {
    const m = analysis.metrics;
    if (!isSessionInWindow(m, windowStartMs, now)) {
      continue;
    }
    matched.push(analysis);
    totals.stepCount += m.stepCount;
    totals.cacheReadTokens += m.cumulativeCacheReadTokens;
    totals.uncachedInputTokens += m.cumulativeUncachedInputTokens;
    totals.outputTokens += m.cumulativeOutputTokens;
    totals.timedOutputTokens += m.timedOutputTokens;
    totals.timedDurationMs += m.timedDurationMs;
    totals.timedStepCount += m.timedStepCount;
    hookTimedStepCount += m.hookTimedStepCount;
    transcriptTimedStepCount += m.transcriptTimedStepCount;
    if (m.isLive) {
      hasLiveSession = true;
    }
  }

  const speedSource: SpeedSource =
    hookTimedStepCount > 0
      ? 'hook'
      : transcriptTimedStepCount > 0
        ? 'transcript'
        : 'none';

  return {
    matched,
    totals,
    hookTimedStepCount,
    transcriptTimedStepCount,
    hasLiveSession,
    speedSource,
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatHourMinute(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatMonthDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

interface MutableBucket extends MutableTotals {
  key: string;
  label: string;
  startMs: number;
  endMs: number;
  isCarryOver: boolean;
  byModelTokens: Map<string, number>;
}

function createMutableBucket(
  key: string,
  label: string,
  startMs: number,
  endMs: number,
  isCarryOver: boolean,
): MutableBucket {
  return {
    ...createEmptyTotals(),
    key,
    label,
    startMs,
    endMs,
    isCarryOver,
    byModelTokens: new Map(),
  };
}

function createRegularBuckets(
  window: TimeWindowKey,
  windowStartMs: number,
  now: number,
): MutableBucket[] {
  const buckets: MutableBucket[] = [];

  if (window === '5h' || window === '1d') {
    const bucketCount = window === '5h' ? 10 : 12;
    const stepMs = WINDOW_CONFIG[window].durationMs / bucketCount;
    for (let i = 0; i < bucketCount; i++) {
      const startMs = Math.round(windowStartMs + i * stepMs);
      const endMs =
        i === bucketCount - 1
          ? Math.max(startMs, now)
          : Math.round(windowStartMs + (i + 1) * stepMs);
      buckets.push(
        createMutableBucket(
          `${window}-${i}`,
          formatHourMinute(startMs),
          startMs,
          endMs,
          false,
        ),
      );
    }
    return buckets;
  }

  // '7d': local calendar-day buckets clamped to [windowStartMs, now].
  const startDate = new Date(windowStartMs);
  let cursor = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate(),
  );

  let dayIdx = 0;
  while (cursor.getTime() < now || dayIdx === 0) {
    const dayStartMs = cursor.getTime();
    const nextDay = new Date(
      cursor.getFullYear(),
      cursor.getMonth(),
      cursor.getDate() + 1,
    );
    const nextDayMs = nextDay.getTime();
    const clampedStart = Math.max(windowStartMs, dayStartMs);
    const clampedEnd = Math.min(now, nextDayMs);
    buckets.push(
      createMutableBucket(
        `7d-${dayIdx}`,
        formatMonthDay(dayStartMs),
        clampedStart,
        Math.max(clampedStart, clampedEnd),
        false,
      ),
    );
    cursor = nextDay;
    dayIdx += 1;
    if (dayIdx > 10) {
      break;
    }
  }

  return buckets;
}

function toTimelineBucket(bucket: MutableBucket): TimelineBucket {
  const rates = finalizeRates(bucket);
  const byModel: TimelineModelSlice[] = Array.from(bucket.byModelTokens.entries())
    .filter(([, total]) => total > 0)
    .map(([model, totalTokens]) => ({
      model,
      displayName: formatModelDisplayName(model),
      totalTokens,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens || a.model.localeCompare(b.model));

  return {
    key: bucket.key,
    label: bucket.label,
    startMs: bucket.startMs,
    endMs: bucket.endMs,
    isCarryOver: bucket.isCarryOver,
    stepCount: bucket.stepCount,
    cacheReadTokens: bucket.cacheReadTokens,
    uncachedInputTokens: bucket.uncachedInputTokens,
    totalInputTokens: rates.totalInputTokens,
    outputTokens: bucket.outputTokens,
    totalTokens: rates.totalTokens,
    cacheHitRate: rates.cacheHitRate,
    avgTokensPerSec: rates.avgTokensPerSec,
    timedStepCount: bucket.timedStepCount,
    byModel,
  };
}

/**
 * Bucket all turns of matched sessions into time slices. Turns from earlier than
 * `windowStartMs` inside a matched session are placed into a leading carry-over bucket
 * so that bucket sums always equal the window totals.
 */
export function buildTimelineBuckets(
  window: TimeWindowKey,
  windowStartMs: number,
  now: number,
  matched: SessionAnalysis[],
  grouping: ModelGrouping = 'family',
): TimelineBucket[] {
  const regular = createRegularBuckets(window, windowStartMs, now);
  const carryOver = createMutableBucket(
    'carryover',
    '更早延续',
    windowStartMs,
    windowStartMs,
    true,
  );

  for (const analysis of matched) {
    const fallbackTs = analysis.metrics.lastActivityAt;
    for (const sample of analysis.turnSamples) {
      const ts = sample.timestampMs ?? fallbackTs;
      let target: MutableBucket;
      if (ts < windowStartMs) {
        target = carryOver;
        if (ts > 0 && ts < carryOver.startMs) {
          carryOver.startMs = ts;
        }
      } else {
        target = regular[regular.length - 1];
        for (let i = 0; i < regular.length - 1; i++) {
          if (ts < regular[i].endMs) {
            target = regular[i];
            break;
          }
        }
      }

      target.stepCount += 1;
      target.cacheReadTokens += sample.cacheReadTokens;
      target.uncachedInputTokens += sample.inputTokens;
      target.outputTokens += sample.outputTokens;
      const stepTotal = sample.totalInputTokens + sample.outputTokens;
      if (stepTotal > 0) {
        const modelKey = resolveModelGroupKey(sample.model, grouping);
        target.byModelTokens.set(
          modelKey,
          (target.byModelTokens.get(modelKey) ?? 0) + stepTotal,
        );
      }
      if (sample.durationMs !== null && sample.durationMs > 0 && sample.outputTokens > 0) {
        target.timedOutputTokens += sample.outputTokens;
        target.timedDurationMs += sample.durationMs;
        target.timedStepCount += 1;
      }
    }
  }

  const out: TimelineBucket[] = [];
  if (carryOver.stepCount > 0) {
    out.push(toTimelineBucket(carryOver));
  }
  for (const bucket of regular) {
    out.push(toTimelineBucket(bucket));
  }
  return out;
}

function filterSessionAnalysisByModel(
  analysis: SessionAnalysis,
  modelFilter: string,
  grouping: ModelGrouping,
): SessionAnalysis | null {
  const matchedSamples: CompactTurnSample[] = [];
  let uncached = 0;
  let cached = 0;
  let output = 0;
  let timedOut = 0;
  let timedMs = 0;
  let timedSteps = 0;
  let hookTimed = 0;
  let transcriptTimed = 0;
  let recentRate: number | null = null;
  let activeModel: string | null = null;
  const modelsUsedSet = new Set<string>();
  const modelsUsed: string[] = [];

  for (const sample of analysis.turnSamples) {
    if (resolveModelGroupKey(sample.model, grouping) !== modelFilter) {
      continue;
    }
    matchedSamples.push(sample);
    uncached += sample.inputTokens;
    cached += sample.cacheReadTokens;
    output += sample.outputTokens;
    recentRate =
      sample.totalInputTokens > 0
        ? clampUnit(sample.cacheReadTokens / sample.totalInputTokens)
        : null;
    if (sample.model && sample.model !== 'unknown') {
      activeModel = sample.model;
      if (!modelsUsedSet.has(sample.model)) {
        modelsUsedSet.add(sample.model);
        modelsUsed.push(sample.model);
      }
    }
    if (sample.durationMs !== null && sample.durationMs > 0 && sample.outputTokens > 0) {
      timedOut += sample.outputTokens;
      timedMs += sample.durationMs;
      timedSteps += 1;
      if (sample.speedSource === 'hook') hookTimed += 1;
      else if (sample.speedSource === 'transcript') transcriptTimed += 1;
    }
  }

  if (matchedSamples.length === 0) {
    return null;
  }

  const totalInput = uncached + cached;
  const totalTokens = totalInput + output;
  const sessionCacheHitRate =
    totalInput > 0 ? clampUnit(cached / totalInput) : null;
  const avgTokensPerSec = timedMs > 0 ? timedOut / (timedMs / 1000) : null;
  const speedSource: SpeedSource =
    hookTimed > 0 ? 'hook' : transcriptTimed > 0 ? 'transcript' : 'none';

  return {
    metrics: {
      ...analysis.metrics,
      activeModel,
      modelsUsed,
      stepCount: matchedSamples.length,
      recentCacheHitRate: recentRate,
      sessionCacheHitRate,
      cumulativeInputTokens: totalInput,
      cumulativeCacheReadTokens: cached,
      cumulativeUncachedInputTokens: uncached,
      cumulativeOutputTokens: output,
      cumulativeTotalTokens: totalTokens,
      avgTokensPerSec,
      speedSource,
      timedStepCount: timedSteps,
      timedOutputTokens: timedOut,
      timedDurationMs: timedMs,
      hookTimedStepCount: hookTimed,
      transcriptTimedStepCount: transcriptTimed,
      selectedModel: modelFilter,
      modelGrouping: grouping,
    },
    turnSamples: matchedSamples,
  };
}

function aggregateModels(
  matched: SessionAnalysis[],
  grouping: ModelGrouping,
): ModelAggregate[] {
  return buildModelAggregatesFromSamples(
    matched.map((a) => ({
      conversationId: a.metrics.conversationId,
      samples: a.turnSamples,
    })),
    grouping,
  );
}

function aggregateProjects(matched: SessionAnalysis[]): ProjectAggregate[] {
  const map = new Map<string, { totals: MutableTotals; sessionCount: number }>();

  for (const analysis of matched) {
    const m = analysis.metrics;
    let entry = map.get(m.projectName);
    if (!entry) {
      entry = { totals: createEmptyTotals(), sessionCount: 0 };
      map.set(m.projectName, entry);
    }
    entry.sessionCount += 1;
    entry.totals.stepCount += m.stepCount;
    entry.totals.cacheReadTokens += m.cumulativeCacheReadTokens;
    entry.totals.uncachedInputTokens += m.cumulativeUncachedInputTokens;
    entry.totals.outputTokens += m.cumulativeOutputTokens;
    entry.totals.timedOutputTokens += m.timedOutputTokens;
    entry.totals.timedDurationMs += m.timedDurationMs;
    entry.totals.timedStepCount += m.timedStepCount;
  }

  const list: ProjectAggregate[] = [];
  for (const [projectName, entry] of map.entries()) {
    const rates = finalizeRates(entry.totals);
    list.push({
      projectName,
      sessionCount: entry.sessionCount,
      stepCount: entry.totals.stepCount,
      cacheReadTokens: entry.totals.cacheReadTokens,
      uncachedInputTokens: entry.totals.uncachedInputTokens,
      totalInputTokens: rates.totalInputTokens,
      outputTokens: entry.totals.outputTokens,
      totalTokens: rates.totalTokens,
      cacheHitRate: rates.cacheHitRate,
      avgTokensPerSec: rates.avgTokensPerSec,
      timedStepCount: entry.totals.timedStepCount,
    });
  }

  return list.sort(
    (a, b) =>
      b.totalTokens - a.totalTokens ||
      b.sessionCount - a.sessionCount ||
      a.projectName.localeCompare(b.projectName),
  );
}

function buildComparisons(
  analyses: SessionAnalysis[],
  now: number,
): WindowComparisonItem[] {
  return WINDOW_ORDER.map((win) => {
    const cfg = WINDOW_CONFIG[win];
    const startMs = now - cfg.durationMs;
    const rollup = rollupMatchedSessions(analyses, startMs, now);
    const rates = finalizeRates(rollup.totals);
    return {
      window: win,
      label: cfg.label,
      durationMs: cfg.durationMs,
      sessionCount: rollup.matched.length,
      stepCount: rollup.totals.stepCount,
      totalTokens: rates.totalTokens,
      totalInputTokens: rates.totalInputTokens,
      totalCacheReadTokens: rollup.totals.cacheReadTokens,
      totalUncachedInputTokens: rollup.totals.uncachedInputTokens,
      totalOutputTokens: rollup.totals.outputTokens,
      overallCacheHitRate: rates.cacheHitRate,
      avgTokensPerSec: rates.avgTokensPerSec,
      timedStepCount: rollup.totals.timedStepCount,
    };
  });
}

function toWindowSessionItem(metrics: SessionMetrics): WindowSessionItem {
  return {
    conversationId: metrics.conversationId,
    projectName: metrics.projectName,
    sessionTitle: metrics.sessionTitle,
    projectPath: metrics.projectPath,
    activeModel: metrics.activeModel,
    modelsUsed: metrics.modelsUsed,
    isLive: metrics.isLive,
    firstActivityAt: metrics.firstActivityAt,
    lastActivityAt: metrics.lastActivityAt,
    lastUpdatedAt: metrics.lastUpdatedAt,
    stepCount: metrics.stepCount,
    timedStepCount: metrics.timedStepCount,
    cumulativeCacheReadTokens: metrics.cumulativeCacheReadTokens,
    cumulativeUncachedInputTokens: metrics.cumulativeUncachedInputTokens,
    cumulativeInputTokens: metrics.cumulativeInputTokens,
    cumulativeOutputTokens: metrics.cumulativeOutputTokens,
    cumulativeTotalTokens: metrics.cumulativeTotalTokens,
    sessionCacheHitRate: metrics.sessionCacheHitRate,
    avgTokensPerSec: metrics.avgTokensPerSec,
    speedSource: metrics.speedSource,
  };
}

/**
 * Compute aggregate statistics and visual chart breakdowns for all sessions
 * triggered within the requested time window (`5h`, `1d`, or `7d`), optionally
 * filtered to a single model key under the chosen model grouping mode.
 */
export function computeWindowSummary(options: {
  window: TimeWindowKey;
  analyses: SessionAnalysis[];
  modelFilter?: string | null;
  modelGrouping?: ModelGrouping;
  now?: number;
}): WindowSummaryPayload {
  const now = options.now ?? Date.now();
  const win = options.window;
  const cfg = WINDOW_CONFIG[win];
  const windowStartMs = now - cfg.durationMs;
  const grouping: ModelGrouping = options.modelGrouping ?? 'family';
  const selectedModel = options.modelFilter?.trim() || null;

  const windowRollup = rollupMatchedSessions(options.analyses, windowStartMs, now);
  const unfilteredRates = finalizeRates(windowRollup.totals);
  const allModels = aggregateModels(windowRollup.matched, grouping);

  const scopedAnalyses = selectedModel
    ? options.analyses
        .map((a) => filterSessionAnalysisByModel(a, selectedModel, grouping))
        .filter((a): a is SessionAnalysis => a !== null)
    : options.analyses;

  const rollup = selectedModel
    ? rollupMatchedSessions(scopedAnalyses, windowStartMs, now)
    : windowRollup;
  const rates = selectedModel ? finalizeRates(rollup.totals) : unfilteredRates;

  const models = selectedModel
    ? aggregateModels(rollup.matched, grouping)
    : allModels;
  const projects = aggregateProjects(rollup.matched);
  const timeline = buildTimelineBuckets(
    win,
    windowStartMs,
    now,
    rollup.matched,
    grouping,
  );
  const comparisons = buildComparisons(scopedAnalyses, now);

  const sortedSessions = rollup.matched
    .map((a) => toWindowSessionItem(a.metrics))
    .sort(
      (a, b) =>
        b.lastActivityAt - a.lastActivityAt ||
        b.lastUpdatedAt - a.lastUpdatedAt ||
        a.conversationId.localeCompare(b.conversationId),
    );

  return {
    view: 'summary',
    window: win,
    windowLabel: cfg.label,
    windowStartMs,
    windowEndMs: now,
    serverTime: now,
    hasLiveSession: rollup.hasLiveSession,
    sessionCount: rollup.matched.length,
    totalMatchedSessionCount: rollup.matched.length,
    projectCount: projects.length,
    modelCount: models.length,
    stepCount: rollup.totals.stepCount,
    timedStepCount: rollup.totals.timedStepCount,
    hookTimedStepCount: rollup.hookTimedStepCount,
    transcriptTimedStepCount: rollup.transcriptTimedStepCount,
    totalCacheReadTokens: rollup.totals.cacheReadTokens,
    totalUncachedInputTokens: rollup.totals.uncachedInputTokens,
    totalInputTokens: rates.totalInputTokens,
    totalOutputTokens: rollup.totals.outputTokens,
    totalTokens: rates.totalTokens,
    overallCacheHitRate: rates.cacheHitRate,
    avgTokensPerSec: rates.avgTokensPerSec,
    speedSource: rollup.speedSource,
    selectedModel,
    modelGrouping: grouping,
    unfilteredTotalTokens: unfilteredRates.totalTokens,
    unfilteredSessionCount: windowRollup.matched.length,
    allModels,
    comparisons,
    timeline,
    models,
    projects,
    sessions: sortedSessions.slice(0, MAX_WINDOW_SESSIONS_RETURNED),
  };
}
