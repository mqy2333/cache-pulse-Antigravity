"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/hook/capture.ts
var fs2 = __toESM(require("node:fs"), 1);

// src/shared/parser.ts
function toNonNegativeNumber(val) {
  if (typeof val !== "number" || !Number.isFinite(val) || val < 0) {
    return 0;
  }
  return val;
}
function deriveProjectName(rawPath) {
  if (!rawPath || typeof rawPath !== "string") {
    return null;
  }
  let cleaned = rawPath.trim();
  if (!cleaned) {
    return null;
  }
  if (cleaned.startsWith("file://")) {
    try {
      const url = new URL(cleaned);
      cleaned = decodeURIComponent(url.pathname);
      if (/^\/[a-zA-Z]:/.test(cleaned)) {
        cleaned = cleaned.slice(1);
      }
    } catch {
    }
  }
  const normalized = cleaned.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized || /^[a-zA-Z]:$/.test(normalized)) {
    return normalized || null;
  }
  const idx = normalized.lastIndexOf("/");
  const base = idx >= 0 ? normalized.slice(idx + 1) : normalized;
  return base || null;
}
var utf8Decoder = new TextDecoder("utf-8");
function parseTranscriptLines(raw) {
  if (!raw) return [];
  const steps = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed !== "object" || parsed === null) continue;
      obj = parsed;
    } catch {
      continue;
    }
    if (typeof obj.step_index !== "number" || !Number.isFinite(obj.step_index)) {
      continue;
    }
    if (typeof obj.type !== "string" || !obj.type) {
      continue;
    }
    steps.push({
      step_index: obj.step_index,
      type: obj.type,
      status: typeof obj.status === "string" ? obj.status : void 0,
      created_at: typeof obj.created_at === "string" ? obj.created_at : void 0,
      model: typeof obj.model === "string" ? obj.model : void 0,
      input_tokens: typeof obj.input_tokens === "number" ? toNonNegativeNumber(obj.input_tokens) : void 0,
      cache_read_tokens: typeof obj.cache_read_tokens === "number" ? toNonNegativeNumber(obj.cache_read_tokens) : void 0,
      output_tokens: typeof obj.output_tokens === "number" ? toNonNegativeNumber(obj.output_tokens) : void 0,
      content: obj.type === "USER_INPUT" && typeof obj.content === "string" ? obj.content.slice(0, 600) : void 0
    });
  }
  return steps;
}

// src/shared/store.ts
var fs = __toESM(require("node:fs"), 1);
var os = __toESM(require("node:os"), 1);
var path = __toESM(require("node:path"), 1);

// src/shared/aggregator.ts
var WINDOW_CONFIG = {
  "5h": {
    label: "\u8FD1 5 \u5C0F\u65F6",
    shortLabel: "5h",
    durationMs: 5 * 60 * 60 * 1e3
  },
  "1d": {
    label: "\u8FD1 24 \u5C0F\u65F6",
    shortLabel: "1d",
    durationMs: 24 * 60 * 60 * 1e3
  },
  "7d": {
    label: "\u8FD1 7 \u5929",
    shortLabel: "7d",
    durationMs: 7 * 24 * 60 * 60 * 1e3
  }
};

