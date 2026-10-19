import { t } from '../i18n.js';
import { formatCost, formatPct, formatTokens } from './metrics.js';

const C = {
  text: '#c7c7c7',
  dim: '#7f7f7f',
  faint: '#5c5c5c',
  grid: '#242424',
  axis: '#2d2d2d',
  panel: '#0d0d0d',
  border: '#2d2d2d',
  accent: '#00c5c7',
  fresh: '#6871ff',
  cache: '#00c5c7',
  cacheWrite: '#0b7d7e',
  output: '#5ffa68',
  reason: '#ff77ff',
};

const FONT = '"IBM Plex Sans Condensed", "Segoe UI", "Microsoft YaHei", sans-serif';

function axisLabel() {
  return { color: C.dim, fontFamily: FONT, fontSize: 9 };
}

function tooltip() {
  return {
    trigger: 'axis',
    backgroundColor: '#141414',
    borderColor: C.border,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: C.text, fontFamily: FONT, fontSize: 11 },
    extraCssText: 'box-shadow:none;border-radius:0;',
    axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,.04)' } },
  };
}

function itemTooltip() {
  return {
    trigger: 'item',
    backgroundColor: '#141414',
    borderColor: C.border,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: C.text, fontFamily: FONT, fontSize: 11 },
    extraCssText: 'box-shadow:none;border-radius:0;',
  };
}

function grid(extra = {}) {
  return {
    left: 48,
    right: 16,
    top: 16,
    bottom: 52,
    containLabel: false,
    ...extra,
  };
}

function legend() {
  return {
    bottom: 8,
    left: 'center',
    itemWidth: 8,
    itemHeight: 8,
    itemGap: 12,
    textStyle: { color: C.dim, fontFamily: FONT, fontSize: 9 },
  };
}

function categoryAxis(data, { rotate = 0 } = {}) {
  return {
    type: 'category',
    data,
    axisLine: { lineStyle: { color: C.axis } },
    axisTick: { show: false },
    axisLabel: {
      ...axisLabel(),
      interval: 0,
      rotate,
      hideOverlap: true,
      formatter: (v) => (String(v).length > 14 ? String(v).slice(0, 13) + '...' : v),
    },
  };
}

function valueAxis({ name = '', max = null, formatter = null } = {}) {
  return {
    type: 'value',
    name,
    max,
    nameTextStyle: { color: C.faint, fontFamily: FONT, fontSize: 9, padding: [0, 0, 4, 0] },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: C.grid } },
    axisLabel: {
      ...axisLabel(),
      formatter: formatter || ((v) => formatTokens(v)),
    },
  };
}

export function buildTokenOption(rows, lang) {
  const labels = rows.map((r) => r.short || r.label || r.title || '');
  const meta = rows;
  const parts = [
    { key: 'cacheRead', name: t(lang, 'dashCacheRead'), color: C.cache },
    { key: 'input', name: t(lang, 'dashFreshInput'), color: C.fresh },
    { key: 'cacheWrite', name: t(lang, 'dashCacheWrite'), color: C.cacheWrite },
    { key: 'output', name: t(lang, 'dashOutput'), color: C.output },
    { key: 'reasoning', name: t(lang, 'dashReasoning'), color: C.reason },
  ];
  return {
    backgroundColor: 'transparent',
    animationDuration: 320,
    animationDurationUpdate: 180,
    grid: grid(),
    legend: legend(),
    tooltip: {
      ...tooltip(),
      formatter: (params) => {
        const row = meta[params?.[0]?.dataIndex];
        if (!row) return '';
        const u = row.usage;
        const lines = [
          `<div class="tt-tip-title">${escapeHtml(row.title || row.short || row.label || '')}</div>`,
          ...parts.map(
            (p) =>
              `<div class="tt-tip-row"><span class="tt-tip-dot" style="background:${p.color}"></span>${escapeHtml(
                p.name,
              )}<b>${formatTokens(u[p.key])}</b></div>`,
          ),
          `<div class="tt-tip-sep"></div>`,
          `<div class="tt-tip-row">${escapeHtml(t(lang, 'dashContext'))}<b>${formatTokens(row.contextTokens)}</b></div>`,
          `<div class="tt-tip-row">${escapeHtml(t(lang, 'dashCacheHit'))}<b>${formatPct(row.cacheRate)}</b></div>`,
          `<div class="tt-tip-row">${escapeHtml(t(lang, 'dashCost'))}<b>${formatCost(row.cost)}</b></div>`,
        ];
        return lines.join('');
      },
    },
    xAxis: categoryAxis(labels, { rotate: rows.length > 12 ? 42 : 0 }),
    yAxis: valueAxis(),
    series: parts.map((p) => ({
      name: p.name,
      type: 'bar',
      stack: 'token',
      barMaxWidth: 26,
      emphasis: { focus: 'series' },
      itemStyle: { color: p.color, borderColor: '#000', borderWidth: 0.5 },
      data: rows.map((r) => r.usage[p.key] || 0),
    })),
  };
}

