import type { TimeWindowKey } from '../shared/types.js';

export type UiLang = 'en' | 'zh';

export const MESSAGES = {
  en: {
    heroProject: 'Project',
    heroNoSession: 'No Session',
    heroLoading: 'Loading...',
    heroSpeed: 'Speed',
    heroCache: 'Cache',
    heroRecent: 'Recent',
    heroSession: 'Session',
    heroCum: 'Input',
    heroOut: 'Out',
    heroPeriod: 'Window',
    heroTotal: 'Total',
    heroIn: 'In',
    heroOverallHit: 'Hit Rate',
    heroSpeedTooltipHook:
      'End-to-end model throughput timed at millisecond precision by Lifecycle Hooks (includes TTFT & thinking)',
    heroSpeedTooltipTranscript:
      'Estimated output speed from adjacent transcript step timestamps',
    heroSpeedTooltipEmpty:
      'Not enough timed steps yet (send another turn to start measuring)',
    heroSumSpeedTooltipHook:
      'Weighted average speed combining Hook millisecond timing and transcript estimates',
    heroSumSpeedTooltipTranscript:
      'Weighted average speed estimated from adjacent transcript timestamps',
    heroSumSpeedTooltipEmpty: 'No timed model calls in this window yet',
    modeSession: 'Session',
    modeSummary: 'Overview',
    modeDetail: 'Detail',
    modeCompact: 'Compact',
    refreshTitle: 'Refresh now',
    langSwitchBtn: '中',
    langSwitchTitle: '切换为简体中文',
    autoFollowEmpty: 'Auto-follow active session',
    autoFollowLabel: 'Auto · {label}',
    statusSyncing: 'Syncing',
    statusWaiting: 'Waiting for session',
    statusLive: 'Live',
    statusUpdatedAt: 'Updated {rel}',
    statusLoading: 'Loading session...',
    statusSummaryLoading: 'Loading overview...',
    statusAwaitRefresh: 'Retry pending',
    statusSummaryFailed: 'Refresh failed',
    statusSummaryLive: '{window} · Live',
    statusSummaryIdle: '{window} · {sessions}',
    win5h: 'Last 5h',
    win1d: 'Last 24h',
    win7d: 'Last 7d',
    slice5h: '30m buckets',
    slice1d: '2h buckets',
    slice7d: 'Daily',
    allModels: 'All Models',
    groupFamily: 'Merged',
    groupExact: 'Exact',
    groupFamilyTitle:
      'Merge thinking/effort tiers of the same model (e.g. High / XHigh)',
    groupExactTitle: 'Show each raw model variant separately',
    noModelData: 'No model data',
    noDimData: 'No breakdown data',
    modelClickReset: 'Click to clear filter and view all models',
    modelClickFilter: 'Click to filter by {name}',
    emptyTitle: 'Waiting for First Model Response',
    emptyDesc:
      'No model calls recorded in this session yet. Send a message to see live cache hit rate and token metrics.',
    kpiCachedTitle: 'Cache Hit',
    kpiUncachedTitle: 'Uncached Input',
    kpiOutputTitle: 'Output Tokens',
    compTitle: 'Session Token Composition',
    compTotal: 'Total {short} ({exact})',
    legCached: 'Cache Hit',
    legUncached: 'New Input',
    legOutput: 'Output',
    sessModelsTitle: 'Models in This Session',
    sessModelsFilteredMeta: 'Filtered: {name} · Click to reset',
    sessModelsAllMeta: '{count} · Click to filter',
    trendTitle: 'Per-Turn Cache Hit Rate & Input Size',
    legendHitRate: 'Hit Rate %',
    legendStepInput: 'Turn Input',
    trendEmpty: 'No model call curve yet',
    recentTableTitle: 'Recent Model Calls',
    recentTableMeta: 'Last {recent} / {total}',
    colStep: 'Turn',
    colModel: 'Model',
    colHit: 'Cache Hit',
    colCachedNew: 'Cached / New',
    colOutput: 'Output',
    colSpeed: 'Speed',
    footHook:
      'Speed estimated from {count} Hook-timed calls (includes TTFT & thinking); scope is this single session{modelNote}.',
    footTranscript:
      'Speed roughly estimated from transcript step deltas (includes TTFT); new calls will enable Hook precision timing{modelNote}.',
    footModelNote: ' · Filtered: {name}',
    sumEmptyTitle: 'No Sessions in This Window',
    sumEmptyDescModel:
      'No sessions using {model} found in {window}. Clear the model filter or switch to a longer window.',
    sumEmptyDesc:
      'No triggered sessions found in {window}. Switch to a longer window or send a new message and refresh.',
    btnShowAllModels: 'Show All Models',
    btnView7d: 'View Last 7 Days',
    sumKpiTotalTitle: 'Total Tokens',
    sumKpiTotalSub: 'In {inTok} · Out {outTok}',
    sumKpiHitTitle: 'Overall Cache Hit Rate',
    sumKpiHitSub: 'Hit {cached} / New {uncached}',
    sumKpiSpeedTitle: 'Avg Task Speed',
    speedBadgeHook: 'Hook Timed',
    speedBadgeTranscript: 'Estimated',
    speedBadgeNone: 'Pending',
    sumKpiSpeedSub: 'Timed {timed} / {total} turns',
    sumKpiAvgTitle: 'Avg per Session',
    sumKpiShareTitle: 'Share of Window',
    sumKpiAvgSub: '{projects} · {models}',
    sumKpiShareSub: '{part} / {total} · {projects}',
    donutModelTitle: 'Usage by Model',
    donutTokenTitle: 'Token Breakdown',
    btnDonutModel: 'By Model',
    btnDonutToken: 'By Token',
    donutCenterTotal: 'Total Tokens',
    donutCenterModels: '{models}',
    donutCenterHit: 'Hit {rate}',
    otherModels: 'Other Models',
    otherShort: 'Other',
    compareTitle: 'Window Comparison',
    compareMeta: 'Click to switch',
    timelineTitle: 'Timeline Usage & Cache Hit Rate ({slice})',
    timelineEmpty: 'No timeline data',
    btnTlModel: 'By Model',
    btnTlToken: 'By Token',
    timelineCarryOver: 'Earlier',
    timelineBeforeWindow: 'Before window',
    breakdownModelsTitle: 'Model Breakdown',
    breakdownProjectsTitle: 'Project Breakdown',
    btnBdModel: 'Models',
    btnBdProject: 'Projects',
    scatterTitle: 'Session Efficiency',
    scatterMeta: 'Hit Rate × Speed · click to open',
    scatterEmpty: 'Not enough timed sessions to plot',
    sumTableTitle: 'Sessions in Window',
    sumTableMetaAll: '{sessions}',
    sumTableMetaSlice: 'Showing {shown} / {sessions}',
    sortRecent: 'Most Recent',
    sortTokens: 'Total Tokens',
    sortHitRate: 'Cache Hit Rate',
    sortSpeed: 'Avg Speed',
    colSession: 'Project / Task',
    colTurns: 'Turns',
    colHitRate: 'Hit Rate',
    colTokensBreakdown: 'Total (Hit/New/Out)',
    colLastActive: 'Active',
    rowClickJump: 'Click to inspect this session',
    historySessionPrefix: 'History',
    fallbackSessionPrefix: 'Session',
    sumFootHook:
      'Scope: full history of {sessions} active in {window}{modelNote}; {hook} Hook-timed + {tx} transcript-estimated turns.',
    sumFootTranscript:
      'Scope: full history of {sessions} active in {window}{modelNote}; speed weighted by transcript step deltas.',
    sumFootModelNote: ' ({name})',
    ttProject: 'Project',
    ttTotal: 'Total',
    ttCachedNew: 'Hit / New',
    ttHitRate: 'Hit Rate',
    ttOutput: 'Output',
    ttSpeed: 'Speed',
    ttTurns: 'Turns',
    ttTurnsSuffix: '{n} turns',
    metaHitSpeed: 'Hit {hit} · {speed}',
  },
  zh: {
    heroProject: '项目',
    heroNoSession: '暂无会话',
    heroLoading: '加载中...',
    heroSpeed: '均速',
    heroCache: '缓存',
    heroRecent: '最近',
    heroSession: '会话',
    heroCum: '累计',
    heroOut: '输出',
    heroPeriod: '周期',
    heroTotal: '总用量',
    heroIn: '输入',
    heroOverallHit: '总命中',
    heroSpeedTooltipHook: 'Hook 毫秒级记录的模型响应均速（含首字延迟与思考）',
    heroSpeedTooltipTranscript: '基于日志相邻步骤时间差粗估的模型输出均速',
    heroSpeedTooltipEmpty: '尚无足够计时的连续步骤（发送下一轮请求后开始统计）',
    heroSumSpeedTooltipHook: '含 Hook 毫秒级计时与日志估算的加权均速',
    heroSumSpeedTooltipTranscript: '基于日志相邻步骤时间差加权估算的均速',
    heroSumSpeedTooltipEmpty: '该周期内尚无足够计时调用',
    modeSession: '单会话',
    modeSummary: '周期统计',
    modeDetail: '详情',
    modeCompact: '精简',
    refreshTitle: '立即刷新',
    langSwitchBtn: 'EN',
    langSwitchTitle: 'Switch to English',
    autoFollowEmpty: '自动跟随活跃会话',
    autoFollowLabel: '自动跟随 · {label}',
    statusSyncing: '同步中',
    statusWaiting: '等待会话',
    statusLive: '实时同步中',
    statusUpdatedAt: '更新于 {rel}',
    statusLoading: '读取会话中...',
    statusSummaryLoading: '统计加载中...',
    statusAwaitRefresh: '等待刷新',
    statusSummaryFailed: '统计刷新失败',
    statusSummaryLive: '{window} · 实时活跃',
    statusSummaryIdle: '{window} · {sessions}',
    win5h: '近 5 小时',
    win1d: '近 24 小时',
    win7d: '近 7 天',
    slice5h: '30分钟切片',
    slice1d: '2小时切片',
    slice7d: '按日统计',
    allModels: '全部模型',
    groupFamily: '合并档位',
    groupExact: '细分档位',
    groupFamilyTitle: '合并同一模型的不同思考档位 (如 High/XHigh)',
    groupExactTitle: '按原始细分档位单独统计',
    noModelData: '暂无模型数据',
    noDimData: '暂无维度数据',
    modelClickReset: '点击取消筛选，恢复查看全部模型',
    modelClickFilter: '点击筛选仅查看 {name}',
    emptyTitle: '等待首次模型响应',
    emptyDesc:
      '当前会话尚未产生模型调用记录。发送消息后，这里将实时显示缓存命中率与 Token 统计。',
    kpiCachedTitle: '缓存命中',
    kpiUncachedTitle: '未缓存新输入',
    kpiOutputTitle: '累计输出',
    compTitle: '会话 Token 构成',
    compTotal: '总计 {short} ({exact})',
    legCached: '缓存命中',
    legUncached: '新输入',
    legOutput: '输出',
    sessModelsTitle: '本会话分模型统计',
    sessModelsFilteredMeta: '已筛选 {name} · 点击恢复',
    sessModelsAllMeta: '共 {count} · 点击筛选',
    trendTitle: '逐轮缓存命中率与输入规模',
    legendHitRate: '命中率 %',
    legendStepInput: '单步输入',
    trendEmpty: '暂无模型调用曲线',
    recentTableTitle: '最近调用明细',
    recentTableMeta: '最近 {recent} 轮 / 共 {total} 轮',
    colStep: '步次',
    colModel: '模型',
    colHit: '缓存命中',
    colCachedNew: '缓存 / 新输入',
    colOutput: '输出',
    colSpeed: '均速',
    footHook:
      '均速由 Hook 记录的 {count} 次模型调用估算（含首字延迟与思考）；口径为当前单会话累计{modelNote}。',
    footTranscript:
      '均速按日志相邻非用户输入步骤时间差粗估（含首字延迟）；新建对话调用后将启用 Hook 精确计时{modelNote}。',
    footModelNote: ' · 已筛选 {name}',
    sumEmptyTitle: '该时间窗口暂无会话记录',
    sumEmptyDescModel:
      '{window}内未检测到使用 {model} 的会话。你可以恢复查看全部模型或切换周期。',
    sumEmptyDesc:
      '{window}内未检测到触发过的会话。你可以切换到更长周期查看历史统计，或发送新消息后刷新。',
    btnShowAllModels: '查看全部模型',
    btnView7d: '查看近 7 天统计',
    sumKpiTotalTitle: '总 Token 使用量',
    sumKpiTotalSub: '输入 {inTok} · 输出 {outTok}',
    sumKpiHitTitle: '总缓存命中率',
    sumKpiHitSub: '缓存 {cached} / 新输入 {uncached}',
    sumKpiSpeedTitle: '所有任务均速',
    speedBadgeHook: 'Hook 计时',
    speedBadgeTranscript: '日志估算',
    speedBadgeNone: '待计时',
    sumKpiSpeedSub: '已计时 {timed} / {total} 轮',
    sumKpiAvgTitle: '单会话均值',
    sumKpiShareTitle: '占周期总量',
    sumKpiAvgSub: '{projects} · {models}',
    sumKpiShareSub: '{part} / {total} · {projects}',
    donutModelTitle: '模型用量占比',
    donutTokenTitle: '周期 Token 构成',
    btnDonutModel: '按模型占比',
    btnDonutToken: '按 Token 构成',
    donutCenterTotal: '总 Token',
    donutCenterModels: '{models}',
    donutCenterHit: '命中 {rate}',
    otherModels: '其他模型',
    otherShort: '其他',
    compareTitle: '多周期横向对比',
    compareMeta: '点击切换周期',
    timelineTitle: '时间轴用量与缓存命中率趋势（{slice}）',
    timelineEmpty: '暂无时间轴数据',
    btnTlModel: '按模型堆叠',
    btnTlToken: '按 Token 构成',
    timelineCarryOver: '更早延续',
    timelineBeforeWindow: '窗口前产生',
    breakdownModelsTitle: '模型用量对比',
    breakdownProjectsTitle: '项目用量对比',
    btnBdModel: '按模型',
    btnBdProject: '按项目',
    scatterTitle: '会话效率分布',
    scatterMeta: '命中率 × 均速 · 点击定位会话',
    scatterEmpty: '暂无可绘制的均速分布数据',
    sumTableTitle: '周期内会话明细',
    sumTableMetaAll: '共 {sessions}',
    sumTableMetaSlice: '显示 {shown} / 共 {sessions}',
    sortRecent: '按最近活跃',
    sortTokens: '按总用量',
    sortHitRate: '按命中率',
    sortSpeed: '按均速',
    colSession: '项目 / 会话',
    colTurns: '轮次',
    colHitRate: '命中率',
    colTokensBreakdown: '总用量 (缓存/新/出)',
    colLastActive: '活跃时间',
    rowClickJump: '点击切换到该会话详情',
    historySessionPrefix: '历史会话',
    fallbackSessionPrefix: '会话',
    sumFootHook:
      '口径：{window}{modelNote}内触发过的 {sessions}全量计入；{hook} 轮采用 Hook 精确计时，{tx} 轮回退日志估算。',
    sumFootTranscript:
      '口径：{window}{modelNote}内触发过的 {sessions}全量计入；均速按日志相邻步骤时间差加权估算。',
    sumFootModelNote: ' · 仅看 {name}',
    ttProject: '项目',
    ttTotal: '总用量',
    ttCachedNew: '缓存 / 新输入',
    ttHitRate: '缓存命中',
    ttOutput: '输出',
    ttSpeed: '均速',
    ttTurns: '轮次',
    ttTurnsSuffix: '{n} 轮调用',
    metaHitSpeed: '命中 {hit} · {speed}',
  },
} as const;

