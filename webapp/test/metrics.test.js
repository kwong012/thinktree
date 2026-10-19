import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDashboard,
  buildDashboardFromHistory,
  formatPct,
} from '../src/dashboard/metrics.js';

const NOW = new Date(2026, 9, 19, 12, 0, 0).getTime();
const at = (day, hour) => new Date(2026, 9, day, hour, 10, 0).getTime();

function turn(index, startedAt, usage) {
  return {
    index,
    id: `t${index}`,
    startedAt,
    endedAt: startedAt + 1000,
    status: 'ok',
    usage,
    model: { provider: 'p', id: 'm' },
    events: [{ seq: 0, type: 'step', at: startedAt, data: { usage } }],
  };
}

function session(id, turns, extra = {}) {
  return {
    id,
    title: id,
    model: { provider: 'p', id: 'm' },
    createdAt: turns[0]?.startedAt || 0,
    updatedAt: turns[turns.length - 1]?.startedAt || 0,
    turns,
    ...extra,
  };
}

test('aggregates usage, cache rate and generation', () => {
  const s = session('a', [
    turn(0, at(18, 10), {
      input: 100,
      output: 20,
      reasoning: 5,
      cacheRead: 800,
      cacheWrite: 10,
      cost: 0.1,
    }),
    turn(1, at(18, 11), {
      input: 200,
      output: 40,
      reasoning: 5,
      cacheRead: 1600,
      cacheWrite: 0,
      cost: 0.2,
    }),
  ]);
  const d = buildDashboard([s], { scope: 'session', currentSessionId: 'a', now: NOW });
  assert.equal(d.contextTokens, 100 + 800 + 10 + 200 + 1600);
  assert.equal(d.generated, 20 + 5 + 40 + 5);
  assert.equal(d.turns, 2);
  assert.equal(d.series.length, 2);
  assert.equal(formatPct(d.cacheRate), '88.6%');
  assert.equal(d.cost, 0.30000000000000004);
});

test('aggregates multiple sessions and keeps the session table', () => {
  const a = session('a', [turn(0, at(18, 20), { input: 10, cacheRead: 90 })]);
  const b = session('b', [turn(0, at(19, 2), { input: 20, cacheRead: 180 })]);
  const d = buildDashboard([a, b], { scope: 'agent', now: NOW });
  assert.equal(d.sessionRows.length, 2);
  assert.equal(d.turns, 2);
  assert.equal(d.contextTokens, 300);
  assert.equal(d.usage.cacheRead, 270);
  assert.equal(d.series.length, 2);
  assert.equal(d.heat.range, '24h');
  assert.equal(d.heat.cells.length, 24);
});

test('maps full historical dashboard data for agent scope', () => {
  const history = {
    totals: {
      usage: { input: 30, output: 6, reasoning: 2, cacheRead: 270, cacheWrite: 0, cost: 0.3 },
      turns: 2,
      contextTokens: 300,
      generated: 8,
      cost: 0.3,
      durationMs: 3600000,
    },
    sessionRows: [
      {
        id: 'a',
        title: 'a',
        model: { provider: 'p', id: 'm' },
        createdAt: at(18, 20),
        updatedAt: at(18, 20),
        turns: 1,
        usage: { input: 10, cacheRead: 90 },
        statuses: { ok: 1, error: 0, aborted: 0, running: 0 },
      },
      {
        id: 'b',
        title: 'b',
        model: { provider: 'p', id: 'm' },
        createdAt: at(19, 2),
        updatedAt: at(19, 2),
        turns: 1,
        usage: { input: 20, cacheRead: 180 },
        statuses: { ok: 1, error: 0, aborted: 0, running: 0 },
      },
    ],
    context: { events: 1, chars: 12, sources: [{ name: 'system', count: 1, chars: 12 }] },
    heatPoints: [
      { at: at(18, 20), usage: { input: 10, cacheRead: 90 }, sessionId: 'a', turnIndex: 0 },
      { at: at(19, 2), usage: { input: 20, cacheRead: 180 }, sessionId: 'b', turnIndex: 0 },
    ],
  };
  const d = buildDashboardFromHistory(history, {
    heatRange: '24h',
    currentSessionId: 'a',
    now: NOW,
  });
  assert.equal(d.scope, 'agent');
  assert.equal(d.sessionRows.length, 2);
  assert.equal(d.series.length, 2);
  assert.equal(d.sessionRows.find((r) => r.id === 'a').isCurrent, true);
  assert.equal(d.contextTokens, 300);
  assert.equal(d.generated, 8);
  assert.equal(d.turns, 2);
  assert.equal(d.context.sources[0].name, 'system');
  assert.equal(d.heat.hasData, true);
  assert.equal(d.heat.cells.length, 24);
});

test('supports 24h, 7d and 30d heat ranges', () => {
  const s = session('a', [
    turn(0, at(18, 20), { input: 10, cacheRead: 90 }),
    turn(1, at(19, 2), { input: 10, cacheRead: 90 }),
  ]);
  const h24 = buildDashboard([s], { scope: 'agent', heatRange: '24h', now: NOW }).heat;
  const d7 = buildDashboard([s], { scope: 'agent', heatRange: '7d', now: NOW }).heat;
  const d30 = buildDashboard([s], { scope: 'agent', heatRange: '30d', now: NOW }).heat;
  assert.equal(h24.mode, 'hour');
  assert.equal(h24.xLabels.length, 24);
  assert.equal(h24.cells.length, 24);
  assert.equal(d7.mode, 'grid');
  assert.equal(d7.yLabels.length, 7);
  assert.equal(d7.cells.length, 168);
  assert.equal(d30.mode, 'grid');
  assert.equal(d30.cells.length, 30);
  assert.equal(d30.xLabels.length, 30);
});

test('handles empty usage and missing turns', () => {
  const d = buildDashboard(
    [{ id: 'empty', title: 'empty', model: {}, turns: [], usage: { input: 0 } }],
    { scope: 'agent', now: NOW },
  );
  assert.equal(d.turns, 0);
  assert.equal(d.total, 0);
  assert.equal(formatPct(d.cacheRate), '—');
  assert.equal(d.heat.cells.length, 24);
  assert.equal(d.heat.hasData, false);
});