// src/shared/store.ts
var SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1e3;
var ONE_DAY_MS = 24 * 60 * 60 * 1e3;
var SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;
var SLEEP_ARR = typeof SharedArrayBuffer !== "undefined" ? new Int32Array(new SharedArrayBuffer(4)) : null;
function syncSleepMs(ms) {
  if (SLEEP_ARR) {
    try {
      Atomics.wait(SLEEP_ARR, 0, 0, ms);
      return;
    } catch {
    }
  }
  const end = Date.now() + ms;
  while (Date.now() < end) {
  }
}
function sanitizeConversationId(id) {
  if (typeof id !== "string") return null;
  const trimmed = id.trim();
  if (!trimmed || trimmed.length > 128 || !SAFE_ID_RE.test(trimmed)) {
    return null;
  }
  return trimmed;
}
function resolveDefaultDataDir() {
  return process.env.PLUGIN_DATA?.trim() || path.join(
    os.homedir(),
    ".gemini",
    "antigravity",
    "plugin_data",
    "cache-pulse"
  );
}
function resolveDefaultBrainDir() {
  return process.env.CACHE_PULSE_BRAIN_DIR?.trim() || path.join(os.homedir(), ".gemini", "antigravity", "brain");
}
function readJsonSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const suffix = `${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
  const tmpPath = `${filePath}.tmp.${suffix}`;
  const payload = JSON.stringify(data);
  try {
    fs.writeFileSync(tmpPath, payload, "utf8");
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        fs.renameSync(tmpPath, filePath);
        return;
      } catch (err) {
        const code = err?.code;
        if ((code === "EPERM" || code === "EBUSY" || code === "EACCES") && attempt < maxAttempts - 1) {
          syncSleepMs(12 * (attempt + 1));
          continue;
        }
        if (code === "EPERM" || code === "EBUSY" || code === "EACCES") {
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
    }
  }
}
function getHookSessionFilePath(dataDir, conversationId) {
  const safeId = sanitizeConversationId(conversationId);
  if (!safeId) return null;
  return path.join(dataDir, "sessions", `${safeId}.json`);
}
function readHookSessionState(dataDir, conversationId) {
  const filePath = getHookSessionFilePath(dataDir, conversationId);
  if (!filePath) return null;
  const parsed = readJsonSafe(filePath);
  if (!parsed || typeof parsed !== "object") return null;
  if (!parsed.timings || typeof parsed.timings !== "object") {
    parsed.timings = {};
  }
  if (!Array.isArray(parsed.workspacePaths)) {
    parsed.workspacePaths = [];
  }
  return parsed;
}
function writeHookSessionState(dataDir, state) {
  const filePath = getHookSessionFilePath(dataDir, state.conversationId);
  if (!filePath) return;
  writeJsonAtomic(filePath, state);
}
function writeActivePointer(dataDir, conversationId, updatedAt) {
  const safeId = sanitizeConversationId(conversationId);
  if (!safeId) return;
  const pointerPath = path.join(dataDir, "active.json");
  writeJsonAtomic(pointerPath, { conversationId: safeId, updatedAt });
}
function resolveTranscriptPath(brainDir, conversationId, hookState) {
  const safeId = sanitizeConversationId(conversationId);
  if (!safeId) return null;
  if (hookState?.transcriptPath) {
    try {
      if (fs.existsSync(hookState.transcriptPath)) {
        return hookState.transcriptPath;
      }
    } catch {
    }
  }
  const fallback = path.join(
    brainDir,
    safeId,
    ".system_generated",
    "logs",
    "transcript.jsonl"
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

// src/hook/capture.ts
function readStdinSync() {
  try {
    return fs2.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}
function findTargetStepToTime(transcriptPath, existingTimings, initialNumSteps) {
  if (!transcriptPath) return null;
  let raw;
  try {
    raw = fs2.readFileSync(transcriptPath, "utf8");
  } catch {
    return null;
  }
  const steps = parseTranscriptLines(raw);
  const minStepIndex = typeof initialNumSteps === "number" && Number.isFinite(initialNumSteps) ? Math.max(0, initialNumSteps - 1) : 0;
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step.type !== "PLANNER_RESPONSE") continue;
    if (step.step_index < minStepIndex) break;
    if (existingTimings[String(step.step_index)]) continue;
    return {
      stepIndex: step.step_index,
      outputTokens: typeof step.output_tokens === "number" && Number.isFinite(step.output_tokens) ? step.output_tokens : 0
    };
  }
  return null;
}
function run() {
  const rawInput = readStdinSync().trim();
  if (!rawInput) {
    process.stdout.write("{}");
    return;
  }
  const payload = JSON.parse(rawInput);
  const conversationId = sanitizeConversationId(payload.conversationId);
  if (!conversationId) {
    process.stdout.write("{}");
    return;
  }
  const now = Date.now();
  const dataDir = resolveDefaultDataDir();
  const brainDir = resolveDefaultBrainDir();
  const existing = readHookSessionState(dataDir, conversationId);
  const workspacePaths = Array.isArray(payload.workspacePaths) && payload.workspacePaths.length > 0 ? payload.workspacePaths.filter(
    (item) => typeof item === "string" && item.trim() !== ""
  ) : existing?.workspacePaths ?? [];
  const cwd = typeof payload.cwd === "string" && payload.cwd.trim() ? payload.cwd.trim() : existing?.cwd;
  const transcriptPath = typeof payload.transcriptPath === "string" && payload.transcriptPath.trim() ? payload.transcriptPath.trim() : existing?.transcriptPath;
  const modelName = typeof payload.modelName === "string" && payload.modelName.trim() && payload.modelName.trim().toLowerCase() !== "auto" ? payload.modelName.trim() : existing?.modelName;
  const projectName = deriveProjectName(workspacePaths[0]) || deriveProjectName(cwd) || existing?.projectName;
  const state = {
    conversationId,
    workspacePaths,
    cwd,
    projectName,
    transcriptPath,
    modelName,
    updatedAt: now,
    pendingInvocation: existing?.pendingInvocation,
    timings: existing?.timings ?? {}
  };
  const eventName = payload.hookEventName ?? "";
  if (eventName === "SessionStart") {
    writeActivePointer(dataDir, conversationId, now);
  } else if (eventName === "PreInvocation") {
    state.pendingInvocation = {
      startedAt: now,
      invocationNum: typeof payload.invocationNum === "number" ? payload.invocationNum : void 0,
      initialNumSteps: typeof payload.initialNumSteps === "number" ? payload.initialNumSteps : void 0
    };
    writeActivePointer(dataDir, conversationId, now);
  } else if (eventName === "PostInvocation" || eventName === "Stop") {
    const pending = state.pendingInvocation;
    if (pending && typeof pending.startedAt === "number") {
      const durationMs = now - pending.startedAt;
      if (durationMs >= 200 && durationMs <= 6e5) {
        const resolvedTranscript = resolveTranscriptPath(
          brainDir,
          conversationId,
          state
        );
        const target = findTargetStepToTime(
          resolvedTranscript,
          state.timings,
          pending.initialNumSteps
        );
        if (target) {
          state.timings[String(target.stepIndex)] = {
            stepIndex: target.stepIndex,
            durationMs,
            outputTokens: target.outputTokens,
            recordedAt: now
          };
          state.pendingInvocation = void 0;
        } else if (eventName === "Stop") {
          state.pendingInvocation = void 0;
        }
      } else {
        state.pendingInvocation = void 0;
      }
    }
    if (eventName === "Stop") {
      state.pendingInvocation = void 0;
    }
  }
  writeHookSessionState(dataDir, state);
  process.stdout.write("{}");
}
try {
  run();
} catch {
  process.stdout.write("{}");
}
