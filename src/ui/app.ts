import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps';
import {
  detectInitialLang,
  formatCount,
  formatRelativeTimeLocalized,
  formatWindowLabel,
  t,
  type MessageKey,
  type UiLang,
} from './i18n.js';
import {
  extractModelEffortLabel,
  formatModelDisplayName,
  formatPercent,
  formatSpeed,
  formatTokens,
} from '../shared/parser.js';
import type {
  ModelAggregate,
  ModelGrouping,
  MonitorPayload,
  SessionMetrics,
  TimeWindowKey,
  TimelineBucket,
  TurnMetric,
  WindowSessionItem,
  WindowSummaryPayload,
} from '../shared/types.js';

const POLL_INTERVAL_MS = 2_000;
const SUMMARY_POLL_INTERVAL_MS = 5_000;
const SVG_NS = 'http://www.w3.org/2000/svg';

const app = new App({ name: 'Cache Pulse', version: '1.2.0' }, {});

let currentLang: UiLang = detectInitialLang();
let userPinnedLang = false;

let activeView: 'session' | 'summary' = 'session';
let selectedWindow: TimeWindowKey = '1d';
let modelGrouping: ModelGrouping = 'family';
let selectedSummaryModel: string | null = null;
let selectedSessionModel: string | null = null;
let donutMode: 'model' | 'token' = 'model';
let timelineMode: 'model' | 'token' = 'model';
let lastRenderedSessionId: string | null = null;

let latestPayload: MonitorPayload | null = null;
let latestSummary: WindowSummaryPayload | null = null;
let breakdownMode: 'model' | 'project' = 'model';
let sessionSortBy: 'recent' | 'tokens' | 'hitRate' | 'speed' = 'recent';

let selectedSessionId: string | null = null;
let autoFollow = true;
let inFlightCount = 0;
let requestSeq = 0;
let lastSummaryPollAt = 0;
let compactMode = false;
let pollTimer: number | null = null;

// Single-session & shared DOM references
const appShell = document.getElementById('app-shell') as HTMLElement;
const heroSessionContent = document.getElementById('hero-session-content') as HTMLElement;
const heroSummaryContent = document.getElementById('hero-summary-content') as HTMLElement;

const liveDot = document.getElementById('live-dot') as HTMLElement;
const heroProjectName = document.getElementById('hero-project-name') as HTMLElement;
const heroSessionSep = document.getElementById('hero-session-sep') as HTMLElement;
const heroSessionTitle = document.getElementById('hero-session-title') as HTMLElement;
const heroModelFilterPill = document.getElementById('hero-model-filter-pill') as HTMLElement;
const heroSpeedWrap = document.getElementById('hero-speed-wrap') as HTMLElement;
const heroSpeed = document.getElementById('hero-speed') as HTMLElement;
const heroRecentCache = document.getElementById('hero-recent-cache') as HTMLElement;
const heroSessionCache = document.getElementById('hero-session-cache') as HTMLElement;
const heroCumIn = document.getElementById('hero-cum-in') as HTMLElement;
const heroCumOut = document.getElementById('hero-cum-out') as HTMLElement;

const sumLiveDot = document.getElementById('sum-live-dot') as HTMLElement;
const sumHeroWindow = document.getElementById('sum-hero-window') as HTMLElement;
const sumHeroSessionsPill = document.getElementById('sum-hero-sessions-pill') as HTMLElement;
const sumHeroModelPill = document.getElementById('sum-hero-model-pill') as HTMLElement;
const sumHeroSpeedWrap = document.getElementById('sum-hero-speed-wrap') as HTMLElement;
const sumHeroSpeed = document.getElementById('sum-hero-speed') as HTMLElement;
const sumHeroCache = document.getElementById('sum-hero-cache') as HTMLElement;
const sumHeroTotal = document.getElementById('sum-hero-total') as HTMLElement;
const sumHeroIn = document.getElementById('sum-hero-in') as HTMLElement;
const sumHeroOut = document.getElementById('sum-hero-out') as HTMLElement;

const btnViewSession = document.getElementById('btn-view-session') as HTMLButtonElement;
const btnViewSummary = document.getElementById('btn-view-summary') as HTMLButtonElement;
const sessionControls = document.getElementById('session-controls') as HTMLElement;
const windowControls = document.getElementById('window-controls') as HTMLElement;
const windowButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('#window-controls [data-window]'),
);

const sessionSelect = document.getElementById('session-select') as HTMLSelectElement;
const statusChip = document.getElementById('status-chip') as HTMLElement;
const btnModeDetail = document.getElementById('btn-mode-detail') as HTMLButtonElement;
const btnModeCompact = document.getElementById('btn-mode-compact') as HTMLButtonElement;
const btnLang = document.getElementById('btn-lang') as HTMLButtonElement;
const btnRefresh = document.getElementById('btn-refresh') as HTMLButtonElement;

const emptyState = document.getElementById('empty-state') as HTMLElement;
const detailsPanel = document.getElementById('details-panel') as HTMLElement;
const sessionModelBar = document.getElementById('session-model-bar') as HTMLElement;
const sessionModelPills = document.getElementById('session-model-pills') as HTMLElement;
const btnSessGrpFamily = document.getElementById('btn-sess-grp-family') as HTMLButtonElement;
const btnSessGrpExact = document.getElementById('btn-sess-grp-exact') as HTMLButtonElement;
const sessionModelsCard = document.getElementById('session-models-card') as HTMLElement;
const sessionModelsMeta = document.getElementById('session-models-meta') as HTMLElement;
const sessionModelsList = document.getElementById('session-models-list') as HTMLElement;

const kpiHitBadge = document.getElementById('kpi-hit-badge') as HTMLElement;
const kpiCachedVal = document.getElementById('kpi-cached-val') as HTMLElement;
const kpiCachedSub = document.getElementById('kpi-cached-sub') as HTMLElement;
const kpiMissBadge = document.getElementById('kpi-miss-badge') as HTMLElement;
const kpiUncachedVal = document.getElementById('kpi-uncached-val') as HTMLElement;
const kpiUncachedSub = document.getElementById('kpi-uncached-sub') as HTMLElement;
const kpiStepsBadge = document.getElementById('kpi-steps-badge') as HTMLElement;
const kpiOutputVal = document.getElementById('kpi-output-val') as HTMLElement;
const kpiModelSub = document.getElementById('kpi-model-sub') as HTMLElement;

const compTotal = document.getElementById('comp-total') as HTMLElement;
const segCached = document.getElementById('seg-cached') as HTMLElement;
const segUncached = document.getElementById('seg-uncached') as HTMLElement;
const segOutput = document.getElementById('seg-output') as HTMLElement;
const legCached = document.getElementById('leg-cached') as HTMLElement;
const legUncached = document.getElementById('leg-uncached') as HTMLElement;
const legOutput = document.getElementById('leg-output') as HTMLElement;

const chartWrap = document.getElementById('chart-wrap') as HTMLElement;
const trendSvg = document.getElementById('trend-svg') as unknown as SVGSVGElement;
const chartTooltip = document.getElementById('chart-tooltip') as HTMLElement;

const tableMeta = document.getElementById('table-meta') as HTMLElement;
const turnsTbody = document.getElementById('turns-tbody') as HTMLElement;
const footNoteText = document.getElementById('foot-note-text') as HTMLElement;

// Summary view DOM references
const summaryEmptyState = document.getElementById('summary-empty-state') as HTMLElement;
const summaryEmptyDesc = document.getElementById('summary-empty-desc') as HTMLElement;
const btnEmptyClearModel = document.getElementById('btn-empty-clear-model') as HTMLButtonElement;
const btnEmptyTry7d = document.getElementById('btn-empty-try-7d') as HTMLButtonElement;
const summaryPanel = document.getElementById('summary-panel') as HTMLElement;

const sumModelPills = document.getElementById('sum-model-pills') as HTMLElement;
const btnSumGrpFamily = document.getElementById('btn-sum-grp-family') as HTMLButtonElement;
const btnSumGrpExact = document.getElementById('btn-sum-grp-exact') as HTMLButtonElement;

const sumKpiTotalBadge = document.getElementById('sum-kpi-total-badge') as HTMLElement;
const sumKpiTotalVal = document.getElementById('sum-kpi-total-val') as HTMLElement;
const sumKpiTotalSub = document.getElementById('sum-kpi-total-sub') as HTMLElement;
const sumKpiHitBadge = document.getElementById('sum-kpi-hit-badge') as HTMLElement;
const sumKpiHitVal = document.getElementById('sum-kpi-hit-val') as HTMLElement;
const sumKpiHitSub = document.getElementById('sum-kpi-hit-sub') as HTMLElement;
const sumKpiSpeedBadge = document.getElementById('sum-kpi-speed-badge') as HTMLElement;
const sumKpiSpeedVal = document.getElementById('sum-kpi-speed-val') as HTMLElement;
const sumKpiSpeedSub = document.getElementById('sum-kpi-speed-sub') as HTMLElement;
const sumKpiAvgTitle = document.getElementById('sum-kpi-avg-title') as HTMLElement;
const sumKpiAvgBadge = document.getElementById('sum-kpi-avg-badge') as HTMLElement;
const sumKpiAvgVal = document.getElementById('sum-kpi-avg-val') as HTMLElement;
const sumKpiAvgSub = document.getElementById('sum-kpi-avg-sub') as HTMLElement;

const sumDonutTitle = document.getElementById('sum-donut-title') as HTMLElement;
const sumDonutMeta = document.getElementById('sum-donut-meta') as HTMLElement;
const sumDonutToggle = document.getElementById('sum-donut-toggle') as HTMLElement;
const btnDonutModel = document.getElementById('btn-donut-model') as HTMLButtonElement;
const btnDonutToken = document.getElementById('btn-donut-token') as HTMLButtonElement;
const sumDonutSvg = document.getElementById('sum-donut-svg') as unknown as SVGSVGElement;
const sumDonutLegend = document.getElementById('sum-donut-legend') as HTMLElement;

const sumCompareList = document.getElementById('sum-compare-list') as HTMLElement;
const sumTimelineTitle = document.getElementById('sum-timeline-title') as HTMLElement;
const sumTimelineLegend = document.getElementById('sum-timeline-legend') as HTMLElement;
const sumTimelineToggle = document.getElementById('sum-timeline-toggle') as HTMLElement;
const btnTlModel = document.getElementById('btn-tl-model') as HTMLButtonElement;
const btnTlToken = document.getElementById('btn-tl-token') as HTMLButtonElement;
const summaryTimelineWrap = document.getElementById('sum-timeline-wrap') as HTMLElement;
const summaryTimelineSvg = document.getElementById('sum-timeline-svg') as unknown as SVGSVGElement;
const summaryTimelineTooltip = document.getElementById('sum-timeline-tooltip') as HTMLElement;

const sumBreakdownTitle = document.getElementById('sum-breakdown-title') as HTMLElement;
const btnBdModel = document.getElementById('btn-bd-model') as HTMLButtonElement;
const btnBdProject = document.getElementById('btn-bd-project') as HTMLButtonElement;
const sumBreakdownList = document.getElementById('sum-breakdown-list') as HTMLElement;

const summaryScatterWrap = document.getElementById('sum-scatter-wrap') as HTMLElement;
const summaryScatterSvg = document.getElementById('sum-scatter-svg') as unknown as SVGSVGElement;
const summaryScatterTooltip = document.getElementById('sum-scatter-tooltip') as HTMLElement;

const sumTableMeta = document.getElementById('sum-table-meta') as HTMLElement;
const sumSessionSort = document.getElementById('sum-session-sort') as HTMLSelectElement;
const sumSessionsTbody = document.getElementById('sum-sessions-tbody') as HTMLElement;
const sumFootNoteText = document.getElementById('sum-foot-note-text') as HTMLElement;

function applyStaticTranslations(lang: UiLang): void {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-i18n]'))) {
    const key = el.dataset.i18n as MessageKey | undefined;
    if (key) {
      el.textContent = t(lang, key);
    }
  }
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-i18n-title]'))) {
    const key = el.dataset.i18nTitle as MessageKey | undefined;
    if (key) {
      el.title = t(lang, key);
    }
  }
  btnLang.textContent = t(lang, 'langSwitchBtn');
  btnLang.title = t(lang, 'langSwitchTitle');
}

function applyHostContext(ctx?: McpUiHostContext | null): void {
  if (!ctx) return;
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
  }
  if (ctx.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }
  if (!userPinnedLang && ctx.locale) {
    const detected = detectInitialLang(ctx.locale);
    if (detected !== currentLang) {
      currentLang = detected;
      applyStaticTranslations(currentLang);
      if (activeView === 'summary' && latestSummary) {
        renderAllSummary(latestSummary);
      } else if (activeView === 'session' && latestPayload) {
        renderAllSession(latestPayload);
      }
    }
  }
}