export type MessageKey = keyof typeof MESSAGES.en;

export function detectInitialLang(locale?: string | null): UiLang {
  const raw =
    locale?.trim() ||
    (typeof navigator !== 'undefined' ? navigator.language : '') ||
    '';
  return raw.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function t(
  lang: UiLang,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  let template: string = MESSAGES[lang][key] ?? MESSAGES.en[key];
  if (!params) return template;
  for (const [k, v] of Object.entries(params)) {
    template = template.replaceAll(`{${k}}`, String(v));
  }
  return template;
}

export function formatWindowLabel(lang: UiLang, win: TimeWindowKey): string {
  if (win === '5h') return t(lang, 'win5h');
  if (win === '7d') return t(lang, 'win7d');
  return t(lang, 'win1d');
}

export function formatCount(
  lang: UiLang,
  n: number,
  unit: 'session' | 'turn' | 'project' | 'model',
): string {
  if (lang === 'zh') {
    const zhUnits: Record<typeof unit, string> = {
      session: '个会话',
      turn: '轮',
      project: '项目',
      model: '模型',
    };
    if (unit === 'session') return `${n} 个会话`;
    if (unit === 'turn') return `${n} 轮`;
    return `${n} ${zhUnits[unit]}`;
  }
  const suffix = n === 1 ? unit : `${unit}s`;
  return `${n} ${suffix}`;
}

export function formatRelativeTimeLocalized(
  lang: UiLang,
  tsMs: number,
  nowMs: number,
): string {
  if (!tsMs || tsMs <= 0) {
    return lang === 'zh' ? '未知时间' : 'Unknown';
  }
  const diffSec = Math.max(0, Math.floor((nowMs - tsMs) / 1000));
  if (diffSec < 10) return lang === 'zh' ? '刚刚' : 'Just now';
  if (diffSec < 60) return lang === 'zh' ? `${diffSec}秒前` : `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return lang === 'zh' ? `${diffMin}分钟前` : `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return lang === 'zh' ? `${diffHour}小时前` : `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  return lang === 'zh' ? `${diffDay}天前` : `${diffDay}d ago`;
}
