/**
 * dashboard-history.js — 「全部会话」scope 的历史聚合。
 *
 * 只按所选时间范围读取会话，返回紧凑的 Dashboard 数据：
 * 会话行、totals、context 汇总与热力图点，不返回事件正文。
 */
import { usageOf } from './sources/util.js';

const RANGE_MS = {
  '24h': 24 * 3600_000,
  '7d': 7 * 24 * 3600_000,
  '30d': 30 * 24 * 3600_000,
};
const CACHE_TTL = 25_000;

const cache = new Map();
const inflight = new Map();

export function normalizeRange(value) {
  return RANGE_MS[value] ? value : '24h';
}

const ZERO = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };

function hasUsage(u) {
  return ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite', 'cost'].some(
    (k) => (Number(u?.[k]) || 0) > 0,
  );
}

function addUsage(a, b) {
  const u = usageOf(b);
  for (const k of Object.keys(ZERO)) a[k] += u[k] || 0;
  return a;
}

function countStatuses(turns = []) {
  const out = { ok: 0, error: 0, aborted: 0, running: 0 };
  for (const turn of turns) {
    if (out[turn.status] != null) out[turn.status] += 1;
  }
  return out;
}

function addContext(context, event) {
  const text = event?.data?.text || event?.data?.notice || '';
  const chars =
    typeof text === 'string' ? text.length : text == null ? 0 : JSON.stringify(text).length;
  const source = event?.data?.source || 'context';
  context.events += 1;
  context.chars += chars;
  const prev = context.sources.get(source) || { name: source, count: 0, chars: 0 };
  prev.count += 1;
  prev.chars += chars;
  context.sources.set(source, prev);
}

async function build(src, sourceId, range) {
  const now = Date.now();
  const since = now - RANGE_MS[range];
  const list = (src.listSessions ? src.listSessions({ limit: -1 }) : []) || [];
  const rows = [];
  const heatPoints = [];
  const totals = {
    usage: { ...ZERO },
    turns: 0,
    contextTokens: 0,
    generated: 0,
    cost: 0,
    durationMs: 0,
  };
  const context = { events: 0, chars: 0, sources: new Map() };
  const statuses = { ok: 0, error: 0, aborted: 0, running: 0 };

  for (const item of list) {
    if ((item.updatedAt || 0) < since) continue;
    let session;
    try {
      session = src.getSession(item.id);
    } catch {
      session = null;
    }
    if (!session) continue;

    const turnUsage = (session.turns || []).reduce(
      (acc, turn) => addUsage(acc, turn.usage),
      { ...ZERO },
    );
    const usage = hasUsage(turnUsage) ? turnUsage : usageOf(session.usage);
    const rowStatuses = countStatuses(session.turns);
    for (const key of Object.keys(statuses)) statuses[key] += rowStatuses[key];

    rows.push({
      id: session.id,
      title: session.title || item.title || session.id,
      model: session.model || {},
      createdAt: session.createdAt || item.createdAt || 0,
      updatedAt: session.updatedAt || item.updatedAt || 0,
      turns: session.turns?.length || 0,
      usage,
      statuses: rowStatuses,
    });

    addUsage(totals.usage, usage);
    totals.turns += session.turns?.length || 0;
    for (const turn of session.turns || []) {
      let stepPoints = 0;
      for (const event of turn.events || []) {
        if (event.type === 'context') addContext(context, event);
        if (event.type !== 'step') continue;
        const u = usageOf(event.data?.usage);
        if (!hasUsage(u)) continue;
        heatPoints.push({
          at: event.at || turn.startedAt || turn.endedAt || 0,
          usage: u,
          sessionId: session.id,
          turnIndex: turn.index,
        });
        stepPoints += 1;
      }
      if (!stepPoints) {
        const u = usageOf(turn.usage);
        if (hasUsage(u)) {
          heatPoints.push({
            at: turn.startedAt || turn.endedAt || 0,
            usage: u,
            sessionId: session.id,
            turnIndex: turn.index,
          });
        }
      }
    }

    // 让出事件循环，避免大库聚合阻塞 SSE tick。
    await new Promise((resolve) => setImmediate(resolve));
  }

  totals.contextTokens = totals.usage.input + totals.usage.cacheRead + totals.usage.cacheWrite;
  totals.generated = totals.usage.output + totals.usage.reasoning;
  totals.cost = totals.usage.cost;
  const starts = rows.map((r) => (r.createdAt ? Math.max(r.createdAt, since) : 0)).filter(Boolean);
  const ends = rows.map((r) => r.updatedAt).filter(Boolean);
  if (starts.length && ends.length) totals.durationMs = Math.max(...ends) - Math.min(...starts);

  return {
    sourceId,
    range,
    since,
    generatedAt: Date.now(),
    totals,
    sessionRows: rows.sort((a, b) => b.updatedAt - a.updatedAt),
    context: {
      events: context.events,
      chars: context.chars,
      sources: [...context.sources.values()].sort((a, b) => b.chars - a.chars),
    },
    statuses,
    heatPoints,
  };
}

/** 获取历史聚合；同 source + range 并发请求共享一次计算。 */
export function getDashboardHistory(registry, sourceId, rangeInput) {
  const range = normalizeRange(rangeInput);
  const key = `${sourceId}:${range}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return Promise.resolve(hit.data);
  if (inflight.has(key)) return inflight.get(key);

  const src = registry.getSource(sourceId);
  if (!src) return Promise.resolve(null);

  const task = build(src, sourceId, range)
    .then((data) => {
      cache.set(key, { at: Date.now(), data });
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, task);
  return task;
}