function getCacheTone(rate: number | null): 'good' | 'warn' | 'bad' | 'neutral' {
  if (rate === null || !Number.isFinite(rate)) return 'neutral';
  if (rate >= 0.85) return 'good';
  if (rate >= 0.5) return 'warn';
  return 'bad';
}

function setToneClass(
  el: HTMLElement,
  prefix: 'tone' | 'pill',
  tone: 'good' | 'warn' | 'bad' | 'neutral',
): void {
  el.classList.remove(
    `${prefix}-good`,
    `${prefix}-warn`,
    `${prefix}-bad`,
    `${prefix}-neutral`,
  );
  el.classList.add(`${prefix}-${tone}`);
}

function formatExactInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function formatRelativeTime(tsMs: number, nowMs: number): string {
  return formatRelativeTimeLocalized(currentLang, tsMs, nowMs);
}

function formatShortModel(model: string | null): string {
  return formatModelDisplayName(model);
}

function isMonitorPayload(val: unknown): val is MonitorPayload {
  if (typeof val !== 'object' || val === null) return false;
  const obj = val as Record<string, unknown>;
  return (
    obj.view !== 'summary' &&
    Array.isArray(obj.sessions) &&
    typeof obj.serverTime === 'number'
  );
}

function isWindowSummaryPayload(val: unknown): val is WindowSummaryPayload {
  if (typeof val !== 'object' || val === null) return false;
  const obj = val as Record<string, unknown>;
  return (
    obj.view === 'summary' &&
    typeof obj.window === 'string' &&
    Array.isArray(obj.timeline) &&
    Array.isArray(obj.sessions) &&
    Array.isArray(obj.comparisons)
  );
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  return el;
}

function positionTooltip(
  tip: HTMLElement,
  anchorX: number,
  containerWidth: number,
  topPx = 6,
): void {
  tip.classList.remove('hidden');
  const tipWidth = tip.offsetWidth || 185;
  const preferLeft =
    anchorX + 14 + tipWidth > containerWidth
      ? Math.max(4, anchorX - tipWidth - 12)
      : anchorX + 14;
  tip.style.left = `${preferLeft}px`;
  tip.style.top = `${topPx}px`;
}

function appendTooltipRows(
  tip: HTMLElement,
  titleLeft: string,
  titleRight: string,
  rows: Array<[string, string]>,
): void {
  tip.replaceChildren();
  const head = document.createElement('div');
  head.className = 'tt-head';
  const leftEl = document.createElement('span');
  leftEl.textContent = titleLeft;
  const rightEl = document.createElement('span');
  rightEl.textContent = titleRight;
  head.append(leftEl, rightEl);
  tip.appendChild(head);

  for (const [label, val] of rows) {
    const row = document.createElement('div');
    row.className = 'tt-row';
    const lEl = document.createElement('span');
    lEl.textContent = label;
    const vEl = document.createElement('strong');
    vEl.textContent = val;
    row.append(lEl, vEl);
    tip.appendChild(row);
  }
}

function isFallbackProjectName(projectName: string, conversationId: string): boolean {
  return projectName === `会话 ${conversationId.slice(0, 8)}`;
}

function truncateText(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  return `${chars.slice(0, maxChars).join('')}…`;
}

function localizedProjectName(projectName: string, conversationId: string): string {
  if (isFallbackProjectName(projectName, conversationId)) {
    return `${t(currentLang, 'fallbackSessionPrefix')} ${conversationId.slice(0, 8)}`;
  }
  return projectName;
}

function formatSessionLabel(
  projectName: string,
  sessionTitle: string | null | undefined,
  conversationId: string,
  maxTitleChars = 22,
): string {
  if (sessionTitle) {
    if (isFallbackProjectName(projectName, conversationId)) {
      return truncateText(sessionTitle, maxTitleChars + 6);
    }
    return `${projectName} · ${truncateText(sessionTitle, maxTitleChars)}`;
  }
  return localizedProjectName(projectName, conversationId);
}

function getModelColorMap(models: ModelAggregate[]): Map<string, string> {
  const map = new Map<string, string>();
  models.forEach((m, idx) => {
    map.set(m.model, `var(--cp-m-${idx % 8})`);
  });
  return map;
}

function renderModelBadgePill(
  el: HTMLElement,
  modelKey: string | null,
  colorMap: Map<string, string>,
): void {
  el.replaceChildren();
  if (!modelKey) {
    el.classList.add('hidden');
    return;
  }
  const dot = document.createElement('span');
  dot.className = 'model-dot';
  dot.style.background = colorMap.get(modelKey) ?? 'var(--cp-accent)';
  const label = document.createElement('span');
  label.textContent = formatModelDisplayName(modelKey);
  el.append(dot, label);
  el.classList.remove('hidden');
}

function renderModelFilterBar(options: {
  pillsEl: HTMLElement;
  btnFamily: HTMLButtonElement;
  btnExact: HTMLButtonElement;
  models: ModelAggregate[];
  totalTokens: number;
  selectedModel: string | null;
  grouping: ModelGrouping;
  colorMap: Map<string, string>;
  onSelect: (modelKey: string | null) => void;
}): void {
  const {
    pillsEl,
    btnFamily,
    btnExact,
    models,
    totalTokens,
    selectedModel,
    grouping,
    colorMap,
    onSelect,
  } = options;

  btnFamily.classList.toggle('active', grouping === 'family');
  btnExact.classList.toggle('active', grouping === 'exact');
  pillsEl.replaceChildren();

  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'model-pill';
  if (selectedModel === null) {
    allBtn.classList.add('is-active');
  }
  const allName = document.createElement('span');
  allName.className = 'model-pill-name';
  allName.textContent = t(currentLang, 'allModels');
  allBtn.appendChild(allName);
  if (totalTokens > 0) {
    const allStat = document.createElement('span');
    allStat.className = 'model-pill-stat';
    allStat.textContent = formatTokens(totalTokens);
    allBtn.appendChild(allStat);
  }
  allBtn.addEventListener('click', () => {
    if (selectedModel !== null) {
      onSelect(null);
    }
  });
  pillsEl.appendChild(allBtn);

  for (const m of models) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'model-pill';
    if (selectedModel === m.model) {
      pill.classList.add('is-active');
    }
    pill.title =
      m.variants.length > 1
        ? `${m.displayName} (${m.variants.join(', ')})`
        : m.variants[0] || m.displayName;

    const dot = document.createElement('span');
    dot.className = 'model-dot';
    dot.style.background = colorMap.get(m.model) ?? 'var(--cp-m-7)';

    const nameEl = document.createElement('span');
    nameEl.className = 'model-pill-name';
    nameEl.textContent = m.displayName;

    const pct =
      totalTokens > 0 ? Math.round((m.totalTokens / totalTokens) * 100) : 0;
    const statEl = document.createElement('span');
    statEl.className = 'model-pill-stat';
    statEl.textContent = `${formatTokens(m.totalTokens)} · ${pct}%`;

    pill.append(dot, nameEl, statEl);
    pill.addEventListener('click', () => {
      onSelect(selectedModel === m.model ? null : m.model);
    });
    pillsEl.appendChild(pill);
  }
}

function renderModelBenchmarkList(options: {
  container: HTMLElement;
  models: ModelAggregate[];
  totalTokens: number;
  selectedModel: string | null;
  grouping: ModelGrouping;
  colorMap: Map<string, string>;
  showSessionCount: boolean;
  onToggleModel: (modelKey: string) => void;
}): void {
  const {
    container,
    models,
    totalTokens,
    selectedModel,
    grouping,
    colorMap,
    showSessionCount,
    onToggleModel,
  } = options;

  container.replaceChildren();
  if (models.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'breakdown-empty';
    empty.textContent = t(currentLang, 'noModelData');
    container.appendChild(empty);
    return;
  }

  const visible = models.slice(0, 8);
  const maxTotal = Math.max(1, ...visible.map((m) => m.totalTokens));
  const maxSpeed = Math.max(1, ...visible.map((m) => m.avgTokensPerSec ?? 0));

  for (const m of visible) {
    const row = document.createElement('div');
    row.className = 'model-bench-item';
    if (selectedModel === m.model) {
      row.classList.add('is-active');
    }
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    row.title =
      selectedModel === m.model
        ? t(currentLang, 'modelClickReset')
        : t(currentLang, 'modelClickFilter', { name: m.displayName });

    const top = document.createElement('div');
    top.className = 'breakdown-top';

    const nameWrap = document.createElement('div');
    nameWrap.className = 'model-bench-name-wrap';

    const dot = document.createElement('span');
    dot.className = 'model-dot';
    dot.style.background = colorMap.get(m.model) ?? 'var(--cp-m-7)';

    const nameEl = document.createElement('span');
    nameEl.className = 'breakdown-name';
    nameEl.textContent = m.displayName;

    nameWrap.append(dot, nameEl);

    if (grouping === 'family' && m.variants.length > 1) {
      const effortTags = Array.from(
        new Set(
          m.variants
            .map((v) => extractModelEffortLabel(v))
            .filter((x): x is string => Boolean(x)),
        ),
      );
      for (const tag of effortTags.slice(0, 3)) {
        const chip = document.createElement('span');
        chip.className = 'variant-chip';
        chip.textContent = tag;
        nameWrap.appendChild(chip);
      }
    }

    const rightWrap = document.createElement('div');
    rightWrap.className = 'model-bench-right';
    const sharePct = totalTokens > 0 ? (m.totalTokens / totalTokens) * 100 : 0;
    const shareEl = document.createElement('span');
    shareEl.className = 'model-share-tag';
    shareEl.textContent = `${sharePct.toFixed(1)}%`;
    const valEl = document.createElement('span');
    valEl.className = 'breakdown-val';
    valEl.textContent = formatTokens(m.totalTokens);
    rightWrap.append(shareEl, valEl);

    top.append(nameWrap, rightWrap);

    const bar = document.createElement('div');
    bar.className = 'breakdown-bar';
    if (m.totalTokens > 0) {
      const scalePct = (m.totalTokens / maxTotal) * 100;
      const segs: Array<[number, string]> = [
        [(m.cacheReadTokens / m.totalTokens) * scalePct, 'seg-cached'],
        [(m.uncachedInputTokens / m.totalTokens) * scalePct, 'seg-uncached'],
        [(m.outputTokens / m.totalTokens) * scalePct, 'seg-output'],
      ];
      for (const [wPct, cls] of segs) {
        if (wPct <= 0) continue;
        const seg = document.createElement('div');
        seg.className = `comp-seg ${cls}`;
        seg.style.width = `${wPct.toFixed(2)}%`;
        bar.appendChild(seg);
      }
    }

    const speedRow = document.createElement('div');
    speedRow.className = 'speed-bar-row';

    const speedLbl = document.createElement('span');
    speedLbl.textContent = t(currentLang, 'heroSpeed');
    const speedTrack = document.createElement('div');
    speedTrack.className = 'speed-bar-track';
    const speedFill = document.createElement('div');
    speedFill.className = 'speed-bar-fill';
    speedFill.style.background = colorMap.get(m.model) ?? 'var(--cp-accent)';
    const speedPct =
      m.avgTokensPerSec !== null && m.avgTokensPerSec > 0
        ? Math.min(100, (m.avgTokensPerSec / maxSpeed) * 100)
        : 0;
    speedFill.style.width = `${speedPct.toFixed(1)}%`;
    speedTrack.appendChild(speedFill);

    const speedVal = document.createElement('span');
    speedVal.className = 'speed-bar-val';
    speedVal.textContent =
      m.avgTokensPerSec !== null ? `${formatSpeed(m.avgTokensPerSec)} tok/s` : '--';

    const hitPill = document.createElement('span');
    hitPill.className = `pill pill-${getCacheTone(m.cacheHitRate)}`;
    hitPill.textContent = formatPercent(m.cacheHitRate);

    const countEl = document.createElement('span');
    const stepText = formatCount(currentLang, m.stepCount, 'turn');
    countEl.textContent = showSessionCount
      ? `${formatCount(currentLang, m.sessionCount, 'session')} · ${stepText}`
      : stepText;

    speedRow.append(speedLbl, speedTrack, speedVal, hitPill, countEl);

    row.append(top, bar, speedRow);
    const trigger = (): void => onToggleModel(m.model);
    row.addEventListener('click', trigger);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        trigger();
      }
    });
    container.appendChild(row);
  }
}

/* ==========================================================================
   Single-Session View Renderers
   ========================================================================== */