export function buildCacheOption(rows, lang) {
  return {
    backgroundColor: 'transparent',
    animationDuration: 320,
    animationDurationUpdate: 180,
    grid: grid({ top: 12, bottom: 44 }),
    tooltip: {
      ...tooltip(),
      formatter: (params) => {
        const row = rows[params?.[0]?.dataIndex];
        if (!row) return '';
        return [
          `<div class="tt-tip-title">${escapeHtml(row.title || row.short || row.label || '')}</div>`,
          `<div class="tt-tip-row">${escapeHtml(t(lang, 'dashCacheHit'))}<b>${formatPct(row.cacheRate)}</b></div>`,
          `<div class="tt-tip-row">${escapeHtml(t(lang, 'dashCacheRead'))}<b>${formatTokens(row.usage.cacheRead)}</b></div>`,
          `<div class="tt-tip-row">${escapeHtml(t(lang, 'dashContext'))}<b>${formatTokens(row.contextTokens)}</b></div>`,
        ].join('');
      },
    },
    xAxis: categoryAxis(rows.map((r) => r.short || r.label || ''), {
      rotate: rows.length > 12 ? 42 : 0,
    }),
    yAxis: valueAxis({ max: 100, formatter: (v) => `${v}%` }),
    series: [
      {
        name: t(lang, 'dashCacheHit'),
        type: 'line',
        smooth: 0.2,
        symbol: 'circle',
        symbolSize: 4,
        showSymbol: rows.length < 24,
        lineStyle: { color: C.accent, width: 1.6 },
        itemStyle: { color: C.accent },
        areaStyle: { color: 'rgba(0,197,199,.10)' },
        data: rows.map((r) => (Number.isFinite(r.cacheRate) ? +(r.cacheRate * 100).toFixed(1) : null)),
      },
    ],
  };
}

