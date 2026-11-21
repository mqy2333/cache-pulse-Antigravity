import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { computeWindowSummary } from './aggregator.js';
import {
  analyzeSession,
  computeSessionMetrics,
  deriveProjectName,
  parseAnnotationTitle,
  parseTranscriptLines,
} from './parser.js';
import type {
  ActiveSessionPointer,
  HookSessionState,
  ModelGrouping,
  MonitorPayload,
  SessionAnalysis,
  SessionMetrics,
  SessionSummary,
  TimeWindowKey,
  TranscriptStep,
  WindowSummaryPayload,
} from './types.js';

const MAX_DISCOVERED_SESSIONS = 20;
const MAX_TRANSCRIPT_CACHE_ENTRIES = 64;
const MAX_ANALYSIS_CACHE_ENTRIES = 512;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const LIVE_RECENCY_WINDOW_MS = 20_000;
const LIVE_PENDING_WINDOW_MS = 180_000;
const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;
const SLEEP_ARR =
  typeof SharedArrayBuffer !== 'undefined'
    ? new Int32Array(new SharedArrayBuffer(4))
    : null;

function syncSleepMs(ms: number): void {
  if (SLEEP_ARR) {
    try {
      Atomics.wait(SLEEP_ARR, 0, 0, ms);
      return;
    } catch {
      // Fallback below if Atomics.wait is disallowed on the current thread.
    }
  }
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Brief bounded spin fallback.
  }
}

