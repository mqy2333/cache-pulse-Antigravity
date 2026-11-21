# Cache Pulse Antigravity

**English** | [简体中文](README.zh-CN.md)

**Real-time prompt cache hit rate, task throughput, per-model usage breakdown, and 5h / 1d / 7d multi-session telemetry plugin for Antigravity.**

Cache Pulse Antigravity provides an interactive dashboard (MCP Apps sidecar/inline UI + Lifecycle Hooks) so you can inspect how well prompt caching works on every turn, compare models side-by-side, and monitor total token consumption across time windows — **100% locally with zero network telemetry**.

---

## Features

- **Bilingual UI (`EN / 中`)**: Automatically follows your Antigravity / OS locale (English by default, Simplified Chinese for `zh*` locales) with an instant `EN / 中` toggle button in the top bar.
- **Single-Session Live Monitor**:
  - Real-time **Cache Hit Rate**, cached vs. uncached input vs. output composition bar, and per-turn dual-axis chart.
  - Human-readable **session / task titles** (resolved from conversation annotations and first user prompt) next to project names so multiple sessions in the same workspace are easy to tell apart.
  - Per-turn call table with model tag, cached/new split, output tokens, and speed (`tok/s`).
  - `Detail` vs. `Compact` header mode and light/dark theme integration with Antigravity.
- **5h / 1d / 7d Multi-Session Overview**:
  - Aggregates all sessions touched within `Last 5h`, `Last 24h`, or `Last 7d` (including each touched session's full token history).
  - Visualizes **Total Tokens**, **Overall Cache Hit Rate**, **Avg Task Speed (`tok/s`)**, period comparison (`5h` vs `24h` vs `7d`), donut breakdown (`By Model` / `By Token`), bucketed timeline chart, model/project benchmark bars, efficiency scatter plot (`Hit Rate × Speed`), and a sortable session list with click-to-inspect.
- **Per-Model Breakdown & Filtering**:
  - Supports **Merged** grouping (merges thinking/effort tiers of the same model) and **Exact** raw model variants.
  - Filter any session view or time-window overview down to a single model with one click.
- **Millisecond Hook Timing**:
  - Lifecycle Hooks (`SessionStart`, `PreInvocation`, `PostInvocation`, `Stop`) record per-turn latency locally and combine with transcript timestamp estimation for accurate throughput (`tok/s`).

---

## Privacy & Local-Only Design

- Reads only local Antigravity conversation transcripts (`~/.gemini/antigravity/conversations`) and conversation metadata (`~/.gemini/antigravity/annotations`), plus local Hook timing files stored in Antigravity's `${PLUGIN_DATA}` directory.
- Makes **zero** outbound network requests and never collects or transmits user prompts or credentials.

---

## Installation

### Option 1: Install via Antigravity CLI

```bash
agy plugin install https://github.com/mqy2333/cache-pulse-Antigravity
```

Pre-built bundles (`dist/server.cjs`, `dist/app.html`, `scripts/hook-capture.cjs`) are committed at the repository root, so installing directly from GitHub requires no extra build step.

### Option 2: Manual / Git Clone Install

**macOS / Linux:**

```bash
git clone https://github.com/mqy2333/cache-pulse-Antigravity.git ~/.gemini/config/plugins/cache-pulse
```

**Windows (PowerShell):**

```powershell
git clone https://github.com/mqy2333/cache-pulse-Antigravity.git "$env:USERPROFILE\.gemini\config\plugins\cache-pulse"
```

Then reload MCP plugins in Antigravity Desktop (or restart Antigravity) to activate `cache-pulse`.

> Requirement: **Node.js 20+** on your system `PATH` (used to run `dist/server.cjs` and `scripts/hook-capture.cjs`).

---

## Usage

Once installed, open the Cache Pulse Antigravity UI by asking Antigravity any of the built-in prompts:

- *"Open the Cache Pulse monitor for the current session"*
- *"Show my Cache Pulse 24h usage summary and per-model breakdown"*
- *"Check my 7-day prompt cache hit rate and task speed"*

You can switch anytime inside the UI between:
- **Session** / **Overview (`5h`, `24h`, `7d`)**
- **Merged** / **Exact** model grouping + interactive model filter pills
- **Detail** / **Compact** layout
- **`EN` / `中`** language toggle

---

## Metric Formulas

- **Prompt Cache Hit Rate**: `cache_read_tokens / (cache_read_tokens + uncached_input_tokens)` (when denominator > 0).
- **Task Speed (`tok/s`)**: weighted output tokens divided by measured turn duration (prioritizing millisecond Hook timing `PostInvocation - PreInvocation`, falling back to adjacent transcript step intervals).
- **Window Summary Scope (`5h` / `1d` / `7d`)**: any session whose activity overlaps the selected window has its full session metrics summed into the window total; timeline buckets group individual turns chronologically (turns from before the window are bucketed under `Earlier`).

---

## Development

```bash
npm install
npm run typecheck
npm run build
npm test
```

To build and hot-deploy to your local `~/.gemini/config/plugins/cache-pulse` directory:

```bash
npm run deploy
```

---

## License

[MIT](LICENSE) © 2026 [mqy2333](https://github.com/mqy2333)