function renderSessionSelector(payload: MonitorPayload): void {
  const active = payload.activeSession;
  const currentValue = autoFollow ? '__auto__' : (selectedSessionId ?? '__auto__');

  sessionSelect.replaceChildren();

  const autoOption = document.createElement('option');
  autoOption.value = '__auto__';
  autoOption.textContent = active
    ? t(currentLang, 'autoFollowLabel', {
        label: formatSessionLabel(
          active.projectName,
          active.sessionTitle,
          active.conversationId,
          16,
        ),
      })
    : t(currentLang, 'autoFollowEmpty');
  sessionSelect.appendChild(autoOption);

  for (const s of payload.sessions) {
    const opt = document.createElement('option');
    opt.value = s.conversationId;
    const rel = formatRelativeTime(s.lastUpdatedAt, payload.serverTime);
    const hit = formatPercent(s.sessionCacheHitRate);
    const label = formatSessionLabel(
      s.projectName,
      s.sessionTitle,
      s.conversationId,
      20,
    );
    const stepText = formatCount(currentLang, s.stepCount, 'turn');
    opt.textContent = `${label} (${stepText} · ${hit} · ${rel})`;
    sessionSelect.appendChild(opt);
  }

  const hasCurrent = Array.from(sessionSelect.options).some(
    (o) => o.value === currentValue,
  );
  sessionSelect.value = hasCurrent ? currentValue : '__auto__';
}

function renderHero(session: SessionMetrics | null, serverTime: number): void {
  if (!session) {
    liveDot.classList.remove('is-live');
    heroProjectName.textContent = t(currentLang, 'heroNoSession');
    heroProjectName.title = '';
    heroSessionSep.classList.add('hidden');
    heroSessionTitle.classList.add('hidden');
    heroSessionTitle.textContent = '';
    heroSessionTitle.title = '';
    heroModelFilterPill.classList.add('hidden');
    heroSpeed.textContent = '--';
    heroRecentCache.textContent = '--';
    heroSessionCache.textContent = '--';
    setToneClass(heroRecentCache, 'tone', 'neutral');
    setToneClass(heroSessionCache, 'tone', 'neutral');
    heroCumIn.textContent = '0';
    heroCumOut.textContent = '0';
    statusChip.textContent = t(currentLang, 'statusWaiting');
    return;
  }

  liveDot.classList.toggle('is-live', session.isLive);
  renderModelBadgePill(
    heroModelFilterPill,
    session.selectedModel,
    getModelColorMap(session.modelsBreakdown),
  );
  const isFallbackProj = isFallbackProjectName(
    session.projectName,
    session.conversationId,
  );
  const displayProj = localizedProjectName(
    session.projectName,
    session.conversationId,
  );
  if (session.sessionTitle) {
    if (isFallbackProj) {
      heroProjectName.textContent = session.sessionTitle;
      heroProjectName.title = `${session.sessionTitle} (${session.conversationId})`;
      heroSessionSep.classList.add('hidden');
      heroSessionTitle.classList.add('hidden');
      heroSessionTitle.textContent = '';
      heroSessionTitle.title = '';
    } else {
      heroProjectName.textContent = displayProj;
      heroProjectName.title = session.projectPath
        ? `${displayProj} (${session.projectPath})`
        : session.conversationId;
      heroSessionSep.classList.remove('hidden');
      heroSessionTitle.classList.remove('hidden');
      heroSessionTitle.textContent = session.sessionTitle;
      heroSessionTitle.title = session.sessionTitle;
    }
  } else {
    heroProjectName.textContent = displayProj;
    heroProjectName.title = session.projectPath
      ? `${displayProj} (${session.projectPath})`
      : session.conversationId;
    heroSessionSep.classList.add('hidden');
    heroSessionTitle.classList.add('hidden');
    heroSessionTitle.textContent = '';
    heroSessionTitle.title = '';
  }

  heroSpeed.textContent = formatSpeed(session.avgTokensPerSec);
  if (session.speedSource === 'hook') {
    heroSpeedWrap.title = t(currentLang, 'heroSpeedTooltipHook');
  } else if (session.speedSource === 'transcript') {
    heroSpeedWrap.title = t(currentLang, 'heroSpeedTooltipTranscript');
  } else {
    heroSpeedWrap.title = t(currentLang, 'heroSpeedTooltipEmpty');
  }

  heroRecentCache.textContent = formatPercent(session.recentCacheHitRate);
  heroSessionCache.textContent = formatPercent(session.sessionCacheHitRate);
  setToneClass(heroRecentCache, 'tone', getCacheTone(session.recentCacheHitRate));
  setToneClass(
    heroSessionCache,
    'tone',
    session.sessionCacheHitRate !== null && session.sessionCacheHitRate < 0.5
      ? 'bad'
      : 'neutral',
  );

  heroCumIn.textContent = formatTokens(session.cumulativeInputTokens);
  heroCumOut.textContent = formatTokens(session.cumulativeOutputTokens);

  statusChip.textContent = session.isLive
    ? t(currentLang, 'statusLive')
    : t(currentLang, 'statusUpdatedAt', {
        rel: formatRelativeTime(session.lastUpdatedAt, serverTime),
      });
}

function renderKpisAndComposition(session: SessionMetrics): void {
  const hitTone = getCacheTone(session.sessionCacheHitRate);
  kpiHitBadge.textContent = formatPercent(session.sessionCacheHitRate);
  setToneClass(kpiHitBadge, 'pill', hitTone);
  kpiCachedVal.textContent = formatTokens(session.cumulativeCacheReadTokens);
  kpiCachedSub.textContent = `${formatExactInt(session.cumulativeCacheReadTokens)} tokens`;

  const missFraction =
    session.sessionCacheHitRate !== null
      ? Math.max(0, 1 - session.sessionCacheHitRate)
      : null;
  kpiMissBadge.textContent = formatPercent(missFraction);
  setToneClass(kpiMissBadge, 'pill', 'neutral');
  kpiUncachedVal.textContent = formatTokens(session.cumulativeUncachedInputTokens);
  kpiUncachedSub.textContent = `${formatExactInt(session.cumulativeUncachedInputTokens)} tokens`;

  kpiStepsBadge.textContent = formatCount(currentLang, session.stepCount, 'turn');
  kpiOutputVal.textContent = formatTokens(session.cumulativeOutputTokens);
  const modelLabel = formatShortModel(session.activeModel);
  kpiModelSub.textContent = `${modelLabel} · ${formatExactInt(session.cumulativeOutputTokens)} out`;
  kpiModelSub.title = session.modelsUsed.join(', ');

  const total = session.cumulativeTotalTokens;
  compTotal.textContent = t(currentLang, 'compTotal', {
    short: formatTokens(total),
    exact: formatExactInt(total),
  });

  if (total > 0) {
    const pctCached = (session.cumulativeCacheReadTokens / total) * 100;
    const pctUncached = (session.cumulativeUncachedInputTokens / total) * 100;
    const pctOutput = Math.max(0, 100 - pctCached - pctUncached);

    segCached.style.width = `${pctCached.toFixed(2)}%`;
    segUncached.style.width = `${pctUncached.toFixed(2)}%`;
    segOutput.style.width = `${pctOutput.toFixed(2)}%`;

    legCached.textContent = `${formatTokens(session.cumulativeCacheReadTokens)} (${pctCached.toFixed(1)}%)`;
    legUncached.textContent = `${formatTokens(session.cumulativeUncachedInputTokens)} (${pctUncached.toFixed(1)}%)`;
    legOutput.textContent = `${formatTokens(session.cumulativeOutputTokens)} (${pctOutput.toFixed(1)}%)`;
  } else {
    segCached.style.width = '0%';
    segUncached.style.width = '0%';
    segOutput.style.width = '0%';
    legCached.textContent = '0';
    legUncached.textContent = '0';
    legOutput.textContent = '0';
  }
}

function showTooltipForTurn(
  turn: TurnMetric,
  xPx: number,
  containerWidth: number,
): void {
  appendTooltipRows(
    chartTooltip,
    `Step #${turn.stepIndex}`,
    formatShortModel(turn.model),
    [
      [t(currentLang, 'ttHitRate'), formatPercent(turn.cacheHitRate)],
      [
        t(currentLang, 'ttCachedNew'),
        `${formatTokens(turn.cacheReadTokens)} / ${formatTokens(turn.inputTokens)}`,
      ],
      [t(currentLang, 'ttOutput'), formatTokens(turn.outputTokens)],
      [
        t(currentLang, 'ttSpeed'),
        turn.tokensPerSec !== null
          ? `${formatSpeed(turn.tokensPerSec)} tok/s`
          : '--',
      ],
    ],
  );
  positionTooltip(chartTooltip, xPx, containerWidth);
}

