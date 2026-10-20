/**
 * Synthetic multi-turn demo data for screenshots and local previews.
 * No real conversations, credentials or local paths.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const usage = (i = 1) => ({
  input: 820 * i,
  output: 360 * i,
  reasoning: 120 * i,
  cacheRead: 6800 * i,
  cacheWrite: 90 * i,
  cost: 0.0028 * i,
});

const EVENTS = [
  ['先梳理一下 auth session refresh 的完整流程', 'The refresh flow is split across the session store, the API client and the router guard. I will map the hand-off points first.', 'read', { filePath: 'src/auth/session.ts' }],
  ['Why does the dashboard stay on the old user after switching accounts?', 'The selected user is cached in the dashboard store and is not invalidated when the auth session changes.', 'grep', { pattern: 'selectedUser|currentUser', include: 'src/**/*.ts' }],
  ['Check how the terminal tab title maps to the active workspace', 'The title format is `OC | <workspace>`. I will compare it with the workspace name before falling back to cwd.', 'read', { filePath: 'src/terminal-title.ts' }],
  ['把 active workspace 的判断提前到 cwd 之前', 'I will resolve the workspace from the terminal title first, then fall back to the latest cwd session.', 'edit', { filePath: 'src/workspace/resolve.ts' }],
  ['Add a usage aggregation endpoint for the admin dashboard', 'The endpoint will aggregate sessions in a selected range and return compact KPI data.', 'write', { filePath: 'src/server/dashboard.ts' }],
  ['为什么全部会话要跟 24h / 7d / 30d 范围走？', 'A bounded range keeps the query predictable and matches the heatmap window without loading full history.', 'read', { filePath: 'SPEC.md' }],
  ['Handle 30 days of events without blocking the SSE stream', 'I will aggregate in small batches and yield to the event loop between sessions.', 'edit', { filePath: 'src/server/dashboard-history.ts' }],
  ['Verify cache hit rate after aggregation', 'I will compare the existing KPI output with the new range aggregation on the same fixture.', 'test', { filePath: 'test/dashboard-history.test.ts' }],
  ['Compare MySQL and SQLite adapters', 'The SQLite adapter uses a single read-only connection, while MySQL needs a bounded connection pool.', 'grep', { pattern: 'createAdapter|DatabaseSync', include: 'src/**/*.ts' }],
  ['补 tests for range filtering and history mapping', 'I will cover 24h/7d/30d filtering, unknown sources and the history-to-dashboard mapping.', 'test', { filePath: 'test/metrics.test.ts' }],
  ['Rewrite README around workspace switching', 'I will lead with the PageUp/PageDown problem and keep implementation details out of the overview.', 'write', { filePath: 'README.md' }],
  ['Final pass: scan branches for sensitive info', 'I will scan all branches and tags for credentials, local paths and private keys before publishing.', 'bash', { command: 'git grep -I -n -E "token|secret|password" --all-match' }],
];

function makeTurn({ index, startedAt, prompt, reasoning, answer, tool, input }) {
  const u = usage(index + 1);
  return {
    id: `turn-${index + 1}`,
    index,
    prompt,
    model: { provider: 'deepseek', id: 'deepseek-chat' },
    startedAt,
    endedAt: startedAt + 18_000,
    durationMs: 18_000,
    status: 'ok',
    usage: u,
    events: [
      { seq: 0, type: 'prompt', at: startedAt, data: { text: prompt } },
      {
        seq: 1,
        type: 'context',
        at: startedAt + 700,
        data: {
          text: 'Project conventions: TypeScript strict mode, pnpm workspace, latest CI run is green.',
          source: 'system',
        },
      },
      {
        seq: 2,
        type: 'model-call',
        at: startedAt + 1_400,
        data: {
          model: { id: 'deepseek-chat' },
          provider: 'deepseek',
          request: { raw: '{"messages":[...]}' },
          response: {
            reasoning,
            text: answer,
            usage: u,
            toolCalls: [{ id: `call-${index}`, name: tool }],
          },
        },
      },
      {
        seq: 3,
        type: 'tool-call',
        at: startedAt + 6_400,
        data: { name: tool, callId: `call-${index}`, input },
      },
      {
        seq: 4,
        type: 'tool-result',
        at: startedAt + 8_600,
        data: { callId: `call-${index}`, status: 'ok', output: 'done', durationMs: 210 },
      },
      {
        seq: 5,
        type: 'answer',
        at: startedAt + 15_000,
        data: { text: answer },
      },
    ],
  };
}

