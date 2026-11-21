export type SpeedSource = 'hook' | 'transcript' | 'none';
export type ModelGrouping = 'family' | 'exact';

export interface TranscriptStep {
  step_index: number;
  type: string;
  status?: string;
  created_at?: string;
  model?: string;
  input_tokens?: number;
  cache_read_tokens?: number;
  output_tokens?: number;
  content?: string;
}

export interface HookStepTiming {
  stepIndex: number;
  durationMs: number;
  outputTokens: number;
  recordedAt: number;
}

export interface PendingInvocation {
  startedAt: number;
  invocationNum?: number;
  initialNumSteps?: number;
}

export interface HookSessionState {
  conversationId: string;
  workspacePaths: string[];
  cwd?: string;
  projectName?: string;
  transcriptPath?: string;
  modelName?: string;
  updatedAt: number;
  pendingInvocation?: PendingInvocation;
  timings: Record<string, HookStepTiming>;
}

export interface ActiveSessionPointer {
  conversationId: string;
  updatedAt: number;
}

export interface TurnMetric {
  stepIndex: number;
  createdAt: string;
  model: string;
  inputTokens: number;
  cacheReadTokens: number;
  totalInputTokens: number;
  outputTokens: number;
  cacheHitRate: number | null;
  durationMs: number | null;
  tokensPerSec: number | null;
  speedSource: SpeedSource;
}

export interface SessionMetrics {
  conversationId: string;
  projectName: string;
  sessionTitle: string | null;
  projectPath: string | null;
  activeModel: string | null;
  modelsUsed: string[];
  isLive: boolean;
  lastUpdatedAt: number;
  stepCount: number;
  recentCacheHitRate: number | null;
  sessionCacheHitRate: number | null;
  cumulativeInputTokens: number;
  cumulativeCacheReadTokens: number;
  cumulativeUncachedInputTokens: number;
  cumulativeOutputTokens: number;
  cumulativeTotalTokens: number;
  avgTokensPerSec: number | null;
  speedSource: SpeedSource;
  timedStepCount: number;
  timedOutputTokens: number;
  timedDurationMs: number;
  hookTimedStepCount: number;
  transcriptTimedStepCount: number;
  firstActivityAt: number;
  lastActivityAt: number;
  selectedModel: string | null;
  modelGrouping: ModelGrouping;
  unfilteredTotalTokens: number;
  modelsBreakdown: ModelAggregate[];
  turns: TurnMetric[];
}

export interface SessionSummary {
  conversationId: string;
  projectName: string;
  sessionTitle: string | null;
  lastUpdatedAt: number;
  stepCount: number;
  cumulativeInputTokens: number;
  sessionCacheHitRate: number | null;
  isLive: boolean;
}

export interface MonitorPayload {
  view?: 'session';
  activeSession: SessionMetrics | null;
  sessions: SessionSummary[];
  serverTime: number;
}

export type TimeWindowKey = '5h' | '1d' | '7d';

export interface CompactTurnSample {
  stepIndex: number;
  timestampMs: number | null;
  model: string;
  inputTokens: number;
  cacheReadTokens: number;
  totalInputTokens: number;
  outputTokens: number;
  durationMs: number | null;
  speedSource: SpeedSource;
}

export interface SessionAnalysis {
  metrics: SessionMetrics;
  turnSamples: CompactTurnSample[];
}

export interface WindowComparisonItem {
  window: TimeWindowKey;
  label: string;
  durationMs: number;
  sessionCount: number;
  stepCount: number;
  totalTokens: number;
  totalInputTokens: number;
  totalCacheReadTokens: number;
  totalUncachedInputTokens: number;
  totalOutputTokens: number;
  overallCacheHitRate: number | null;
  avgTokensPerSec: number | null;
  timedStepCount: number;
}

export interface TimelineModelSlice {
  model: string;
  displayName: string;
  totalTokens: number;
}

export interface TimelineBucket {
  key: string;
  label: string;
  startMs: number;
  endMs: number;
  isCarryOver: boolean;
  stepCount: number;
  cacheReadTokens: number;
  uncachedInputTokens: number;
  totalInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheHitRate: number | null;
  avgTokensPerSec: number | null;
  timedStepCount: number;
  byModel: TimelineModelSlice[];
}

export interface ModelAggregate {
  model: string;
  displayName: string;
  variants: string[];
  sessionCount: number;
  stepCount: number;
  cacheReadTokens: number;
  uncachedInputTokens: number;
  totalInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheHitRate: number | null;
  avgTokensPerSec: number | null;
  timedStepCount: number;
}

export interface ProjectAggregate {
  projectName: string;
  sessionCount: number;
  stepCount: number;
  cacheReadTokens: number;
  uncachedInputTokens: number;
  totalInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheHitRate: number | null;
  avgTokensPerSec: number | null;
  timedStepCount: number;
}

export interface WindowSessionItem {
  conversationId: string;
  projectName: string;
  sessionTitle: string | null;
  projectPath: string | null;
  activeModel: string | null;
  modelsUsed: string[];
  isLive: boolean;
  firstActivityAt: number;
  lastActivityAt: number;
  lastUpdatedAt: number;
  stepCount: number;
  timedStepCount: number;
  cumulativeCacheReadTokens: number;
  cumulativeUncachedInputTokens: number;
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
  cumulativeTotalTokens: number;
  sessionCacheHitRate: number | null;
  avgTokensPerSec: number | null;
  speedSource: SpeedSource;
}

export interface WindowSummaryPayload {
  view: 'summary';
  window: TimeWindowKey;
  windowLabel: string;
  windowStartMs: number;
  windowEndMs: number;
  serverTime: number;
  hasLiveSession: boolean;
  sessionCount: number;
  totalMatchedSessionCount: number;
  projectCount: number;
  modelCount: number;
  stepCount: number;
  timedStepCount: number;
  hookTimedStepCount: number;
  transcriptTimedStepCount: number;
  totalCacheReadTokens: number;
  totalUncachedInputTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  overallCacheHitRate: number | null;
  avgTokensPerSec: number | null;
  speedSource: SpeedSource;
  selectedModel: string | null;
  modelGrouping: ModelGrouping;
  unfilteredTotalTokens: number;
  unfilteredSessionCount: number;
  allModels: ModelAggregate[];
  comparisons: WindowComparisonItem[];
  timeline: TimelineBucket[];
  models: ModelAggregate[];
  projects: ProjectAggregate[];
  sessions: WindowSessionItem[];
}