function renderTrendChart(session: SessionMetrics): void {
  trendSvg.replaceChildren();
  chartTooltip.classList.add('hidden');

  const turns = session.turns;
  const width = Math.max(260, chartWrap.clientWidth || 520);
  const height = 168;
  trendSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  if (turns.length === 0) {
    const emptyText = svgEl('text', {
      x: width / 2,
      y: height / 2,
      'text-anchor': 'middle',
      fill: 'var(--cp-text-subtle)',
      'font-size': 12,
    });
    emptyText.textContent = t(currentLang, 'trendEmpty');
    trendSvg.appendChild(emptyText);
    return;
  }

  const padL = 34;
  const padR = 38;
  const padT = 14;
  const padB = 22;
  const plotW = Math.max(60, width - padL - padR);
  const plotH = height - padT - padB;

  const maxInput = Math.max(1, ...turns.map((t) => t.totalInputTokens));

  for (const frac of [1, 0.5, 0]) {
    const y = padT + (1 - frac) * plotH;
    trendSvg.appendChild(
      svgEl('line', {
        x1: padL,
        y1: y,
        x2: padL + plotW,
        y2: y,
        stroke: 'var(--cp-border-soft)',
        'stroke-dasharray': frac === 0 ? 'none' : '3 3',
        'stroke-width': 1,
      }),
    );
    const label = svgEl('text', {
      x: padL - 6,
      y: y + 3.5,
      'text-anchor': 'end',
      fill: 'var(--cp-text-subtle)',
      'font-size': 10,
    });
    label.textContent = `${Math.round(frac * 100)}%`;
    trendSvg.appendChild(label);
  }

  const rightTopLabel = svgEl('text', {
    x: padL + plotW + 6,
    y: padT + 4,
    'text-anchor': 'start',
    fill: 'var(--cp-text-subtle)',
    'font-size': 10,
  });
  rightTopLabel.textContent = formatTokens(maxInput);
  trendSvg.appendChild(rightTopLabel);

  const count = turns.length;
  const slotW = plotW / count;
  const barW = Math.max(3, Math.min(18, slotW * 0.58));

  const points: Array<{ x: number; y: number; turn: TurnMetric }> = [];

  for (let i = 0; i < count; i++) {
    const turn = turns[i];
    const cx = count === 1 ? padL + plotW / 2 : padL + (i + 0.5) * slotW;
    const barH = (turn.totalInputTokens / maxInput) * plotH;
    const barY = padT + plotH - barH;

    trendSvg.appendChild(
      svgEl('rect', {
        x: cx - barW / 2,
        y: barY,
        width: barW,
        height: Math.max(1, barH),
        rx: 2,
        fill: 'var(--cp-accent-bg)',
        stroke: 'var(--cp-accent)',
        'stroke-opacity': 0.25,
        'stroke-width': 1,
      }),
    );

    if (turn.cacheHitRate !== null) {
      const py = padT + (1 - turn.cacheHitRate) * plotH;
      points.push({ x: cx, y: py, turn });
    }
  }

  if (points.length >= 2) {
    const defs = svgEl('defs', {});
    const grad = svgEl('linearGradient', {
      id: 'cp-area-grad',
      x1: '0',
      y1: '0',
      x2: '0',
      y2: '1',
    });
    grad.appendChild(
      svgEl('stop', {
        offset: '0%',
        'stop-color': 'var(--cp-good-bar)',
        'stop-opacity': '0.22',
      }),
    );
    grad.appendChild(
      svgEl('stop', {
        offset: '100%',
        'stop-color': 'var(--cp-good-bar)',
        'stop-opacity': '0.0',
      }),
    );
    defs.appendChild(grad);
    trendSvg.appendChild(defs);

    const baselineY = padT + plotH;
    const areaD = [
      `M ${points[0].x.toFixed(1)} ${baselineY.toFixed(1)}`,
      ...points.map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`),
      `L ${points[points.length - 1].x.toFixed(1)} ${baselineY.toFixed(1)}`,
      'Z',
    ].join(' ');
    trendSvg.appendChild(
      svgEl('path', {
        d: areaD,
        fill: 'url(#cp-area-grad)',
      }),
    );

    const lineD = points
      .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ');
    trendSvg.appendChild(
      svgEl('path', {
        d: lineD,
        fill: 'none',
        stroke: 'var(--cp-good-bar)',
        'stroke-width': 2,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }),
    );
  }

  const hoverLine = svgEl('line', {
    x1: 0,
    y1: padT,
    x2: 0,
    y2: padT + plotH,
    stroke: 'var(--cp-text-subtle)',
    'stroke-width': 1,
    'stroke-dasharray': '2 2',
    visibility: 'hidden',
  });
  trendSvg.appendChild(hoverLine);

  for (const pt of points) {
    const tone = getCacheTone(pt.turn.cacheHitRate);
    const color =
      tone === 'good'
        ? 'var(--cp-good-bar)'
        : tone === 'warn'
          ? 'var(--cp-warn)'
          : 'var(--cp-bad)';
    trendSvg.appendChild(
      svgEl('circle', {
        cx: pt.x,
        cy: pt.y,
        r: count > 40 ? 2.2 : 3.2,
        fill: color,
        stroke: 'var(--cp-surface-card)',
        'stroke-width': 1.5,
      }),
    );
  }

  const firstLabel = svgEl('text', {
    x: padL,
    y: height - 5,
    'text-anchor': 'start',
    fill: 'var(--cp-text-subtle)',
    'font-size': 10,
  });
  firstLabel.textContent = `#${turns[0].stepIndex}`;
  trendSvg.appendChild(firstLabel);

  if (turns.length > 1) {
    const lastLabel = svgEl('text', {
      x: padL + plotW,
      y: height - 5,
      'text-anchor': 'end',
      fill: 'var(--cp-text-subtle)',
      'font-size': 10,
    });
    lastLabel.textContent = `#${turns[turns.length - 1].stepIndex}`;
    trendSvg.appendChild(lastLabel);
  }

  for (let i = 0; i < count; i++) {
    const turn = turns[i];
    const cx = count === 1 ? padL + plotW / 2 : padL + (i + 0.5) * slotW;
    const zoneX = count === 1 ? padL : padL + i * slotW;
    const zoneW = count === 1 ? plotW : slotW;

    const hitRect = svgEl('rect', {
      x: zoneX,
      y: padT,
      width: Math.max(4, zoneW),
      height: plotH,
      fill: 'transparent',
      style: 'cursor: crosshair;',
    });

    hitRect.addEventListener('mouseenter', () => {
      hoverLine.setAttribute('x1', String(cx));
      hoverLine.setAttribute('x2', String(cx));
      hoverLine.setAttribute('visibility', 'visible');
      showTooltipForTurn(turn, cx, width);
    });
    hitRect.addEventListener('mouseleave', () => {
      hoverLine.setAttribute('visibility', 'hidden');
      chartTooltip.classList.add('hidden');
    });

    trendSvg.appendChild(hitRect);
  }
}

function renderRecentTable(session: SessionMetrics): void {
  turnsTbody.replaceChildren();
  const recent = session.turns.slice(-10).reverse();
  tableMeta.textContent = t(currentLang, 'recentTableMeta', {
    recent: recent.length,
    total: session.stepCount,
  });

  for (const turn of recent) {
    const tr = document.createElement('tr');

    const tdStep = document.createElement('td');
    tdStep.textContent = `#${turn.stepIndex}`;

    const tdModel = document.createElement('td');
    const modelSpan = document.createElement('span');
    modelSpan.className = 'model-tag';
    modelSpan.textContent = formatShortModel(turn.model);
    modelSpan.title = turn.model;
    tdModel.appendChild(modelSpan);

    const tdHit = document.createElement('td');
    const pill = document.createElement('span');
    pill.className = `pill pill-${getCacheTone(turn.cacheHitRate)}`;
    pill.textContent = formatPercent(turn.cacheHitRate);
    tdHit.appendChild(pill);

    const tdInputs = document.createElement('td');
    tdInputs.className = 'num';
    const cachedNode = document.createTextNode(formatTokens(turn.cacheReadTokens));
    const slash = document.createElement('span');
    slash.className = 'muted-slash';
    slash.textContent = '/';
    const newNode = document.createTextNode(formatTokens(turn.inputTokens));
    tdInputs.append(cachedNode, slash, newNode);

    const tdOut = document.createElement('td');
    tdOut.className = 'num';
    tdOut.textContent = formatTokens(turn.outputTokens);

    const tdSpeed = document.createElement('td');
    tdSpeed.className = 'num';
    tdSpeed.textContent =
      turn.tokensPerSec !== null ? `${formatSpeed(turn.tokensPerSec)}` : '--';

    tr.append(tdStep, tdModel, tdHit, tdInputs, tdOut, tdSpeed);
    turnsTbody.appendChild(tr);
  }
}

function renderAllSession(payload: MonitorPayload): void {
  latestPayload = payload;
  renderSessionSelector(payload);
  renderHero(payload.activeSession, payload.serverTime);

  const session = payload.activeSession;
  if (
    session &&
    lastRenderedSessionId !== null &&
    session.conversationId !== lastRenderedSessionId &&
    autoFollow &&
    selectedSessionModel !== null
  ) {
    lastRenderedSessionId = session.conversationId;
    selectedSessionModel = null;
    void fetchMetrics(true);
    return;
  }
  lastRenderedSessionId = session?.conversationId ?? null;

  if (activeView !== 'session') {
    return;
  }

  summaryEmptyState.classList.add('hidden');
  summaryPanel.classList.add('hidden');

  if (!session || (session.stepCount === 0 && session.unfilteredTotalTokens === 0)) {
    emptyState.classList.remove('hidden');
    detailsPanel.classList.add('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  if (!compactMode) {
    detailsPanel.classList.remove('hidden');

    const colorMap = getModelColorMap(session.modelsBreakdown);
    const hasMultipleVariants =
      session.modelsBreakdown.length > 1 ||
      session.selectedModel !== null ||
      (session.modelsBreakdown[0]?.variants.length ?? 0) > 1;
    sessionModelBar.classList.toggle('hidden', !hasMultipleVariants);
    if (hasMultipleVariants) {
      renderModelFilterBar({
        pillsEl: sessionModelPills,
        btnFamily: btnSessGrpFamily,
        btnExact: btnSessGrpExact,
        models: session.modelsBreakdown,
        totalTokens: session.unfilteredTotalTokens,
        selectedModel: session.selectedModel,
        grouping: session.modelGrouping,
        colorMap,
        onSelect: (key) => {
          selectedSessionModel = key;
          void fetchMetrics(true);
        },
      });
    }

    renderKpisAndComposition(session);

    const showModelsCard = session.modelsBreakdown.length >= 2;
    sessionModelsCard.classList.toggle('hidden', !showModelsCard);
    if (showModelsCard) {
      sessionModelsMeta.textContent = session.selectedModel
        ? t(currentLang, 'sessModelsFilteredMeta', {
            name: formatModelDisplayName(session.selectedModel),
          })
        : t(currentLang, 'sessModelsAllMeta', {
            count: formatCount(
              currentLang,
              session.modelsBreakdown.length,
              'model',
            ),
          });
      renderModelBenchmarkList({
        container: sessionModelsList,
        models: session.modelsBreakdown,
        totalTokens: session.unfilteredTotalTokens,
        selectedModel: session.selectedModel,
        grouping: session.modelGrouping,
        colorMap,
        showSessionCount: false,
        onToggleModel: (key) => {
          selectedSessionModel = selectedSessionModel === key ? null : key;
          void fetchMetrics(true);
        },
      });
    }

    if (chartWrap.clientWidth > 0) {
      renderTrendChart(session);
    } else {
      window.requestAnimationFrame(() => renderTrendChart(session));
    }
    renderRecentTable(session);
    const modelNote = session.selectedModel
      ? t(currentLang, 'footModelNote', {
          name: formatModelDisplayName(session.selectedModel),
        })
      : '';
    footNoteText.textContent =
      session.speedSource === 'hook'
        ? t(currentLang, 'footHook', {
            count: session.timedStepCount,
            modelNote,
          })
        : t(currentLang, 'footTranscript', { modelNote });
  }
}

/* ==========================================================================
   Multi-Session Window Summary View Renderers
   ========================================================================== */

function renderWindowButtons(): void {
  for (const btn of windowButtons) {
    const win = btn.dataset.window as TimeWindowKey | undefined;
    btn.classList.toggle('active', win === selectedWindow);
  }
}

function renderSummaryHero(summary: WindowSummaryPayload): void {
  const windowLabel = formatWindowLabel(currentLang, summary.window);
  sumLiveDot.classList.toggle('is-live', summary.hasLiveSession);
  sumHeroWindow.textContent = windowLabel;
  sumHeroSessionsPill.textContent = formatCount(
    currentLang,
    summary.sessionCount,
    'session',
  );
  renderModelBadgePill(
    sumHeroModelPill,
    summary.selectedModel,
    getModelColorMap(summary.allModels),
  );

  sumHeroSpeed.textContent = formatSpeed(summary.avgTokensPerSec);
  if (summary.speedSource === 'hook') {
    sumHeroSpeedWrap.title = t(currentLang, 'heroSumSpeedTooltipHook');
  } else if (summary.speedSource === 'transcript') {
    sumHeroSpeedWrap.title = t(currentLang, 'heroSumSpeedTooltipTranscript');
  } else {
    sumHeroSpeedWrap.title = t(currentLang, 'heroSumSpeedTooltipEmpty');
  }

  sumHeroCache.textContent = formatPercent(summary.overallCacheHitRate);
  setToneClass(sumHeroCache, 'tone', getCacheTone(summary.overallCacheHitRate));

  sumHeroTotal.textContent = formatTokens(summary.totalTokens);
  sumHeroIn.textContent = formatTokens(summary.totalInputTokens);
  sumHeroOut.textContent = formatTokens(summary.totalOutputTokens);

  const modelSuffix = summary.selectedModel
    ? ` · ${formatModelDisplayName(summary.selectedModel)}`
    : '';
  if (summary.hasLiveSession) {
    statusChip.textContent = t(currentLang, 'statusSummaryLive', {
      window: `${windowLabel}${modelSuffix}`,
    });
  } else {
    statusChip.textContent = t(currentLang, 'statusSummaryIdle', {
      window: `${windowLabel}${modelSuffix}`,
      sessions: formatCount(currentLang, summary.sessionCount, 'session'),
    });
  }
}

function renderSummaryKpis(summary: WindowSummaryPayload): void {
  sumKpiTotalBadge.textContent = formatCount(
    currentLang,
    summary.stepCount,
    'turn',
  );
  sumKpiTotalVal.textContent = formatTokens(summary.totalTokens);
  sumKpiTotalSub.textContent = t(currentLang, 'sumKpiTotalSub', {
    inTok: formatTokens(summary.totalInputTokens),
    outTok: formatTokens(summary.totalOutputTokens),
  });

  const hitTone = getCacheTone(summary.overallCacheHitRate);
  sumKpiHitBadge.textContent = formatPercent(summary.overallCacheHitRate);
  setToneClass(sumKpiHitBadge, 'pill', hitTone);
  sumKpiHitVal.textContent = formatPercent(summary.overallCacheHitRate);
  sumKpiHitSub.textContent = t(currentLang, 'sumKpiHitSub', {
    cached: formatTokens(summary.totalCacheReadTokens),
    uncached: formatTokens(summary.totalUncachedInputTokens),
  });

  const speedText =
    summary.avgTokensPerSec !== null
      ? `${formatSpeed(summary.avgTokensPerSec)} tok/s`
      : '--';
  sumKpiSpeedVal.textContent = speedText;
  sumKpiSpeedBadge.textContent =
    summary.speedSource === 'hook'
      ? t(currentLang, 'speedBadgeHook')
      : summary.speedSource === 'transcript'
        ? t(currentLang, 'speedBadgeTranscript')
        : t(currentLang, 'speedBadgeNone');
  setToneClass(
    sumKpiSpeedBadge,
    'pill',
    summary.speedSource === 'hook' ? 'good' : 'neutral',
  );
  sumKpiSpeedSub.textContent = t(currentLang, 'sumKpiSpeedSub', {
    timed: summary.timedStepCount,
    total: summary.stepCount,
  });

  if (summary.selectedModel) {
    sumKpiAvgTitle.textContent = t(currentLang, 'sumKpiShareTitle');
    sumKpiAvgBadge.textContent = formatCount(
      currentLang,
      summary.sessionCount,
      'session',
    );
    sumKpiAvgVal.textContent =
      summary.unfilteredTotalTokens > 0
        ? formatPercent(summary.totalTokens / summary.unfilteredTotalTokens)
        : '--';
    sumKpiAvgSub.textContent = t(currentLang, 'sumKpiShareSub', {
      part: formatTokens(summary.totalTokens),
      total: formatTokens(summary.unfilteredTotalTokens),
      projects: formatCount(currentLang, summary.projectCount, 'project'),
    });
  } else {
    sumKpiAvgTitle.textContent = t(currentLang, 'sumKpiAvgTitle');
    const avgPerSession =
      summary.sessionCount > 0 ? summary.totalTokens / summary.sessionCount : 0;
    sumKpiAvgBadge.textContent = formatCount(
      currentLang,
      summary.sessionCount,
      'session',
    );
    sumKpiAvgVal.textContent = formatTokens(avgPerSession);
    sumKpiAvgSub.textContent = t(currentLang, 'sumKpiAvgSub', {
      projects: formatCount(currentLang, summary.projectCount, 'project'),
      models: formatCount(currentLang, summary.modelCount, 'model'),
    });
  }
}

function appendDonutLegendItem(options: {
  label: string;
  valueText: string;
  pct: number;
  color: string;
  clickable: boolean;
  onClick?: () => void;
}): void {
  const { label, valueText, pct, color, clickable, onClick } = options;
  const wrapper = clickable
    ? document.createElement('button')
    : document.createElement('div');
  if (clickable && wrapper instanceof HTMLButtonElement) {
    wrapper.type = 'button';
    wrapper.className = 'donut-row donut-legend-btn';
    if (onClick) {
      wrapper.addEventListener('click', onClick);
    }
  } else {
    wrapper.className = 'donut-row';
  }

  const top = document.createElement('div');
  top.className = 'donut-row-top';

  const left = document.createElement('span');
  left.className = 'legend-item';
  const dot = document.createElement('span');
  dot.className = 'legend-dot';
  dot.style.background = color;
  const nameEl = document.createElement('span');
  nameEl.className = 'legend-name';
  nameEl.textContent = label;
  left.append(dot, nameEl);

  const valEl = document.createElement('span');
  valEl.className = 'legend-val';
  valEl.textContent = valueText;

  top.append(left, valEl);

  const track = document.createElement('div');
  track.className = 'donut-mini-track';
  const fill = document.createElement('div');
  fill.className = 'donut-mini-fill';
  fill.style.background = color;
  fill.style.width = `${Math.max(0, Math.min(100, pct)).toFixed(2)}%`;
  track.appendChild(fill);

  wrapper.append(top, track);
  sumDonutLegend.appendChild(wrapper);
}

function renderSummaryDonut(summary: WindowSummaryPayload): void {
  sumDonutSvg.replaceChildren();
  sumDonutLegend.replaceChildren();

  const colorMap = getModelColorMap(summary.allModels);
  const canShowModelDonut =
    !summary.selectedModel && summary.allModels.length > 1;
  const effectiveMode =
    canShowModelDonut && donutMode === 'model' ? 'model' : 'token';

  sumDonutToggle.classList.toggle('hidden', !canShowModelDonut);
  btnDonutModel.classList.toggle('active', effectiveMode === 'model');
  btnDonutToken.classList.toggle('active', effectiveMode === 'token');
  sumDonutTitle.textContent =
    effectiveMode === 'model'
      ? t(currentLang, 'donutModelTitle')
      : t(currentLang, 'donutTokenTitle');

  const total = summary.totalTokens;
  sumDonutMeta.textContent = t(currentLang, 'compTotal', {
    short: formatTokens(total),
    exact: formatExactInt(total),
  });

  const cx = 70;
  const cy = 70;
  const r = 50;
  const circumference = 2 * Math.PI * r;

  sumDonutSvg.appendChild(
    svgEl('circle', {
      cx,
      cy,
      r,
      fill: 'none',
      stroke: 'var(--cp-surface-elevated)',
      'stroke-width': 14,
    }),
  );

  const centerTitle = svgEl('text', {
    x: cx,
    y: cy - 11,
    'text-anchor': 'middle',
    fill: 'var(--cp-text-muted)',
    'font-size': 10,
  });
  const centerVal = svgEl('text', {
    x: cx,
    y: cy + 7,
    'text-anchor': 'middle',
    fill: 'var(--cp-text)',
    'font-size': 16,
    'font-weight': 700,
  });
  const centerSub = svgEl('text', {
    x: cx,
    y: cy + 21,
    'text-anchor': 'middle',
    fill: 'var(--cp-text-subtle)',
    'font-size': 10,
  });

  const resetCenter = (): void => {
    centerTitle.textContent =
      effectiveMode === 'model'
        ? t(currentLang, 'donutCenterModels', {
            models: formatCount(currentLang, summary.allModels.length, 'model'),
          })
        : t(currentLang, 'donutCenterTotal');
    centerVal.textContent = formatTokens(total);
    centerSub.textContent = t(currentLang, 'donutCenterHit', {
      rate: formatPercent(summary.overallCacheHitRate),
    });
  };
  resetCenter();

  interface DonutSlice {
    name: string;
    tokens: number;
    color: string;
    subText: string;
    modelKey: string | null;
  }

  const slices: DonutSlice[] = [];
  if (effectiveMode === 'model') {
    const top = summary.allModels.slice(0, 7);
    for (const m of top) {
      const pct = total > 0 ? (m.totalTokens / total) * 100 : 0;
      slices.push({
        name: m.displayName,
        tokens: m.totalTokens,
        color: colorMap.get(m.model) ?? 'var(--cp-m-7)',
        subText: `${pct.toFixed(1)}% · ${t(currentLang, 'donutCenterHit', {
          rate: formatPercent(m.cacheHitRate),
        })}`,
        modelKey: m.model,
      });
    }
    if (summary.allModels.length > 7) {
      const restTokens = summary.allModels
        .slice(7)
        .reduce((acc, m) => acc + m.totalTokens, 0);
      const restPct = total > 0 ? (restTokens / total) * 100 : 0;
      if (restTokens > 0) {
        slices.push({
          name: t(currentLang, 'otherModels'),
          tokens: restTokens,
          color: 'var(--cp-m-7)',
          subText: `${restPct.toFixed(1)}%`,
          modelKey: null,
        });
      }
    }
  } else {
    slices.push(
      {
        name: t(currentLang, 'legCached'),
        tokens: summary.totalCacheReadTokens,
        color: 'var(--cp-good-bar)',
        subText:
          total > 0
            ? `${((summary.totalCacheReadTokens / total) * 100).toFixed(1)}%`
            : '0%',
        modelKey: null,
      },
      {
        name: t(currentLang, 'legUncached'),
        tokens: summary.totalUncachedInputTokens,
        color: 'var(--cp-accent)',
        subText:
          total > 0
            ? `${((summary.totalUncachedInputTokens / total) * 100).toFixed(1)}%`
            : '0%',
        modelKey: null,
      },
      {
        name: t(currentLang, 'legOutput'),
        tokens: summary.totalOutputTokens,
        color: 'var(--cp-output)',
        subText:
          total > 0
            ? `${((summary.totalOutputTokens / total) * 100).toFixed(1)}%`
            : '0%',
        modelKey: null,
      },
    );
  }

  let offsetAcc = 0;
  for (const slice of slices) {
    const pct = total > 0 ? (slice.tokens / total) * 100 : 0;
    const onSelectModel =
      slice.modelKey !== null
        ? () => {
            selectedSummaryModel = slice.modelKey;
            void fetchWindowSummary(true);
          }
        : undefined;

    appendDonutLegendItem({
      label: slice.name,
      valueText:
        total > 0
          ? `${formatTokens(slice.tokens)} (${pct.toFixed(1)}%)`
          : '0',
      pct,
      color: slice.color,
      clickable: slice.modelKey !== null,
      onClick: onSelectModel,
    });

    if (total <= 0 || slice.tokens <= 0) continue;
    const segLen = (slice.tokens / total) * circumference;
    const circle = svgEl('circle', {
      cx,
      cy,
      r,
      fill: 'none',
      stroke: slice.color,
      'stroke-width': 14,
      'stroke-dasharray': `${segLen.toFixed(2)} ${(circumference - segLen).toFixed(2)}`,
      'stroke-dashoffset': String(-offsetAcc),
      transform: `rotate(-90 ${cx} ${cy})`,
      class: 'donut-segment',
    });
    circle.addEventListener('mouseenter', () => {
      centerTitle.textContent = truncateText(slice.name, 14);
      centerVal.textContent = formatTokens(slice.tokens);
      centerSub.textContent = slice.subText;
    });
    circle.addEventListener('mouseleave', resetCenter);
    if (onSelectModel) {
      circle.addEventListener('click', onSelectModel);
    }
    sumDonutSvg.appendChild(circle);
    offsetAcc += segLen;
  }

  sumDonutSvg.append(centerTitle, centerVal, centerSub);
}

function renderSummaryCompare(summary: WindowSummaryPayload): void {
  sumCompareList.replaceChildren();
  const maxTotal = Math.max(
    1,
    ...summary.comparisons.map((c) => c.totalTokens),
  );

  for (const item of summary.comparisons) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'compare-row';
    if (item.window === summary.window) {
      row.classList.add('is-active');
    }

    const top = document.createElement('div');
    top.className = 'compare-row-top';

    const labelWrap = document.createElement('span');
    labelWrap.className = 'compare-label-wrap';
    const code = document.createElement('span');
    code.className = 'compare-code';
    code.textContent = item.window;
    const name = document.createElement('span');
    name.className = 'compare-name';
    name.textContent = formatWindowLabel(currentLang, item.window);
    labelWrap.append(code, name);

    const stats = document.createElement('span');
    stats.className = 'compare-stats';

    const sessSpan = document.createElement('span');
    sessSpan.textContent = formatCount(currentLang, item.sessionCount, 'session');

    const speedSpan = document.createElement('span');
    speedSpan.textContent =
      item.avgTokensPerSec !== null ? `${formatSpeed(item.avgTokensPerSec)}/s` : '--';

    const hitPill = document.createElement('span');
    hitPill.className = `pill pill-${getCacheTone(item.overallCacheHitRate)}`;
    hitPill.textContent = formatPercent(item.overallCacheHitRate);

    const totalSpan = document.createElement('span');
    totalSpan.className = 'compare-total';
    totalSpan.textContent = formatTokens(item.totalTokens);

    stats.append(sessSpan, speedSpan, hitPill, totalSpan);
    top.append(labelWrap, stats);

    const track = document.createElement('div');
    track.className = 'compare-bar-track';

    if (item.totalTokens > 0) {
      const scalePct = (item.totalTokens / maxTotal) * 100;
      const segs: Array<[number, string]> = [
        [(item.totalCacheReadTokens / item.totalTokens) * scalePct, 'seg-cached'],
        [(item.totalUncachedInputTokens / item.totalTokens) * scalePct, 'seg-uncached'],
        [(item.totalOutputTokens / item.totalTokens) * scalePct, 'seg-output'],
      ];
      for (const [wPct, cls] of segs) {
        if (wPct <= 0) continue;
        const fill = document.createElement('div');
        fill.className = `compare-bar-fill ${cls}`;
        fill.style.width = `${wPct.toFixed(2)}%`;
        track.appendChild(fill);
      }
    }

    row.append(top, track);
    row.addEventListener('click', () => {
      if (item.window !== selectedWindow) {
        selectWindow(item.window);
      }
    });
    sumCompareList.appendChild(row);
  }
}

function showTimelineTooltip(
  bucket: TimelineBucket,
  xPx: number,
  containerWidth: number,
  effectiveMode: 'model' | 'token',
): void {
  const bucketTitle = bucket.isCarryOver
    ? t(currentLang, 'timelineCarryOver')
    : bucket.label;
  const titleRight = bucket.isCarryOver
    ? t(currentLang, 'timelineBeforeWindow')
    : t(currentLang, 'ttTurnsSuffix', { n: bucket.stepCount });
  const rows: Array<[string, string]> = [
    [t(currentLang, 'ttTotal'), formatTokens(bucket.totalTokens)],
    [t(currentLang, 'ttHitRate'), formatPercent(bucket.cacheHitRate)],
    [
      t(currentLang, 'ttCachedNew'),
      `${formatTokens(bucket.cacheReadTokens)} / ${formatTokens(bucket.uncachedInputTokens)}`,
    ],
    [t(currentLang, 'ttOutput'), formatTokens(bucket.outputTokens)],
    [
      t(currentLang, 'ttSpeed'),
      bucket.avgTokensPerSec !== null
        ? `${formatSpeed(bucket.avgTokensPerSec)} tok/s`
        : '--',
    ],
  ];
  if (effectiveMode === 'model' && bucket.byModel.length > 0) {
    for (const slice of bucket.byModel.slice(0, 3)) {
      rows.push([slice.displayName, formatTokens(slice.totalTokens)]);
    }
  }
  appendTooltipRows(summaryTimelineTooltip, bucketTitle, titleRight, rows);
  positionTooltip(summaryTimelineTooltip, xPx, containerWidth);
}

function appendTimelineLegendKey(label: string, color: string): void {
  const item = document.createElement('span');
  item.className = 'chart-key';
  const chip = document.createElement('i');
  chip.className = 'key-chip';
  chip.style.background = color;
  item.append(chip, document.createTextNode(label));
  sumTimelineLegend.appendChild(item);
}

function renderSummaryTimeline(summary: WindowSummaryPayload): void {
  summaryTimelineSvg.replaceChildren();
  summaryTimelineTooltip.classList.add('hidden');
  sumTimelineLegend.replaceChildren();

  const colorMap = getModelColorMap(summary.allModels);
  const canShowModelTimeline =
    !summary.selectedModel && summary.allModels.length > 1;
  const effectiveMode =
    canShowModelTimeline && timelineMode === 'model' ? 'model' : 'token';

  sumTimelineToggle.classList.toggle('hidden', !canShowModelTimeline);
  btnTlModel.classList.toggle('active', effectiveMode === 'model');
  btnTlToken.classList.toggle('active', effectiveMode === 'token');

  const lineKey = document.createElement('span');
  lineKey.className = 'chart-key';
  const lineI = document.createElement('i');
  lineI.className = 'key-line';
  lineKey.append(lineI, document.createTextNode(t(currentLang, 'legendHitRate')));
  sumTimelineLegend.appendChild(lineKey);

  if (effectiveMode === 'model') {
    for (const m of summary.allModels.slice(0, 5)) {
      appendTimelineLegendKey(
        truncateText(m.displayName, 16),
        colorMap.get(m.model) ?? 'var(--cp-m-7)',
      );
    }
    if (summary.allModels.length > 5) {
      appendTimelineLegendKey(t(currentLang, 'otherShort'), 'var(--cp-m-7)');
    }
  } else {
    appendTimelineLegendKey(t(currentLang, 'legCached'), 'var(--cp-good-bar)');
    appendTimelineLegendKey(t(currentLang, 'legUncached'), 'var(--cp-accent)');
    appendTimelineLegendKey(t(currentLang, 'legOutput'), 'var(--cp-output)');
  }

  const sliceDesc =
    summary.window === '5h'
      ? t(currentLang, 'slice5h')
      : summary.window === '1d'
        ? t(currentLang, 'slice1d')
        : t(currentLang, 'slice7d');
  sumTimelineTitle.textContent = t(currentLang, 'timelineTitle', {
    slice: sliceDesc,
  });

  const buckets = summary.timeline;
  const width = Math.max(260, summaryTimelineWrap.clientWidth || 520);
  const height = 176;
  summaryTimelineSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  if (buckets.length === 0) {
    const emptyText = svgEl('text', {
      x: width / 2,
      y: height / 2,
      'text-anchor': 'middle',
      fill: 'var(--cp-text-subtle)',
      'font-size': 12,
    });
    emptyText.textContent = t(currentLang, 'timelineEmpty');
    summaryTimelineSvg.appendChild(emptyText);
    return;
  }

  const padL = 34;
  const padR = 40;
  const padT = 14;
  const padB = 24;
  const plotW = Math.max(60, width - padL - padR);
  const plotH = height - padT - padB;
  const maxTotal = Math.max(1, ...buckets.map((b) => b.totalTokens));

  for (const frac of [1, 0.5, 0]) {
    const y = padT + (1 - frac) * plotH;
    summaryTimelineSvg.appendChild(
      svgEl('line', {
        x1: padL,
        y1: y,
        x2: padL + plotW,
        y2: y,
        stroke: 'var(--cp-border-soft)',
        'stroke-dasharray': frac === 0 ? 'none' : '3 3',
        'stroke-width': 1,
      }),
    );
    const label = svgEl('text', {
      x: padL - 6,
      y: y + 3.5,
      'text-anchor': 'end',
      fill: 'var(--cp-text-subtle)',
      'font-size': 10,
    });
    label.textContent = `${Math.round(frac * 100)}%`;
    summaryTimelineSvg.appendChild(label);
  }

  const rightTop = svgEl('text', {
    x: padL + plotW + 6,
    y: padT + 4,
    'text-anchor': 'start',
    fill: 'var(--cp-text-subtle)',
    'font-size': 10,
  });
  rightTop.textContent = formatTokens(maxTotal);
  summaryTimelineSvg.appendChild(rightTop);

  const count = buckets.length;
  const slotW = plotW / count;
  const barW = Math.max(6, Math.min(26, slotW * 0.58));

  const points: Array<{
    x: number;
    y: number | null;
    bucket: TimelineBucket;
  }> = [];

  for (let i = 0; i < count; i++) {
    const bucket = buckets[i];
    const cx = padL + (i + 0.5) * slotW;
    const barX = cx - barW / 2;

    if (bucket.isCarryOver && i === 0 && count > 1) {
      // Subtle divider separating carry-over turns from the main window slices.
      const divX = padL + slotW;
      summaryTimelineSvg.appendChild(
        svgEl('line', {
          x1: divX,
          y1: padT,
          x2: divX,
          y2: padT + plotH,
          stroke: 'var(--cp-border)',
          'stroke-dasharray': '3 3',
          'stroke-width': 1,
        }),
      );
    }

    if (bucket.totalTokens > 0) {
      const hTotal = (bucket.totalTokens / maxTotal) * plotH;
      let cursorY = padT + plotH;
      const stackParts: Array<{ h: number; fill: string }> =
        effectiveMode === 'model' && bucket.byModel.length > 0
          ? bucket.byModel.map((slice) => ({
              h: (slice.totalTokens / bucket.totalTokens) * hTotal,
              fill: colorMap.get(slice.model) ?? 'var(--cp-m-7)',
            }))
          : [
              {
                h: (bucket.cacheReadTokens / bucket.totalTokens) * hTotal,
                fill: 'var(--cp-good-bar)',
              },
              {
                h: (bucket.uncachedInputTokens / bucket.totalTokens) * hTotal,
                fill: 'var(--cp-accent)',
              },
              {
                h: Math.max(
                  0,
                  hTotal -
                    (bucket.cacheReadTokens / bucket.totalTokens) * hTotal -
                    (bucket.uncachedInputTokens / bucket.totalTokens) * hTotal,
                ),
                fill: 'var(--cp-output)',
              },
            ];

      for (const part of stackParts) {
        if (part.h <= 0.2) continue;
        const rectY = cursorY - part.h;
        summaryTimelineSvg.appendChild(
          svgEl('rect', {
            x: barX,
            y: rectY,
            width: barW,
            height: part.h,
            rx: 1.5,
            fill: part.fill,
            'fill-opacity': bucket.isCarryOver ? 0.52 : 0.82,
          }),
        );
        cursorY = rectY;
      }

      if (bucket.isCarryOver) {
        summaryTimelineSvg.appendChild(
          svgEl('rect', {
            x: barX,
            y: padT + plotH - hTotal,
            width: barW,
            height: hTotal,
            rx: 1.5,
            fill: 'none',
            stroke: 'var(--cp-text-subtle)',
            'stroke-dasharray': '2 2',
            'stroke-width': 1,
          }),
        );
      }
    }

    const py =
      bucket.cacheHitRate !== null
        ? padT + (1 - bucket.cacheHitRate) * plotH
        : null;
    points.push({ x: cx, y: py, bucket });

    // X-axis label (keep readable on narrow containers)
    const showLabel =
      count <= 8 || i === 0 || i === count - 1 || i % 2 === 0;
    if (showLabel) {
      const xLabel = svgEl('text', {
        x: cx,
        y: height - 6,
        'text-anchor': 'middle',
        fill: bucket.isCarryOver ? 'var(--cp-warn)' : 'var(--cp-text-subtle)',
        'font-size': 9.5,
      });
      xLabel.textContent = bucket.isCarryOver
        ? t(currentLang, 'timelineCarryOver')
        : bucket.label;
      summaryTimelineSvg.appendChild(xLabel);
    }
  }

  // Contiguous polyline runs (skips empty buckets cleanly without bridging gaps falsely)
  const segments: Array<Array<{ x: number; y: number }>> = [];
  let currentRun: Array<{ x: number; y: number }> = [];
  for (const pt of points) {
    if (pt.y !== null) {
      currentRun.push({ x: pt.x, y: pt.y });
    } else if (currentRun.length > 0) {
      segments.push(currentRun);
      currentRun = [];
    }
  }
  if (currentRun.length > 0) {
    segments.push(currentRun);
  }

  for (const seg of segments) {
    if (seg.length < 2) continue;
    const d = seg
      .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ');
    summaryTimelineSvg.appendChild(
      svgEl('path', {
        d,
        fill: 'none',
        stroke: 'var(--cp-good-bar)',
        'stroke-width': 2,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }),
    );
  }

  const hoverLine = svgEl('line', {
    x1: 0,
    y1: padT,
    x2: 0,
    y2: padT + plotH,
    stroke: 'var(--cp-text-subtle)',
    'stroke-width': 1,
    'stroke-dasharray': '2 2',
    visibility: 'hidden',
  });
  summaryTimelineSvg.appendChild(hoverLine);

  for (const pt of points) {
    if (pt.y === null) continue;
    const tone = getCacheTone(pt.bucket.cacheHitRate);
    const color =
      tone === 'good'
        ? 'var(--cp-good-bar)'
        : tone === 'warn'
          ? 'var(--cp-warn)'
          : 'var(--cp-bad)';
    summaryTimelineSvg.appendChild(
      svgEl('circle', {
        cx: pt.x,
        cy: pt.y,
        r: 3.4,
        fill: color,
        stroke: 'var(--cp-surface-card)',
        'stroke-width': 1.5,
      }),
    );
  }

  for (let i = 0; i < count; i++) {
    const bucket = buckets[i];
    const cx = padL + (i + 0.5) * slotW;
    const hitRect = svgEl('rect', {
      x: padL + i * slotW,
      y: padT,
      width: Math.max(6, slotW),
      height: plotH,
      fill: 'transparent',
      style: 'cursor: crosshair;',
    });

    hitRect.addEventListener('mouseenter', () => {
      hoverLine.setAttribute('x1', String(cx));
      hoverLine.setAttribute('x2', String(cx));
      hoverLine.setAttribute('visibility', 'visible');
      showTimelineTooltip(bucket, cx, width, effectiveMode);
    });
    hitRect.addEventListener('mouseleave', () => {
      hoverLine.setAttribute('visibility', 'hidden');
      summaryTimelineTooltip.classList.add('hidden');
    });
    summaryTimelineSvg.appendChild(hitRect);
  }
}

function renderSummaryBreakdown(summary: WindowSummaryPayload): void {
  sumBreakdownList.replaceChildren();
  btnBdModel.classList.toggle('active', breakdownMode === 'model');
  btnBdProject.classList.toggle('active', breakdownMode === 'project');
  sumBreakdownTitle.textContent = t(
    currentLang,
    breakdownMode === 'model' ? 'breakdownModelsTitle' : 'breakdownProjectsTitle',
  );

  if (breakdownMode === 'model') {
    const colorMap = getModelColorMap(summary.allModels);
    renderModelBenchmarkList({
      container: sumBreakdownList,
      models: summary.allModels,
      totalTokens: summary.unfilteredTotalTokens,
      selectedModel: summary.selectedModel,
      grouping: summary.modelGrouping,
      colorMap,
      showSessionCount: true,
      onToggleModel: (key) => {
        selectedSummaryModel = selectedSummaryModel === key ? null : key;
        void fetchWindowSummary(true);
      },
    });
    return;
  }

  const entries = summary.projects.map((p) => {
    const displayName =
      currentLang === 'en'
        ? p.projectName.replace(
            /^会话 ([0-9a-f]{8})$/i,
            `${t(currentLang, 'fallbackSessionPrefix')} $1`,
          )
        : p.projectName;
    return {
      name: displayName,
      rawName: displayName,
      totalTokens: p.totalTokens,
      cacheReadTokens: p.cacheReadTokens,
      uncachedInputTokens: p.uncachedInputTokens,
      outputTokens: p.outputTokens,
      cacheHitRate: p.cacheHitRate,
      avgTokensPerSec: p.avgTokensPerSec,
      subMeta: `${formatCount(currentLang, p.sessionCount, 'session')} · ${formatCount(currentLang, p.stepCount, 'turn')}`,
    };
  });

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'breakdown-empty';
    empty.textContent = t(currentLang, 'noDimData');
    sumBreakdownList.appendChild(empty);
    return;
  }

  const visible = entries.slice(0, 8);
  const maxTotal = Math.max(1, ...visible.map((e) => e.totalTokens));

  for (const item of visible) {
    const row = document.createElement('div');
    row.className = 'breakdown-item';

    const top = document.createElement('div');
    top.className = 'breakdown-top';

    const nameEl = document.createElement('span');
    nameEl.className = 'breakdown-name';
    nameEl.textContent = item.name;
    nameEl.title = item.rawName;

    const valEl = document.createElement('span');
    valEl.className = 'breakdown-val';
    valEl.textContent = formatTokens(item.totalTokens);

    top.append(nameEl, valEl);

    const bar = document.createElement('div');
    bar.className = 'breakdown-bar';
    if (item.totalTokens > 0) {
      const scalePct = (item.totalTokens / maxTotal) * 100;
      const segs: Array<[number, string]> = [
        [(item.cacheReadTokens / item.totalTokens) * scalePct, 'seg-cached'],
        [(item.uncachedInputTokens / item.totalTokens) * scalePct, 'seg-uncached'],
        [(item.outputTokens / item.totalTokens) * scalePct, 'seg-output'],
      ];
      for (const [wPct, cls] of segs) {
        if (wPct <= 0) continue;
        const seg = document.createElement('div');
        seg.className = `comp-seg ${cls}`;
        seg.style.width = `${wPct.toFixed(2)}%`;
        bar.appendChild(seg);
      }
    }

    const meta = document.createElement('div');
    meta.className = 'breakdown-meta';

    const leftMeta = document.createElement('span');
    leftMeta.textContent = item.subMeta;

    const rightMeta = document.createElement('span');
    const hitStr = formatPercent(item.cacheHitRate);
    const speedStr =
      item.avgTokensPerSec !== null
        ? `${formatSpeed(item.avgTokensPerSec)} tok/s`
        : '-- tok/s';
    rightMeta.textContent = t(currentLang, 'metaHitSpeed', {
      hit: hitStr,
      speed: speedStr,
    });

    meta.append(leftMeta, rightMeta);
    row.append(top, bar, meta);
    sumBreakdownList.appendChild(row);
  }
}

function showScatterTooltip(
  session: WindowSessionItem,
  xPx: number,
  containerWidth: number,
): void {
  const titleLeft = truncateText(
    session.sessionTitle ||
      localizedProjectName(session.projectName, session.conversationId),
    24,
  );
  const rows: Array<[string, string]> = [];
  if (
    session.sessionTitle &&
    !isFallbackProjectName(session.projectName, session.conversationId)
  ) {
    rows.push([t(currentLang, 'ttProject'), session.projectName]);
  }
  rows.push(
    [t(currentLang, 'ttTotal'), formatTokens(session.cumulativeTotalTokens)],
    [t(currentLang, 'ttHitRate'), formatPercent(session.sessionCacheHitRate)],
    [
      t(currentLang, 'ttSpeed'),
      session.avgTokensPerSec !== null
        ? `${formatSpeed(session.avgTokensPerSec)} tok/s`
        : '--',
    ],
    [t(currentLang, 'ttTurns'), t(currentLang, 'ttTurnsSuffix', { n: session.stepCount })],
  );
  appendTooltipRows(
    summaryScatterTooltip,
    titleLeft,
    formatShortModel(session.activeModel),
    rows,
  );
  positionTooltip(summaryScatterTooltip, xPx, containerWidth);
}

function renderSummaryScatter(summary: WindowSummaryPayload): void {
  summaryScatterSvg.replaceChildren();
  summaryScatterTooltip.classList.add('hidden');

  const width = Math.max(240, summaryScatterWrap.clientWidth || 420);
  const height = 184;
  summaryScatterSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const plottable = summary.sessions.filter(
    (s) =>
      s.sessionCacheHitRate !== null &&
      s.avgTokensPerSec !== null &&
      s.avgTokensPerSec > 0,
  );

  if (plottable.length === 0) {
    const emptyText = svgEl('text', {
      x: width / 2,
      y: height / 2,
      'text-anchor': 'middle',
      fill: 'var(--cp-text-subtle)',
      'font-size': 12,
    });
    emptyText.textContent = t(currentLang, 'scatterEmpty');
    summaryScatterSvg.appendChild(emptyText);
    return;
  }

  const padL = 36;
  const padR = 16;
  const padT = 16;
  const padB = 26;
  const plotW = Math.max(60, width - padL - padR);
  const plotH = height - padT - padB;

  const rawMaxSpeed = Math.max(
    10,
    ...plottable.map((s) => s.avgTokensPerSec ?? 0),
    summary.avgTokensPerSec ?? 0,
  );
  const yMax = Math.ceil((rawMaxSpeed * 1.15) / 10) * 10;
  const maxTokens = Math.max(
    1,
    ...plottable.map((s) => s.cumulativeTotalTokens),
  );

  // Horizontal speed gridlines
  for (const frac of [1, 0.5, 0]) {
    const y = padT + (1 - frac) * plotH;
    summaryScatterSvg.appendChild(
      svgEl('line', {
        x1: padL,
        y1: y,
        x2: padL + plotW,
        y2: y,
        stroke: 'var(--cp-border-soft)',
        'stroke-dasharray': frac === 0 ? 'none' : '3 3',
        'stroke-width': 1,
      }),
    );
    const label = svgEl('text', {
      x: padL - 6,
      y: y + 3.5,
      'text-anchor': 'end',
      fill: 'var(--cp-text-subtle)',
      'font-size': 10,
    });
    label.textContent = String(Math.round(yMax * frac));
    summaryScatterSvg.appendChild(label);
  }

  // Vertical X-axis labels (0%, 50%, 85%, 100%)
  for (const pct of [0, 0.5, 0.85, 1]) {
    const x = padL + pct * plotW;
    if (pct === 0.85) {
      summaryScatterSvg.appendChild(
        svgEl('line', {
          x1: x,
          y1: padT,
          x2: x,
          y2: padT + plotH,
          stroke: 'var(--cp-good-bar)',
          'stroke-opacity': 0.45,
          'stroke-dasharray': '3 3',
          'stroke-width': 1,
        }),
      );
    }
    const label = svgEl('text', {
      x,
      y: height - 7,
      'text-anchor': pct === 1 ? 'end' : pct === 0 ? 'start' : 'middle',
      fill: pct === 0.85 ? 'var(--cp-good)' : 'var(--cp-text-subtle)',
      'font-size': 9.5,
    });
    label.textContent = `${Math.round(pct * 100)}%`;
    summaryScatterSvg.appendChild(label);
  }

  // Reference horizontal line for window average speed
  if (summary.avgTokensPerSec !== null && summary.avgTokensPerSec > 0) {
    const avgY = padT + (1 - summary.avgTokensPerSec / yMax) * plotH;
    summaryScatterSvg.appendChild(
      svgEl('line', {
        x1: padL,
        y1: avgY,
        x2: padL + plotW,
        y2: avgY,
        stroke: 'var(--cp-accent)',
        'stroke-opacity': 0.5,
        'stroke-dasharray': '4 3',
        'stroke-width': 1,
      }),
    );
  }

  // Draw largest bubbles first so smaller ones remain clickable on top
  const ordered = [...plottable].sort(
    (a, b) => b.cumulativeTotalTokens - a.cumulativeTotalTokens,
  );

  for (const session of ordered) {
    const hitRate = session.sessionCacheHitRate ?? 0;
    const speed = session.avgTokensPerSec ?? 0;
    const cx = padL + Math.max(0, Math.min(1, hitRate)) * plotW;
    const cy = padT + (1 - Math.max(0, Math.min(1, speed / yMax))) * plotH;
    const r =
      5 +
      Math.sqrt(Math.max(0, session.cumulativeTotalTokens) / maxTokens) * 12;

    const tone = getCacheTone(hitRate);
    const fill =
      tone === 'good'
        ? 'var(--cp-good-bar)'
        : tone === 'warn'
          ? 'var(--cp-warn)'
          : 'var(--cp-bad)';

    if (session.isLive) {
      summaryScatterSvg.appendChild(
        svgEl('circle', {
          cx,
          cy,
          r: r + 3,
          fill: 'none',
          stroke: 'var(--cp-good-bar)',
          'stroke-opacity': 0.45,
          'stroke-width': 1.5,
        }),
      );
    }

    const bubble = svgEl('circle', {
      cx,
      cy,
      r,
      fill,
      'fill-opacity': 0.65,
      stroke: 'var(--cp-surface-card)',
      'stroke-width': 1.5,
      class: 'scatter-bubble',
    });

    bubble.addEventListener('mouseenter', () => {
      showScatterTooltip(session, cx, width);
    });
    bubble.addEventListener('mouseleave', () => {
      summaryScatterTooltip.classList.add('hidden');
    });
    bubble.addEventListener('click', () => {
      jumpToSession(session.conversationId);
    });

    summaryScatterSvg.appendChild(bubble);
  }
}

function renderSummarySessionsTable(summary: WindowSummaryPayload): void {
  sumSessionsTbody.replaceChildren();
  const sorted = [...summary.sessions].sort((a, b) => {
    if (sessionSortBy === 'tokens') {
      return b.cumulativeTotalTokens - a.cumulativeTotalTokens;
    }
    if (sessionSortBy === 'hitRate') {
      return (b.sessionCacheHitRate ?? -1) - (a.sessionCacheHitRate ?? -1);
    }
    if (sessionSortBy === 'speed') {
      return (b.avgTokensPerSec ?? -1) - (a.avgTokensPerSec ?? -1);
    }
    return b.lastActivityAt - a.lastActivityAt;
  });

  const matchedSessionsText = formatCount(
    currentLang,
    summary.totalMatchedSessionCount,
    'session',
  );
  sumTableMeta.textContent =
    sorted.length < summary.totalMatchedSessionCount
      ? t(currentLang, 'sumTableMetaSlice', {
          shown: sorted.length,
          sessions: matchedSessionsText,
        })
      : t(currentLang, 'sumTableMetaAll', {
          sessions: matchedSessionsText,
        });

  for (const s of sorted) {
    const tr = document.createElement('tr');
    tr.title = t(currentLang, 'rowClickJump');

    const tdProj = document.createElement('td');
    const stack = document.createElement('div');
    stack.className = 'session-cell-stack';

    const mainRow = document.createElement('span');
    mainRow.className = 'session-cell-main';
    if (s.isLive) {
      const dot = document.createElement('span');
      dot.className = 'live-dot is-live';
      mainRow.appendChild(dot);
    }
    const titleSpan = document.createElement('span');
    titleSpan.className = 'session-title-main';
    const primaryLabel =
      s.sessionTitle || localizedProjectName(s.projectName, s.conversationId);
    titleSpan.textContent = primaryLabel;
    titleSpan.title = primaryLabel;
    mainRow.appendChild(titleSpan);

    const subRow = document.createElement('span');
    subRow.className = 'session-sub-meta';
    const shortId = s.conversationId.slice(0, 8);
    subRow.textContent = !isFallbackProjectName(s.projectName, s.conversationId)
      ? `${s.projectName} · #${shortId}`
      : `${t(currentLang, 'historySessionPrefix')} · #${shortId}`;

    stack.append(mainRow, subRow);
    tdProj.appendChild(stack);

    const tdModel = document.createElement('td');
    const modelSpan = document.createElement('span');
    modelSpan.className = 'model-tag';
    modelSpan.textContent = formatShortModel(s.activeModel);
    modelSpan.title = s.modelsUsed.join(', ') || (s.activeModel ?? '');
    tdModel.appendChild(modelSpan);

    const tdSteps = document.createElement('td');
    tdSteps.className = 'num';
    tdSteps.textContent = `${s.stepCount}`;

    const tdHit = document.createElement('td');
    const pill = document.createElement('span');
    pill.className = `pill pill-${getCacheTone(s.sessionCacheHitRate)}`;
    pill.textContent = formatPercent(s.sessionCacheHitRate);
    tdHit.appendChild(pill);

    const tdTokens = document.createElement('td');
    tdTokens.className = 'num';
    const totalStrong = document.createElement('strong');
    totalStrong.textContent = formatTokens(s.cumulativeTotalTokens);
    const detailSpan = document.createElement('span');
    detailSpan.className = 'muted-slash';
    detailSpan.textContent = ` (${formatTokens(s.cumulativeCacheReadTokens)}/${formatTokens(s.cumulativeUncachedInputTokens)}/${formatTokens(s.cumulativeOutputTokens)})`;
    tdTokens.append(totalStrong, detailSpan);

    const tdSpeed = document.createElement('td');
    tdSpeed.className = 'num';
    tdSpeed.textContent =
      s.avgTokensPerSec !== null ? formatSpeed(s.avgTokensPerSec) : '--';

    const tdTime = document.createElement('td');
    tdTime.className = 'num';
    tdTime.textContent = formatRelativeTime(s.lastActivityAt, summary.serverTime);

    tr.append(tdProj, tdModel, tdSteps, tdHit, tdTokens, tdSpeed, tdTime);
    tr.addEventListener('click', () => {
      jumpToSession(s.conversationId);
    });
    sumSessionsTbody.appendChild(tr);
  }
}

function renderAllSummary(summary: WindowSummaryPayload): void {
  latestSummary = summary;
  selectedWindow = summary.window;
  modelGrouping = summary.modelGrouping;
  selectedSummaryModel = summary.selectedModel;
  renderWindowButtons();
  renderSummaryHero(summary);

  if (activeView !== 'summary') {
    return;
  }

  emptyState.classList.add('hidden');
  detailsPanel.classList.add('hidden');

  if (summary.sessionCount === 0) {
    summaryPanel.classList.add('hidden');
    if (compactMode) {
      summaryEmptyState.classList.add('hidden');
      return;
    }
    summaryEmptyState.classList.remove('hidden');
    btnEmptyClearModel.classList.toggle('hidden', summary.selectedModel === null);
    btnEmptyTry7d.classList.toggle('hidden', summary.window === '7d');
    const winLabel = formatWindowLabel(currentLang, summary.window);
    if (summary.selectedModel && summary.unfilteredSessionCount > 0) {
      summaryEmptyDesc.textContent = t(currentLang, 'sumEmptyDescModel', {
        window: winLabel,
        model: formatModelDisplayName(summary.selectedModel),
      });
    } else {
      summaryEmptyDesc.textContent = t(currentLang, 'sumEmptyDesc', {
        window: winLabel,
      });
    }
    return;
  }

  summaryEmptyState.classList.add('hidden');
  if (!compactMode) {
    summaryPanel.classList.remove('hidden');
    const colorMap = getModelColorMap(summary.allModels);
    renderModelFilterBar({
      pillsEl: sumModelPills,
      btnFamily: btnSumGrpFamily,
      btnExact: btnSumGrpExact,
      models: summary.allModels,
      totalTokens: summary.unfilteredTotalTokens,
      selectedModel: summary.selectedModel,
      grouping: summary.modelGrouping,
      colorMap,
      onSelect: (key) => {
        selectedSummaryModel = key;
        void fetchWindowSummary(true);
      },
    });

    renderSummaryKpis(summary);
    renderSummaryDonut(summary);
    renderSummaryCompare(summary);
    renderSummaryBreakdown(summary);

    const drawCharts = (): void => {
      renderSummaryTimeline(summary);
      renderSummaryScatter(summary);
    };
    if (summaryTimelineWrap.clientWidth > 0 && summaryScatterWrap.clientWidth > 0) {
      drawCharts();
    } else {
      window.requestAnimationFrame(drawCharts);
    }

    renderSummarySessionsTable(summary);
    const winLabel = formatWindowLabel(currentLang, summary.window);
    const modelNote = summary.selectedModel
      ? t(currentLang, 'sumFootModelNote', {
          name: formatModelDisplayName(summary.selectedModel),
        })
      : '';
    const sessionsText = formatCount(currentLang, summary.sessionCount, 'session');
    sumFootNoteText.textContent =
      summary.hookTimedStepCount > 0
        ? t(currentLang, 'sumFootHook', {
            window: winLabel,
            modelNote,
            sessions: sessionsText,
            hook: summary.hookTimedStepCount,
            tx: summary.transcriptTimedStepCount,
          })
        : t(currentLang, 'sumFootTranscript', {
            window: winLabel,
            modelNote,
            sessions: sessionsText,
          });
  }
}

/* ==========================================================================
   View Switching & Data Fetching
   ========================================================================== */

function setActiveView(
  view: 'session' | 'summary',
  options?: { window?: TimeWindowKey; skipFetch?: boolean },
): void {
  activeView = view;
  const isSummary = view === 'summary';
  if (options?.window) {
    selectedWindow = options.window;
  }

  btnViewSession.classList.toggle('active', !isSummary);
  btnViewSummary.classList.toggle('active', isSummary);
  heroSessionContent.classList.toggle('hidden', isSummary);
  heroSummaryContent.classList.toggle('hidden', !isSummary);
  sessionControls.classList.toggle('hidden', isSummary);
  windowControls.classList.toggle('hidden', !isSummary);
  renderWindowButtons();

  if (isSummary) {
    emptyState.classList.add('hidden');
    detailsPanel.classList.add('hidden');
    if (latestSummary && latestSummary.window === selectedWindow) {
      renderAllSummary(latestSummary);
    } else {
      sumHeroWindow.textContent = formatWindowLabel(currentLang, selectedWindow);
      statusChip.textContent = t(currentLang, 'statusSummaryLoading');
    }
    if (!options?.skipFetch) {
      void fetchWindowSummary(true);
    }
  } else {
    summaryEmptyState.classList.add('hidden');
    summaryPanel.classList.add('hidden');
    if (latestPayload) {
      renderAllSession(latestPayload);
    }
    if (!options?.skipFetch) {
      void fetchMetrics(true);
    }
  }
}

function selectWindow(win: TimeWindowKey): void {
  selectedWindow = win;
  renderWindowButtons();
  void fetchWindowSummary(true);
}

function jumpToSession(conversationId: string): void {
  autoFollow = false;
  selectedSessionId = conversationId;
  selectedSessionModel = null;
  setActiveView('session', { skipFetch: true });
  void fetchMetrics(true);
}

function setModelGrouping(next: ModelGrouping): void {
  if (modelGrouping === next) return;
  modelGrouping = next;
  selectedSummaryModel = null;
  selectedSessionModel = null;
  if (activeView === 'summary') {
    void fetchWindowSummary(true);
  } else {
    void fetchMetrics(true);
  }
}

async function fetchMetrics(manual = false): Promise<void> {
  if (!manual && inFlightCount > 0) return;
  const seq = ++requestSeq;
  inFlightCount += 1;
  if (manual) {
    btnRefresh.classList.add('spinning');
  }
  try {
    const res = await app.callServerTool({
      name: 'get_metrics',
      arguments: {
        sessionId: autoFollow ? undefined : (selectedSessionId ?? undefined),
        autoFollow,
        model: selectedSessionModel ?? undefined,
        modelGrouping,
      },
    });
    if (seq !== requestSeq) return;
    if (isMonitorPayload(res.structuredContent)) {
      renderAllSession(res.structuredContent);
    }
  } catch (err) {
    if (seq === requestSeq) {
      console.warn('[cache-pulse] Failed to refresh metrics:', err);
      statusChip.textContent = t(currentLang, 'statusAwaitRefresh');
    }
  } finally {
    inFlightCount = Math.max(0, inFlightCount - 1);
    if (inFlightCount === 0) {
      btnRefresh.classList.remove('spinning');
    }
  }
}

async function fetchWindowSummary(manual = false): Promise<void> {
  if (!manual && inFlightCount > 0) return;
  const seq = ++requestSeq;
  const targetWindow = selectedWindow;
  inFlightCount += 1;
  if (manual) {
    btnRefresh.classList.add('spinning');
  }
  try {
    const res = await app.callServerTool({
      name: 'get_window_summary',
      arguments: {
        window: targetWindow,
        model: selectedSummaryModel ?? undefined,
        modelGrouping,
      },
    });
    if (seq !== requestSeq) return;
    if (isWindowSummaryPayload(res.structuredContent)) {
      lastSummaryPollAt = Date.now();
      renderAllSummary(res.structuredContent);
    }
  } catch (err) {
    if (seq === requestSeq) {
      console.warn('[cache-pulse] Failed to refresh window summary:', err);
      statusChip.textContent = t(currentLang, 'statusSummaryFailed');
    }
  } finally {
    inFlightCount = Math.max(0, inFlightCount - 1);
    if (inFlightCount === 0) {
      btnRefresh.classList.remove('spinning');
    }
  }
}

function startPolling(): void {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
  }
  pollTimer = window.setInterval(() => {
    if (document.hidden) return;
    if (activeView === 'summary') {
      if (Date.now() - lastSummaryPollAt >= SUMMARY_POLL_INTERVAL_MS) {
        void fetchWindowSummary(false);
      }
    } else {
      void fetchMetrics(false);
    }
  }, POLL_INTERVAL_MS);
}