function compactSession(id, title, updatedAt, turnCount, multiplier) {
  const createdAt = updatedAt - turnCount * 4 * MINUTE;
  const turns = Array.from({ length: turnCount }, (_, index) => {
    const startedAt = createdAt + index * 4 * MINUTE;
    const u = usage(multiplier);
    return {
      id: `${id}-turn-${index + 1}`,
      index,
      prompt: index === 0 ? title : `Follow-up ${index + 1} for ${title}`,
      model: { provider: 'deepseek', id: 'deepseek-chat' },
      startedAt,
      endedAt: startedAt + 12_000,
      durationMs: 12_000,
      status: 'ok',
      usage: u,
      events: [
        { seq: 0, type: 'prompt', at: startedAt, data: { text: index === 0 ? title : `Follow-up ${index + 1}` } },
        {
          seq: 1,
          type: 'model-call',
          at: startedAt + 1_000,
          data: {
            model: { id: 'deepseek-chat' },
            provider: 'deepseek',
            response: { text: 'Handled in the demo fixture.', usage: u },
          },
        },
        { seq: 2, type: 'answer', at: startedAt + 8_000, data: { text: 'Handled in the demo fixture.' } },
      ],
    };
  });
  const total = turns.reduce(
    (acc, turn) => {
      for (const key of Object.keys(acc)) acc[key] += turn.usage[key] || 0;
      return acc;
    },
    { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
  );
  return {
    id,
    title,
    agent: 'opencode',
    model: { provider: 'deepseek', id: 'deepseek-chat' },
    directory: 'D:/work/atlas-web',
    createdAt,
    updatedAt,
    usage: total,
    turns,
  };
}

export function buildDemoSessions(now = Date.now()) {
  const mainStart = now - 92 * MINUTE;
  const mainTurns = EVENTS.map(([prompt, answer, tool, input], index) =>
    makeTurn({
      index,
      startedAt: mainStart + index * 7 * MINUTE,
      prompt,
      answer,
      tool,
      input,
      reasoning:
        index % 2 === 0
          ? 'Trace the data flow end to end before touching the implementation.'
          : 'Keep the change scoped and verify the fallback path.',
    }),
  );
  const main = {
    id: 'demo-main',
    title: 'Refactor auth session refresh / 会话刷新重构',
    agent: 'opencode',
    model: { provider: 'deepseek', id: 'deepseek-chat' },
    directory: 'D:/work/atlas-web',
    createdAt: mainStart - 10 * MINUTE,
    updatedAt: now - 2 * MINUTE,
    usage: mainTurns.reduce(
      (acc, turn) => {
        for (const key of Object.keys(acc)) acc[key] += turn.usage[key] || 0;
        return acc;
      },
      { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    ),
    turns: mainTurns,
  };

  return [
    main,
    compactSession('demo-history-1', 'Investigate token refresh race', now - 4 * HOUR, 7, 5),
    compactSession('demo-history-2', 'Cache invalidation review', now - 1 * DAY - 3 * HOUR, 5, 4),
    compactSession('demo-history-3', 'Migrate audit log schema', now - 2 * DAY - 2 * HOUR, 8, 6),
    compactSession('demo-history-4', 'Fix workspace switcher', now - 3 * DAY - 5 * HOUR, 4, 3),
  ];
}
