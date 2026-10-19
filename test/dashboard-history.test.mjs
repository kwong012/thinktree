import test from 'node:test';
import assert from 'node:assert/strict';
import { getDashboardHistory } from '../src/dashboard-history.js';

const NOW = Date.now();
const at = (offsetMs) => NOW + offsetMs;

function makeSession(id, updatedAt, usage, source = 'system') {
  return {
    id,
    title: id,
    model: { provider: 'p', id: 'm' },
    createdAt: updatedAt - 1000,
    updatedAt,
    usage,
    turns: [
      {
        index: 0,
        startedAt: updatedAt - 1000,
        endedAt: updatedAt,
        status: 'ok',
        usage,
        events: [
          { seq: 0, type: 'context', at: updatedAt - 900, data: { source, text: 'ctx' } },
          { seq: 1, type: 'step', at: updatedAt, data: { usage } },
        ],
      },
    ],
  };
}

test('aggregates only sessions inside the requested history range', async () => {
  const fresh = makeSession('fresh', at(-60_000), {
    input: 10,
    output: 2,
    reasoning: 1,
    cacheRead: 90,
    cacheWrite: 0,
    cost: 0.01,
  });
  const stale = makeSession('stale', at(-40 * 86400_000), {
    input: 999,
    output: 999,
    reasoning: 999,
    cacheRead: 999,
    cacheWrite: 999,
    cost: 9.99,
  });
  const byId = new Map([
    [fresh.id, fresh],
    [stale.id, stale],
  ]);
  const source = {
    listSessions: () => [fresh, stale],
    getSession: (id) => byId.get(id) || null,
  };
  const registry = {
    getSource: (id) => (id === 'fixture-range' ? source : null),
  };

  const data = await getDashboardHistory(registry, 'fixture-range', '7d');
  assert.equal(data.range, '7d');
  assert.equal(data.sessionRows.length, 1);
  assert.equal(data.sessionRows[0].id, 'fresh');
  assert.equal(data.totals.turns, 1);
  assert.equal(data.totals.contextTokens, 100);
  assert.equal(data.totals.generated, 3);
  assert.equal(data.context.events, 1);
  assert.equal(data.context.sources[0].name, 'system');
  assert.equal(data.heatPoints.length, 1);
  assert.equal(data.heatPoints[0].sessionId, 'fresh');
  assert.equal(data.heatPoints[0].turnIndex, 0);
});

test('returns null for an unknown source', async () => {
  const registry = { getSource: () => null };
  assert.equal(await getDashboardHistory(registry, 'missing-fixture', '24h'), null);
});