// Event bindings
btnViewSession.addEventListener('click', () => {
  if (activeView !== 'session') {
    setActiveView('session');
  }
});

btnViewSummary.addEventListener('click', () => {
  if (activeView !== 'summary') {
    setActiveView('summary');
  }
});

for (const btn of windowButtons) {
  btn.addEventListener('click', () => {
    const win = btn.dataset.window as TimeWindowKey | undefined;
    if (win) {
      selectWindow(win);
    }
  });
}

btnEmptyClearModel.addEventListener('click', () => {
  selectedSummaryModel = null;
  void fetchWindowSummary(true);
});

btnEmptyTry7d.addEventListener('click', () => {
  selectWindow('7d');
});

btnSessGrpFamily.addEventListener('click', () => setModelGrouping('family'));
btnSessGrpExact.addEventListener('click', () => setModelGrouping('exact'));
btnSumGrpFamily.addEventListener('click', () => setModelGrouping('family'));
btnSumGrpExact.addEventListener('click', () => setModelGrouping('exact'));

btnDonutModel.addEventListener('click', () => {
  donutMode = 'model';
  if (latestSummary) {
    renderSummaryDonut(latestSummary);
  }
});

btnDonutToken.addEventListener('click', () => {
  donutMode = 'token';
  if (latestSummary) {
    renderSummaryDonut(latestSummary);
  }
});

