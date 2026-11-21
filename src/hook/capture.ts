import * as fs from 'node:fs';
import { deriveProjectName, parseTranscriptLines } from '../shared/parser.js';
import {
  readHookSessionState,
  resolveDefaultBrainDir,
  resolveDefaultDataDir,
  resolveTranscriptPath,
  sanitizeConversationId,
  writeActivePointer,
  writeHookSessionState,
} from '../shared/store.js';
import type { HookSessionState } from '../shared/types.js';

interface HookPayload {
  hookEventName?: string;
  conversationId?: string;
  workspacePaths?: string[];
  transcriptPath?: string;
  modelName?: string;
  cwd?: string;
  invocationNum?: number;
  initialNumSteps?: number;
  terminationReason?: string;
}

function readStdinSync(): string {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function findTargetStepToTime(
  transcriptPath: string | null,
  existingTimings: HookSessionState['timings'],
  initialNumSteps?: number,
): { stepIndex: number; outputTokens: number } | null {
  if (!transcriptPath) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return null;
  }

  const steps = parseTranscriptLines(raw);
  const minStepIndex =
    typeof initialNumSteps === 'number' && Number.isFinite(initialNumSteps)
      ? Math.max(0, initialNumSteps - 1)
      : 0;

  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step.type !== 'PLANNER_RESPONSE') continue;
    if (step.step_index < minStepIndex) break;
    if (existingTimings[String(step.step_index)]) continue;

    return {
      stepIndex: step.step_index,
      outputTokens:
        typeof step.output_tokens === 'number' &&
        Number.isFinite(step.output_tokens)
          ? step.output_tokens
          : 0,
    };
  }

  return null;
}

function run(): void {
  const rawInput = readStdinSync().trim();
  if (!rawInput) {
    process.stdout.write('{}');
    return;
  }

  const payload = JSON.parse(rawInput) as HookPayload;
  const conversationId = sanitizeConversationId(payload.conversationId);
  if (!conversationId) {
    process.stdout.write('{}');
    return;
  }

  const now = Date.now();
  const dataDir = resolveDefaultDataDir();
  const brainDir = resolveDefaultBrainDir();
  const existing = readHookSessionState(dataDir, conversationId);

  const workspacePaths =
    Array.isArray(payload.workspacePaths) && payload.workspacePaths.length > 0
      ? payload.workspacePaths.filter(
          (item): item is string => typeof item === 'string' && item.trim() !== '',
        )
      : (existing?.workspacePaths ?? []);

  const cwd =
    typeof payload.cwd === 'string' && payload.cwd.trim()
      ? payload.cwd.trim()
      : existing?.cwd;

  const transcriptPath =
    typeof payload.transcriptPath === 'string' && payload.transcriptPath.trim()
      ? payload.transcriptPath.trim()
      : existing?.transcriptPath;

  const modelName =
    typeof payload.modelName === 'string' &&
    payload.modelName.trim() &&
    payload.modelName.trim().toLowerCase() !== 'auto'
      ? payload.modelName.trim()
      : existing?.modelName;

  const projectName =
    deriveProjectName(workspacePaths[0]) ||
    deriveProjectName(cwd) ||
    existing?.projectName;

  const state: HookSessionState = {
    conversationId,
    workspacePaths,
    cwd,
    projectName,
    transcriptPath,
    modelName,
    updatedAt: now,
    pendingInvocation: existing?.pendingInvocation,
    timings: existing?.timings ?? {},
  };

  const eventName = payload.hookEventName ?? '';

  if (eventName === 'SessionStart') {
    writeActivePointer(dataDir, conversationId, now);
  } else if (eventName === 'PreInvocation') {
    state.pendingInvocation = {
      startedAt: now,
      invocationNum:
        typeof payload.invocationNum === 'number'
          ? payload.invocationNum
          : undefined,
      initialNumSteps:
        typeof payload.initialNumSteps === 'number'
          ? payload.initialNumSteps
          : undefined,
    };
    writeActivePointer(dataDir, conversationId, now);
  } else if (eventName === 'PostInvocation' || eventName === 'Stop') {
    const pending = state.pendingInvocation;
    if (pending && typeof pending.startedAt === 'number') {
      const durationMs = now - pending.startedAt;
      if (durationMs >= 200 && durationMs <= 600_000) {
        const resolvedTranscript = resolveTranscriptPath(
          brainDir,
          conversationId,
          state,
        );
        const target = findTargetStepToTime(
          resolvedTranscript,
          state.timings,
          pending.initialNumSteps,
        );
        if (target) {
          state.timings[String(target.stepIndex)] = {
            stepIndex: target.stepIndex,
            durationMs,
            outputTokens: target.outputTokens,
            recordedAt: now,
          };
          state.pendingInvocation = undefined;
        } else if (eventName === 'Stop') {
          state.pendingInvocation = undefined;
        }
      } else {
        state.pendingInvocation = undefined;
      }
    }
    if (eventName === 'Stop') {
      state.pendingInvocation = undefined;
    }
  }

  writeHookSessionState(dataDir, state);
  process.stdout.write('{}');
}

try {
  run();
} catch {
  // Hooks must never block or fail the agent loop.
  process.stdout.write('{}');
}