export function buildContextOption(dash, lang) {
  const items = [
    { key: 'cacheRead', name: t(lang, 'dashCacheRead'), color: C.cache },
    { key: 'input', name: t(lang, 'dashFreshInput'), color: C.fresh },
    { key: 'cacheWrite', name: t(lang, 'dashCacheWrite'), color: C.cacheWrite },
    { key: 'output', name: t(lang, 'dashOutput'), color: C.output },
    { key: 'reasoning', name: t(lang, 'dashReasoning'), color: C.reason },
  ]
    .map((it) => ({ ...it, value: dash.usage[it.key] || 0 }))
    .filter((it) => it.value > 0);

  return {
    backgroundColor: 'transparent',
    animationDuration: 320,
    tooltip: {
      ...itemTooltip(),
      formatter: (p) =>
        [
          `<div class="tt-tip-title">${escapeHtml(p.name)}</div>`,
          `<div class="tt-tip-row">${formatTokens(p.value)} - ${p.percent}%</div>`,
        ].join(''),
    },
    legend: {
      bottom: 4,
      left: 'center',
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 10,
      textStyle: { color: C.dim, fontFamily: FONT, fontSize: 9 },
    },
    graphic: [
      {
        type: 'text',
        left: 'center',
        top: '35%',
        style: {
          text: formatTokens(dash.contextTokens),
          fill: C.text,
          font: `600 17px ${FONT}`,
          textAlign: 'center',
        },
      },
      {
        type: 'text',
        left: 'center',
        top: '46%',
        style: {
          text: t(lang, 'dashContext'),
          fill: C.dim,
          font: `9px ${FONT}`,
          textAlign: 'center',
        },
      },
    ],
    series: [
      {
        type: 'pie',
        radius: ['58%', '80%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: true,
        label: { show: false },
        labelLine: { show: false },
        itemStyle: { borderColor: '#000', borderWidth: 1 },
        emphasis: { scale: true, scaleSize: 2 },
        data: items.map((it) => ({
          name: it.name,
          value: it.value,
          itemStyle: { color: it.color },
        })),
      },
    ],
  };
}

export function buildHeatOption(heat, lang) {
  const singleRow = heat.range !== '7d';
  const label = {
    color: C.dim,
    fontFamily: FONT,
    fontSize: 9,
  };
  const tooltip = {
    ...itemTooltip(),
    axisPointer: { show: false },
    formatter: (p) => heatTooltip(heat, p, lang),
  };
  const visual = {
    show: false,
    type: 'continuous',
    min: 0,
    max: heat.max || 1,
    calculable: false,
    orient: 'horizontal',
    left: 'center',
    bottom: 2,
    itemWidth: 64,
    itemHeight: 7,
    textStyle: { color: C.faint, fontFamily: FONT, fontSize: 8 },
    inRange: { color: ['#101010', '#0b3b3c', '#007f81', '#00c5c7', '#a6ffff'] },
  };

  return {
    backgroundColor: 'transparent',
    animation: false,
    grid: singleRow
      ? { left: 12, right: 16, top: 8, bottom: 46 }
      : { left: 48, right: 16, top: 8, bottom: 46 },
    tooltip,
    visualMap: visual,
    xAxis: {
      type: 'category',
      data: heat.xLabels,
      splitArea: { show: false },
      axisLine: { lineStyle: { color: C.axis } },
      axisTick: { show: false },
      axisLabel: { ...label, interval: 0, rotate: heat.range === '30d' ? 45 : 0 },
    },
    yAxis: {
      type: 'category',
      data: heat.yLabels,
      splitArea: { show: false },
      axisLine: { lineStyle: { color: C.axis } },
      axisTick: { show: false },
      axisLabel: { ...label, interval: 0, show: !singleRow },
    },
    series: [
      {
        type: 'heatmap',
        data: heat.cells,
        itemStyle: { borderColor: '#000', borderWidth: 1 },
        emphasis: { itemStyle: { borderColor: '#fff', borderWidth: 1 } },
      },
    ],
  };
}

function heatTooltip(heat, p, lang) {
  if (!p?.value) return '';
  if (heat.range === '30d') {
    const day = heat.days[p.value[0]];
    return heatTipBody(day, p.value[2], heat.meta.get(day), lang);
  }
  if (heat.range === '24h') {
    const hour = p.value[0];
    const date = heat.hours[hour];
    const head = date
      ? `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(
          date.getHours(),
        ).padStart(2, '0')}:00-${String((date.getHours() + 1) % 24).padStart(2, '0')}:00`
      : '—';
    return heatTipBody(head, p.value[2], heat.meta.get(hour), lang);
  }
  const day = heat.days[p.value[1]];
  const hour = p.value[0];
  const head = day
    ? `${day} ${String(hour).padStart(2, '0')}:00-${String((hour + 1) % 24).padStart(2, '0')}:00`
    : '—';
  return heatTipBody(head, p.value[2], heat.meta.get(`${day}|${hour}`), lang);
}

function heatTipBody(head, total, meta, lang) {
  const usage = meta?.usage || {};
  return [
    `<div class="tt-tip-title">${escapeHtml(head)}</div>`,
    `<div class="tt-tip-row">${escapeHtml(t(lang, 'dashTotal'))}<b>${formatTokens(total)}</b></div>`,
    `<div class="tt-tip-row">${escapeHtml(t(lang, 'dashCacheRead'))}<b>${formatTokens(usage.cacheRead)}</b></div>`,
    `<div class="tt-tip-row">${escapeHtml(t(lang, 'dashSessions'))}<b>${meta?.sessions?.size || 0}</b></div>`,
    `<div class="tt-tip-row">${escapeHtml(t(lang, 'turns'))}<b>${meta?.turns?.size || 0}</b></div>`,
    `<div class="tt-tip-row">${escapeHtml(t(lang, 'dashCost'))}<b>${formatCost(usage.cost)}</b></div>`,
  ].join('');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