btnTlModel.addEventListener('click', () => {
  timelineMode = 'model';
  if (latestSummary) {
    renderSummaryTimeline(latestSummary);
  }
});

btnTlToken.addEventListener('click', () => {
  timelineMode = 'token';
  if (latestSummary) {
    renderSummaryTimeline(latestSummary);
  }
});

btnBdModel.addEventListener('click', () => {
  breakdownMode = 'model';
  if (latestSummary) {
    renderSummaryBreakdown(latestSummary);
  }
});

btnBdProject.addEventListener('click', () => {
  breakdownMode = 'project';
  if (latestSummary) {
    renderSummaryBreakdown(latestSummary);
  }
});

sumSessionSort.addEventListener('change', () => {
  sessionSortBy = sumSessionSort.value as 'recent' | 'tokens' | 'hitRate' | 'speed';
  if (latestSummary) {
    renderSummarySessionsTable(latestSummary);
  }
});

sessionSelect.addEventListener('change', () => {
  const val = sessionSelect.value;
  selectedSessionModel = null;
  if (val === '__auto__') {
    autoFollow = true;
    selectedSessionId = null;
  } else {
    autoFollow = false;
    selectedSessionId = val;
  }
  void fetchMetrics(true);
});

btnModeDetail.addEventListener('click', () => {
  compactMode = false;
  appShell.dataset.compact = 'false';
  btnModeDetail.classList.add('active');
  btnModeCompact.classList.remove('active');
  if (activeView === 'summary' && latestSummary) {
    renderAllSummary(latestSummary);
  } else if (activeView === 'session' && latestPayload) {
    renderAllSession(latestPayload);
  }
});