export function sanitizeConversationId(id: unknown): string | null {
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  if (!trimmed || trimmed.length > 128 || !SAFE_ID_RE.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function resolveDefaultDataDir(): string {
  return (
    process.env.PLUGIN_DATA?.trim() ||
    path.join(
      os.homedir(),
      '.gemini',
      'antigravity',
      'plugin_data',
      'cache-pulse',
    )
  );
}

export function resolveDefaultBrainDir(): string {
  return (
    process.env.CACHE_PULSE_BRAIN_DIR?.trim() ||
    path.join(os.homedir(), '.gemini', 'antigravity', 'brain')
  );
}

export function resolveDefaultAnnotationsDir(brainDir?: string): string {
  const envOverride = process.env.CACHE_PULSE_ANNOTATIONS_DIR?.trim();
  if (envOverride) {
    return envOverride;
  }
  if (brainDir) {
    return path.resolve(brainDir, '..', 'annotations');
  }
  return path.join(os.homedir(), '.gemini', 'antigravity', 'annotations');
}

export function readJsonSafe<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Atomically write JSON using write-temp-then-rename with Windows lock retries.
 */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const suffix = `${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
  const tmpPath = `${filePath}.tmp.${suffix}`;
  const payload = JSON.stringify(data);

  try {
    fs.writeFileSync(tmpPath, payload, 'utf8');

    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        fs.renameSync(tmpPath, filePath);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (
          (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') &&
          attempt < maxAttempts - 1
        ) {
          syncSleepMs(12 * (attempt + 1));
          continue;
        }
        // Final Windows fallback if target is momentarily locked for rename.
        if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
          fs.copyFileSync(tmpPath, filePath);
          return;
        }
        throw err;
      }
    }
  } finally {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch {
      // Ignore temp cleanup failure.
    }
  }
}

export function getHookSessionFilePath(
  dataDir: string,
  conversationId: string,
): string | null {
  const safeId = sanitizeConversationId(conversationId);
  if (!safeId) return null;
  return path.join(dataDir, 'sessions', `${safeId}.json`);
}

export function readHookSessionState(
  dataDir: string,
  conversationId: string,
): HookSessionState | null {
  const filePath = getHookSessionFilePath(dataDir, conversationId);
  if (!filePath) return null;
  const parsed = readJsonSafe<HookSessionState>(filePath);
  if (!parsed || typeof parsed !== 'object') return null;
  if (!parsed.timings || typeof parsed.timings !== 'object') {
    parsed.timings = {};
  }
  if (!Array.isArray(parsed.workspacePaths)) {
    parsed.workspacePaths = [];
  }
  return parsed;
}

export function writeHookSessionState(
  dataDir: string,
  state: HookSessionState,
): void {
  const filePath = getHookSessionFilePath(dataDir, state.conversationId);
  if (!filePath) return;
  writeJsonAtomic(filePath, state);
}

export function readActivePointer(
  dataDir: string,
): ActiveSessionPointer | null {
  const pointerPath = path.join(dataDir, 'active.json');
  const parsed = readJsonSafe<ActiveSessionPointer>(pointerPath);
  if (!parsed || !sanitizeConversationId(parsed.conversationId)) {
    return null;
  }
  return parsed;
}

export function writeActivePointer(
  dataDir: string,
  conversationId: string,
  updatedAt: number,
): void {
  const safeId = sanitizeConversationId(conversationId);
  if (!safeId) return;
  const pointerPath = path.join(dataDir, 'active.json');
  writeJsonAtomic(pointerPath, { conversationId: safeId, updatedAt });
}

export function resolveTranscriptPath(
  brainDir: string,
  conversationId: string,
  hookState?: HookSessionState | null,
): string | null {
  const safeId = sanitizeConversationId(conversationId);
  if (!safeId) return null;

  if (hookState?.transcriptPath) {
    try {
      if (fs.existsSync(hookState.transcriptPath)) {
        return hookState.transcriptPath;
      }
    } catch {
      // Fall through to default brain directory path.
    }
  }

  const fallback = path.join(
    brainDir,
    safeId,
    '.system_generated',
    'logs',
    'transcript.jsonl',
  );
  try {
    if (fs.existsSync(fallback)) {
      return fallback;
    }
  } catch {
    return null;
  }
  return null;
}

interface TranscriptCacheEntry {
  mtimeMs: number;
  size: number;
  steps: TranscriptStep[];
}

interface AnalysisCacheEntry {
  transcriptPath: string | null;
  mtimeMs: number;
  size: number;
  hookUpdatedAt: number;
  hookTimingsCount: number;
  annotationMtimeMs: number;
  annotationSize: number;
  analysis: SessionAnalysis;
}

interface AnnotationCacheEntry {
  mtimeMs: number;
  size: number;
  title: string | null;
}

interface CandidateSession {
  conversationId: string;
  sortTimestamp: number;
  transcriptPath: string | null;
  transcriptMtimeMs: number;
  hookState: HookSessionState | null;
}

export class TelemetryStore {
  private readonly dataDir: string;
  private readonly brainDir: string;
  private readonly annotationsDir: string;
  private readonly transcriptCache = new Map<string, TranscriptCacheEntry>();
  private readonly analysisCache = new Map<string, AnalysisCacheEntry>();
  private readonly annotationCache = new Map<string, AnnotationCacheEntry>();

  constructor(options?: {
    dataDir?: string;
    brainDir?: string;
    annotationsDir?: string;
  }) {
    this.dataDir = options?.dataDir || resolveDefaultDataDir();
    this.brainDir = options?.brainDir || resolveDefaultBrainDir();
    this.annotationsDir =
      options?.annotationsDir || resolveDefaultAnnotationsDir(this.brainDir);
  }

  private readAnnotationTitleCached(
    conversationId: string,
  ): AnnotationCacheEntry {
    const safeId = sanitizeConversationId(conversationId);
    if (!safeId) {
      return { mtimeMs: 0, size: 0, title: null };
    }
    const annPath = path.join(this.annotationsDir, `${safeId}.pbtxt`);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(annPath);
    } catch {
      this.annotationCache.delete(safeId);
      return { mtimeMs: 0, size: 0, title: null };
    }
    if (!stat.isFile()) {
      this.annotationCache.delete(safeId);
      return { mtimeMs: 0, size: 0, title: null };
    }

    const cached = this.annotationCache.get(safeId);
    if (
      cached &&
      cached.mtimeMs === stat.mtimeMs &&
      cached.size === stat.size
    ) {
      return cached;
    }

    let title: string | null = null;
    try {
      const raw = fs.readFileSync(annPath, 'utf8');
      title = parseAnnotationTitle(raw);
    } catch {
      title = null;
    }

    if (this.annotationCache.size >= MAX_ANALYSIS_CACHE_ENTRIES) {
      const oldestKey = this.annotationCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.annotationCache.delete(oldestKey);
      }
    }
    const entry: AnnotationCacheEntry = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      title,
    };
    this.annotationCache.set(safeId, entry);
    return entry;
  }

  private readTranscriptCached(
    transcriptPath: string,
  ): { steps: TranscriptStep[]; mtimeMs: number } | null {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(transcriptPath);
    } catch {
      this.transcriptCache.delete(transcriptPath);
      return null;
    }

    const cached = this.transcriptCache.get(transcriptPath);
    if (
      cached &&
      cached.mtimeMs === stat.mtimeMs &&
      cached.size === stat.size
    ) {
      return { steps: cached.steps, mtimeMs: stat.mtimeMs };
    }

    let raw: string;
    try {
      raw = fs.readFileSync(transcriptPath, 'utf8');
    } catch {
      return null;
    }

    const steps = parseTranscriptLines(raw);
    if (this.transcriptCache.size >= MAX_TRANSCRIPT_CACHE_ENTRIES) {
      const oldestKey = this.transcriptCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.transcriptCache.delete(oldestKey);
      }
    }
    this.transcriptCache.set(transcriptPath, {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      steps,
    });

    return { steps, mtimeMs: stat.mtimeMs };
  }

  private collectAllCandidates(): CandidateSession[] {
    const map = new Map<string, CandidateSession>();

    // 1. Scan hook-tracked sessions.
    const sessionsDir = path.join(this.dataDir, 'sessions');
    try {
      if (fs.existsSync(sessionsDir)) {
        const entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
          const id = sanitizeConversationId(entry.name.slice(0, -5));
          if (!id) continue;
          const hookState = readHookSessionState(this.dataDir, id);
          if (!hookState) continue;
          const hookTs = Number.isFinite(hookState.updatedAt)
            ? hookState.updatedAt
            : 0;
          map.set(id, {
            conversationId: id,
            sortTimestamp: hookTs,
            transcriptPath: null,
            transcriptMtimeMs: 0,
            hookState,
          });
        }
      }
    } catch {
      // Ignore unreadable hook directory.
    }

    // 2. Scan Antigravity brain directories containing transcript.jsonl.
    try {
      if (fs.existsSync(this.brainDir)) {
        const entries = fs.readdirSync(this.brainDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const id = sanitizeConversationId(entry.name);
          if (!id) continue;
          const transcriptPath = path.join(
            this.brainDir,
            id,
            '.system_generated',
            'logs',
            'transcript.jsonl',
          );
          let stat: fs.Stats;
          try {
            stat = fs.statSync(transcriptPath);
          } catch {
            // Skips non-session directories such as tempmediaStorage.
            continue;
          }
          if (!stat.isFile()) continue;

          const existing = map.get(id);
          if (existing) {
            existing.transcriptPath = transcriptPath;
            existing.transcriptMtimeMs = stat.mtimeMs;
            existing.sortTimestamp = Math.max(
              existing.sortTimestamp,
              stat.mtimeMs,
            );
          } else {
            map.set(id, {
              conversationId: id,
              sortTimestamp: stat.mtimeMs,
              transcriptPath,
              transcriptMtimeMs: stat.mtimeMs,
              hookState: null,
            });
          }
        }
      }
    } catch {
      // Ignore unreadable brain directory.
    }

    // Resolve transcript paths for hook-only entries (e.g. non-standard brain location).
    for (const candidate of map.values()) {
      if (!candidate.transcriptPath && candidate.hookState?.transcriptPath) {
        try {
          const stat = fs.statSync(candidate.hookState.transcriptPath);
          if (stat.isFile()) {
            candidate.transcriptPath = candidate.hookState.transcriptPath;
            candidate.transcriptMtimeMs = stat.mtimeMs;
            candidate.sortTimestamp = Math.max(
              candidate.sortTimestamp,
              stat.mtimeMs,
            );
          }
        } catch {
          // Ignore missing transcript file.
        }
      }
    }

    return Array.from(map.values()).sort(
      (a, b) => b.sortTimestamp - a.sortTimestamp,
    );
  }

  private collectCandidates(): CandidateSession[] {
    return this.collectAllCandidates().slice(0, MAX_DISCOVERED_SESSIONS);
  }

  private analyzeCandidateCached(
    candidate: CandidateSession,
    now: number,
  ): SessionAnalysis {
    let effectiveTranscriptPath: string | null = candidate.transcriptPath;
    let mtimeMs = 0;
    let size = 0;

    if (effectiveTranscriptPath) {
      try {
        const stat = fs.statSync(effectiveTranscriptPath);
        if (stat.isFile()) {
          mtimeMs = stat.mtimeMs;
          size = stat.size;
        } else {
          effectiveTranscriptPath = null;
        }
      } catch {
        effectiveTranscriptPath = null;
      }
    }

    const hookUpdatedAt = candidate.hookState?.updatedAt ?? 0;
    const hookTimingsCount = candidate.hookState
      ? Object.keys(candidate.hookState.timings).length
      : 0;
    const ann = this.readAnnotationTitleCached(candidate.conversationId);

    const cached = this.analysisCache.get(candidate.conversationId);
    if (
      cached &&
      cached.transcriptPath === effectiveTranscriptPath &&
      cached.mtimeMs === mtimeMs &&
      cached.size === size &&
      cached.hookUpdatedAt === hookUpdatedAt &&
      cached.hookTimingsCount === hookTimingsCount &&
      cached.annotationMtimeMs === ann.mtimeMs &&
      cached.annotationSize === ann.size
    ) {
      const m = cached.analysis.metrics;
      const hasRecentActivity =
        m.lastUpdatedAt > 0 && now - m.lastUpdatedAt <= LIVE_RECENCY_WINDOW_MS;
      const hasPendingInvocation = Boolean(
        candidate.hookState?.pendingInvocation &&
          now - candidate.hookState.pendingInvocation.startedAt <=
            LIVE_PENDING_WINDOW_MS,
      );
      return {
        metrics: {
          ...m,
          isLive: hasRecentActivity || hasPendingInvocation,
        },
        turnSamples: cached.analysis.turnSamples,
      };
    }

    let steps: TranscriptStep[] = [];
    if (effectiveTranscriptPath) {
      try {
        const raw = fs.readFileSync(effectiveTranscriptPath, 'utf8');
        steps = parseTranscriptLines(raw);
      } catch {
        steps = [];
      }
    }

    const analysis = analyzeSession({
      conversationId: candidate.conversationId,
      steps,
      hookState: candidate.hookState,
      transcriptMtimeMs: mtimeMs > 0 ? mtimeMs : candidate.transcriptMtimeMs,
      sessionTitle: ann.title,
      now,
    });

    if (this.analysisCache.size >= MAX_ANALYSIS_CACHE_ENTRIES) {
      const oldestKey = this.analysisCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.analysisCache.delete(oldestKey);
      }
    }
    this.analysisCache.set(candidate.conversationId, {
      transcriptPath: effectiveTranscriptPath,
      mtimeMs,
      size,
      hookUpdatedAt,
      hookTimingsCount,
      annotationMtimeMs: ann.mtimeMs,
      annotationSize: ann.size,
      analysis,
    });

    return analysis;
  }

  private computeForCandidate(
    candidate: CandidateSession,
    now: number,
    options?: { model?: string; modelGrouping?: ModelGrouping },
  ): SessionMetrics {
    const transcriptData = candidate.transcriptPath
      ? this.readTranscriptCached(candidate.transcriptPath)
      : null;
    const ann = this.readAnnotationTitleCached(candidate.conversationId);

    return computeSessionMetrics({
      conversationId: candidate.conversationId,
      steps: transcriptData?.steps ?? [],
      hookState: candidate.hookState,
      transcriptMtimeMs:
        transcriptData?.mtimeMs ?? candidate.transcriptMtimeMs,
      sessionTitle: ann.title,
      modelFilter: options?.model,
      modelGrouping: options?.modelGrouping,
      now,
    });
  }

  public getSessionMetrics(
    conversationId: string,
    now = Date.now(),
    options?: { model?: string; modelGrouping?: ModelGrouping },
  ): SessionMetrics | null {
    const safeId = sanitizeConversationId(conversationId);
    if (!safeId) return null;

    const hookState = readHookSessionState(this.dataDir, safeId);
    const transcriptPath = resolveTranscriptPath(
      this.brainDir,
      safeId,
      hookState,
    );
    if (!hookState && !transcriptPath) {
      return null;
    }

    const transcriptData = transcriptPath
      ? this.readTranscriptCached(transcriptPath)
      : null;
    const ann = this.readAnnotationTitleCached(safeId);

    return computeSessionMetrics({
      conversationId: safeId,
      steps: transcriptData?.steps ?? [],
      hookState,
      transcriptMtimeMs: transcriptData?.mtimeMs ?? 0,
      sessionTitle: ann.title,
      modelFilter: options?.model,
      modelGrouping: options?.modelGrouping,
      now,
    });
  }

  public getMonitorPayload(options?: {
    sessionId?: string;
    autoFollow?: boolean;
    model?: string;
    modelGrouping?: ModelGrouping;
    now?: number;
  }): MonitorPayload {
    const now = options?.now ?? Date.now();
    const candidates = this.collectCandidates();

    const computedMap = new Map<string, SessionMetrics>();
    const sessions: SessionSummary[] = [];

    for (const candidate of candidates) {
      const metrics = this.computeForCandidate(candidate, now);
      computedMap.set(metrics.conversationId, metrics);
      sessions.push({
        conversationId: metrics.conversationId,
        projectName: metrics.projectName,
        sessionTitle: metrics.sessionTitle,
        lastUpdatedAt: metrics.lastUpdatedAt,
        stepCount: metrics.stepCount,
        cumulativeInputTokens: metrics.cumulativeInputTokens,
        sessionCacheHitRate: metrics.sessionCacheHitRate,
        isLive: metrics.isLive,
      });
    }

    let activeSession: SessionMetrics | null = null;
    const requestedId = sanitizeConversationId(options?.sessionId);

    if (options?.autoFollow !== true && requestedId) {
      activeSession =
        computedMap.get(requestedId) ?? this.getSessionMetrics(requestedId, now);
      if (
        activeSession &&
        !sessions.some((s) => s.conversationId === activeSession!.conversationId)
      ) {
        sessions.unshift({
          conversationId: activeSession.conversationId,
          projectName: activeSession.projectName,
          sessionTitle: activeSession.sessionTitle,
          lastUpdatedAt: activeSession.lastUpdatedAt,
          stepCount: activeSession.stepCount,
          cumulativeInputTokens: activeSession.cumulativeInputTokens,
          sessionCacheHitRate: activeSession.sessionCacheHitRate,
          isLive: activeSession.isLive,
        });
      }
    }

    if (!activeSession) {
      const pointer = readActivePointer(this.dataDir);
      if (pointer) {
        const pointerMetrics =
          computedMap.get(pointer.conversationId) ??
          this.getSessionMetrics(pointer.conversationId, now);
        const topSession = sessions[0];
        if (
          pointerMetrics &&
          (!topSession ||
            pointer.updatedAt + 2_000 >= topSession.lastUpdatedAt)
        ) {
          activeSession = pointerMetrics;
        }
      }
    }

    if (!activeSession && sessions.length > 0) {
      activeSession = computedMap.get(sessions[0].conversationId) ?? null;
    }

    if (activeSession && (options?.model || options?.modelGrouping)) {
      activeSession =
        this.getSessionMetrics(activeSession.conversationId, now, {
          model: options.model,
          modelGrouping: options.modelGrouping,
        }) ?? activeSession;
    }

    return {
      activeSession,
      sessions,
      serverTime: now,
    };
  }

  public getWindowSummary(options?: {
    window?: TimeWindowKey;
    model?: string;
    modelGrouping?: ModelGrouping;
    now?: number;
  }): WindowSummaryPayload {
    const window: TimeWindowKey = options?.window ?? '1d';
    const now = options?.now ?? Date.now();
    const allCandidates = this.collectAllCandidates();
    const useFastSkip = Math.abs(now - Date.now()) < 3_600_000;
    const cutoffMs = now - SEVEN_DAYS_MS - ONE_DAY_MS;

    const analyses: SessionAnalysis[] = [];
    for (const candidate of allCandidates) {
      if (
        useFastSkip &&
        candidate.sortTimestamp > 0 &&
        candidate.sortTimestamp < cutoffMs
      ) {
        continue;
      }
      analyses.push(this.analyzeCandidateCached(candidate, now));
    }

    return computeWindowSummary({
      window,
      analyses,
      modelFilter: options?.model,
      modelGrouping: options?.modelGrouping,
      now,
    });
  }
}

export { deriveProjectName };
