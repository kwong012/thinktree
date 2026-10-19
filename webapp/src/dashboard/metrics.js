export const ZERO_USAGE = {
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
};

const USAGE_KEYS = Object.keys(ZERO_USAGE);

export function normalizeUsage(u = {}) {
  const out = { ...ZERO_USAGE };
  for (const k of USAGE_KEYS) {
    const v = Number(u?.[k]);
    out[k] = Number.isFinite(v) && v > 0 ? v : 0;
  }
  return out;
}

export function addUsage(a, b) {
  const next = { ...a };
  const u = normalizeUsage(b);
  for (const k of USAGE_KEYS) next[k] += u[k];
  return next;
}

export function hasUsage(u) {
  return USAGE_KEYS.some((k) => (Number(u?.[k]) || 0) > 0);
}

export function sumUsage(list = []) {
  return list.reduce((acc, u) => addUsage(acc, u), { ...ZERO_USAGE });
}

export function sessionUsage(session) {
  const turns = session?.turns || [];
  const fromTurns = sumUsage(turns.map((t) => t.usage));
  if (hasUsage(fromTurns)) return fromTurns;
  return normalizeUsage(session?.usage);
}

export function modelLabel(model) {
  if (!model || (!model.id && !model.provider)) return '—';
  const provider = model.provider ? `${model.provider}/` : '';
  const variant = model.variant && model.variant !== 'default' ? ` (${model.variant})` : '';
  return `${provider}${model.id || '?'}${variant}`;
}

export function formatTokens(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(v >= 10e9 ? 1 : 2)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(v >= 10e6 ? 1 : 2)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(v >= 10e3 ? 1 : 2)}k`;
  return String(Math.round(v));
}

export function formatCost(n) {
  const v = Number(n) || 0;
  if (!v) return '$0';
  return v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`;
}

export function formatPct(rate) {
  if (!Number.isFinite(rate)) return '—';
  return `${(Math.max(0, Math.min(1, rate)) * 100).toFixed(1)}%`;
}