btnModeCompact.addEventListener('click', () => {
  compactMode = true;
  appShell.dataset.compact = 'true';
  btnModeCompact.classList.add('active');
  btnModeDetail.classList.remove('active');
  if (activeView === 'summary') {
    summaryEmptyState.classList.add('hidden');
    summaryPanel.classList.add('hidden');
  }
});

btnLang.addEventListener('click', () => {
  currentLang = currentLang === 'en' ? 'zh' : 'en';
  userPinnedLang = true;
  applyStaticTranslations(currentLang);
  if (activeView === 'summary' && latestSummary) {
    renderAllSummary(latestSummary);
  } else if (activeView === 'session' && latestPayload) {
    renderAllSession(latestPayload);
  } else {
    renderWindowButtons();
  }
});

btnRefresh.addEventListener('click', () => {
  if (activeView === 'summary') {
    void fetchWindowSummary(true);
  } else {
    void fetchMetrics(true);
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    if (activeView === 'summary') {
      void fetchWindowSummary(false);
    } else {
      void fetchMetrics(false);
    }
  }
});

if (typeof ResizeObserver !== 'undefined') {
  const ro = new ResizeObserver((entries) => {
    if (compactMode) return;
    for (const entry of entries) {
      if (
        entry.target === chartWrap &&
        activeView === 'session' &&
        latestPayload?.activeSession &&
        latestPayload.activeSession.stepCount > 0
      ) {
        renderTrendChart(latestPayload.activeSession);
      } else if (
        entry.target === summaryTimelineWrap &&
        activeView === 'summary' &&
        latestSummary &&
        latestSummary.sessionCount > 0
      ) {
        renderSummaryTimeline(latestSummary);
      } else if (
        entry.target === summaryScatterWrap &&
        activeView === 'summary' &&
        latestSummary &&
        latestSummary.sessionCount > 0
      ) {
        renderSummaryScatter(latestSummary);
      }
    }
  });
  ro.observe(chartWrap);
  ro.observe(summaryTimelineWrap);
  ro.observe(summaryScatterWrap);
}

// Register MCP Apps handlers BEFORE calling app.connect()
app.ontoolinput = () => {
  statusChip.textContent = t(currentLang, 'statusLoading');
};

app.ontoolresult = (result) => {
  if (isWindowSummaryPayload(result.structuredContent)) {
    lastSummaryPollAt = Date.now();
    latestSummary = result.structuredContent;
    selectedWindow = result.structuredContent.window;
    modelGrouping = result.structuredContent.modelGrouping;
    selectedSummaryModel = result.structuredContent.selectedModel;
    setActiveView('summary', {
      window: result.structuredContent.window,
      skipFetch: true,
    });
    renderAllSummary(result.structuredContent);
  } else if (isMonitorPayload(result.structuredContent)) {
    latestPayload = result.structuredContent;
    if (result.structuredContent.activeSession) {
      modelGrouping = result.structuredContent.activeSession.modelGrouping;
      selectedSessionModel = result.structuredContent.activeSession.selectedModel;
    }
    setActiveView('session', { skipFetch: true });
    renderAllSession(result.structuredContent);
  }
};

app.onhostcontextchanged = (ctx) => {
  applyHostContext(ctx);
};

async function init(): Promise<void> {
  applyStaticTranslations(currentLang);
  renderWindowButtons();
  if (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
  ) {
    applyDocumentTheme('dark');
  }

  await app.connect();
  applyHostContext(app.getHostContext());

  if (!latestPayload && !latestSummary) {
    await fetchMetrics(false);
  }
  startPolling();
}

void init();