export function formatDuration(ms) {
  const v = Number(ms) || 0;
  if (v <= 0) return '—';
  const min = Math.round(v / 60000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  if (h < 24) return rest ? `${h}h ${rest}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function formatShortTitle(title, max = 18) {
  const text = String(title || '').replace(/\s+/g, ' ').trim();
  if (!text) return '—';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function percentileMax(values) {
  if (!values.length) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return Math.max(1, sorted[i]);
}

function addContext(stats, event) {
  const text = event?.data?.text || event?.data?.notice || '';
  const chars = typeof text === 'string' ? text.length : JSON.stringify(text).length;
  const source = event?.data?.source || 'context';
  stats.events += 1;
  stats.chars += chars;
  const prev = stats.sources.get(source) || { name: source, count: 0, chars: 0 };
  prev.count += 1;
  prev.chars += chars;
  stats.sources.set(source, prev);
}

function collectPoints(sessions) {
  const points = [];
  for (const session of sessions) {
    for (const turn of session.turns || []) {
      const steps = (turn.events || [])
        .filter((e) => e.type === 'step' && hasUsage(e.data?.usage))
        .map((e) => ({ at: e.at || turn.startedAt, usage: e.data.usage }));
      const entries = steps.length
        ? steps
        : [{ at: turn.startedAt || turn.endedAt, usage: turn.usage }];
      for (const entry of entries) {
        if (!entry.at || !hasUsage(entry.usage)) continue;
        points.push({
          at: entry.at,
          usage: normalizeUsage(entry.usage),
          sessionId: session.id,
          turnIndex: turn.index,
        });
      }
    }
  }
  return points;
}

const HOUR = 3600000;

function startOfHour(ms) {
  const d = new Date(ms);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function addPoint(map, key, point, extra) {
  const bucket = map.get(key) || {
    ...extra,
    usage: { ...ZERO_USAGE },
    sessions: new Set(),
    turns: new Set(),
  };
  bucket.usage = addUsage(bucket.usage, point.usage);
  bucket.sessions.add(point.sessionId);
  bucket.turns.add(`${point.sessionId}:${point.turnIndex}`);
  map.set(key, bucket);
}

export function buildHeatFromPoints(points, range = '24h', now = Date.now()) {
  if (range === '24h') {
    const endHour = startOfHour(now);
    const firstHour = endHour - 23 * HOUR;
    const hours = Array.from({ length: 24 }, (_, i) => new Date(firstHour + i * HOUR));
    const buckets = new Map();
    for (const point of points) {
      if (point.at < firstHour || point.at > now + 60000) continue;
      const index = Math.floor((startOfHour(point.at) - firstHour) / HOUR);
      if (index < 0 || index > 23) continue;
      addPoint(buckets, index, point, { hour: index });
    }
    const values = [];
    const cells = [];
    for (let index = 0; index < 24; index += 1) {
      const bucket = buckets.get(index);
      const value = bucket ? dayValuesOf(bucket.usage) : 0;
      values.push(value);
      cells.push([index, 0, value]);
    }
    return {
      range,
      mode: 'hour',
      cells,
      values,
      hasData: values.some((v) => v > 0),
      meta: buckets,
      max: percentileMax(values),
      xLabels: hours.map((d) => String(d.getHours()).padStart(2, '0')),
      yLabels: ['24h'],
      hours,
      days: [],
      start: dateKey(new Date(firstHour)),
      end: dateKey(new Date(endHour)),
    };
  }

  if (range === '30d') {
    const endDay = startOfDay(now);
    const firstDay = endDay - 29 * 86400000;
    const days = Array.from({ length: 30 }, (_, i) =>
      dateKey(new Date(firstDay + i * 86400000)),
    );
    const buckets = new Map();
    for (const point of points) {
      if (point.at < firstDay || point.at > now + 60000) continue;
      const day = dateKey(new Date(point.at));
      addPoint(buckets, day, point, { day });
    }
    const values = [];
    const cells = [];
    for (let index = 0; index < days.length; index += 1) {
      const bucket = buckets.get(days[index]);
      const value = bucket ? dayValuesOf(bucket.usage) : 0;
      values.push(value);
      cells.push([index, 0, value]);
    }
    return {
      range,
      mode: 'grid',
      cells,
      values,
      hasData: values.some((v) => v > 0),
      meta: buckets,
      max: percentileMax(values),
      xLabels: days.map((day) => day.slice(5)),
      yLabels: ['30d'],
      hours: [],
      days,
      start: days[0],
      end: days[days.length - 1],
    };
  }

  const endDay = startOfDay(now);
  const firstDay = endDay - 6 * 86400000;
  const days = Array.from({ length: 7 }, (_, i) =>
    dateKey(new Date(firstDay + i * 86400000)),
  );
  const dayIndex = new Map(days.map((day, i) => [day, i]));
  const buckets = new Map();
  for (const point of points) {
    if (point.at < firstDay || point.at > now + 60000) continue;
    const date = new Date(point.at);
    const day = dateKey(date);
    if (!dayIndex.has(day)) continue;
    addPoint(buckets, `${day}|${date.getHours()}`, point, {
      day,
      hour: date.getHours(),
    });
  }
  const values = [];
  const cells = [];
  for (let row = 0; row < days.length; row += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const bucket = buckets.get(`${days[row]}|${hour}`);
      const value = bucket ? dayValuesOf(bucket.usage) : 0;
      values.push(value);
      cells.push([hour, row, value]);
    }
  }
  return {
    range,
    mode: 'grid',
    cells,
    values,
    hasData: values.some((v) => v > 0),
    meta: buckets,
    max: percentileMax(values),
    xLabels: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')),
    yLabels: days.map((day) => day.slice(5)),
    days,
    hours: [],
    start: days[0],
    end: days[days.length - 1],
  };
}

function buildHeat(sessions, range = '24h', now = Date.now()) {
  return buildHeatFromPoints(collectPoints(sessions), range, now);
}

function dayValuesOf(usage) {
  return usage.input + usage.output + usage.reasoning + usage.cacheRead + usage.cacheWrite;
}

export function buildDashboard(
  sessions,
  { scope = 'agent', heatRange = '24h', currentSessionId = null, now = Date.now() } = {},
) {
  const list = (sessions || []).filter(Boolean);
  const sessionRows = list
    .map((session) => {
      const usage = sessionUsage(session);
      const contextTokens = usage.input + usage.cacheRead + usage.cacheWrite;
      return {
        id: session.id,
        title: session.title || session.id,
        short: formatShortTitle(session.title || session.id),
        model: modelLabel(session.model),
        updatedAt: session.updatedAt || 0,
        turns: session.turns?.length || 0,
        usage,
        contextTokens,
        generated: usage.output + usage.reasoning,
        cacheRate: contextTokens ? usage.cacheRead / contextTokens : NaN,
        cost: usage.cost,
        isCurrent: session.id === currentSessionId,
        statuses: countStatuses(session.turns),
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const current = list.find((s) => s.id === currentSessionId) || list[0] || null;
  const scoped = scope === 'session' ? (current ? [current] : []) : list;
  const seriesRows = scope === 'session' ? turnRows(current) : sessionRows.slice().sort((a, b) => a.updatedAt - b.updatedAt);
  const usage = sumUsage(scoped.map((s) => sessionUsage(s)));
  const contextTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  const generated = usage.output + usage.reasoning;
  const turns = scoped.reduce((n, s) => n + (s.turns?.length || 0), 0);
  const modelMap = new Map();
  const statuses = { ok: 0, error: 0, aborted: 0, running: 0 };
  const context = { events: 0, chars: 0, sources: new Map() };

  for (const session of scoped) {
    for (const turn of session.turns || []) {
      const name = modelLabel(turn.model?.id || turn.model?.provider ? turn.model : session.model);
      const prev = modelMap.get(name) || { name, turns: 0, usage: { ...ZERO_USAGE } };
      prev.turns += 1;
      prev.usage = addUsage(prev.usage, turn.usage);
      modelMap.set(name, prev);
    }
    const sc = countStatuses(session.turns);
    for (const k of Object.keys(statuses)) statuses[k] += sc[k];
    for (const turn of session.turns || []) {
      for (const event of turn.events || []) {
        if (event.type === 'context') addContext(context, event);
      }
    }
  }

  const starts = scoped.map((s) => s.createdAt || s.turns?.[0]?.startedAt || 0).filter(Boolean);
  const ends = scoped.map((s) => s.updatedAt || s.turns?.[s.turns.length - 1]?.endedAt || 0).filter(Boolean);
  const durationMs = starts.length && ends.length ? Math.max(...ends) - Math.min(...starts) : 0;

  return {
    scope,
    heatRange,
    sessionRows,
    series: seriesRows,
    usage,
    contextTokens,
    generated,
    total: contextTokens + generated,
    cacheRate: contextTokens ? usage.cacheRead / contextTokens : NaN,
    cost: usage.cost,
    turns,
    durationMs,
    models: [...modelMap.values()].sort((a, b) => b.usage.input + b.usage.output - (a.usage.input + a.usage.output)),
    statuses,
    context: {
      events: context.events,
      chars: context.chars,
      sources: [...context.sources.values()].sort((a, b) => b.chars - a.chars),
    },
    heat: buildHeat(scoped, heatRange, now),
    currentId: current?.id || null,
    loadedSessions: list.length,
  };
}

export function buildDashboardFromHistory(
  history,
  { heatRange = '24h', currentSessionId = null, now = Date.now() } = {},
) {
  const rows = (history?.sessionRows || []).map((row) => {
    const usage = normalizeUsage(row.usage);
    const contextTokens = usage.input + usage.cacheRead + usage.cacheWrite;
    return {
      id: row.id,
      title: row.title || row.id,
      short: formatShortTitle(row.title || row.id),
      model: modelLabel(row.model),
      updatedAt: row.updatedAt || 0,
      turns: row.turns || 0,
      usage,
      contextTokens,
      generated: usage.output + usage.reasoning,
      cacheRate: contextTokens ? usage.cacheRead / contextTokens : NaN,
      cost: usage.cost,
      isCurrent: row.id === currentSessionId,
      statuses: row.statuses || { ok: 0, error: 0, aborted: 0, running: 0 },
    };
  });
  const sessionRows = rows.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  const totals = history?.totals || {};
  const usage = normalizeUsage(totals.usage);
  const contextTokens = totals.contextTokens ?? usage.input + usage.cacheRead + usage.cacheWrite;
  const generated = totals.generated ?? usage.output + usage.reasoning;

  return {
    scope: 'agent',
    heatRange,
    sessionRows,
    series: sessionRows.slice().sort((a, b) => a.updatedAt - b.updatedAt),
    usage,
    contextTokens,
    generated,
    total: contextTokens + generated,
    cacheRate: contextTokens ? usage.cacheRead / contextTokens : NaN,
    cost: usage.cost,
    turns: totals.turns ?? sessionRows.reduce((n, r) => n + r.turns, 0),
    durationMs: totals.durationMs || 0,
    models: [],
    statuses: history?.statuses || { ok: 0, error: 0, aborted: 0, running: 0 },
    context: history?.context || { events: 0, chars: 0, sources: [] },
    heat: buildHeatFromPoints(history?.heatPoints || [], heatRange, now),
    currentId: currentSessionId,
    loadedSessions: sessionRows.length,
  };
}

function turnRows(session) {
  if (!session) return [];
  return (session.turns || []).map((turn) => {
    const usage = normalizeUsage(turn.usage);
    const contextTokens = usage.input + usage.cacheRead + usage.cacheWrite;
    return {
      id: `${session.id}:${turn.index}`,
      label: `#${turn.index + 1}`,
      title: turn.prompt || `#${turn.index + 1}`,
      model: modelLabel(turn.model?.id || turn.model?.provider ? turn.model : session.model),
      updatedAt: turn.startedAt || 0,
      turns: 1,
      status: turn.status,
      usage,
      contextTokens,
      generated: usage.output + usage.reasoning,
      cacheRate: contextTokens ? usage.cacheRead / contextTokens : NaN,
      cost: usage.cost,
    };
  });
}

export function countStatuses(turns = []) {
  const out = { ok: 0, error: 0, aborted: 0, running: 0 };
  for (const turn of turns) {
    if (out[turn.status] != null) out[turn.status] += 1;
  }
  return out;
}
