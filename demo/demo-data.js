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
  {
    prompt: '先梳理一下 auth session refresh 的完整流程',
    answer: 'The refresh flow is split across the session store, the API client and the router guard. I will map the hand-off points first.',
    loops: [
      {
        thinking: 'Start from the refresh entry point and follow the token through the store and the request layer.',
        tools: [{ name: 'read', input: { filePath: 'src/auth/session.ts' }, output: 'session store loaded' }],
      },
    ],
  },
  {
    prompt: '帮我快速梳理一下这个仓库的结构',
    answer: 'Three layers: `src/server` exposes the API and SSE stream; `src/adapters` isolates storage; `src/workspace` and `src/dashboard` hold the session-facing UI logic. `test/` mirrors the critical paths and `scripts/` contains local tooling.',
    loops: [
      {
        thinking: 'List the top-level modules first, then confirm the request entry point.',
        tools: [{ name: 'bash', input: { command: 'find src -maxdepth 2 -type d | sort' }, output: 'src/api, src/auth, src/dashboard, src/server, src/workspace' }],
      },
      {
        thinking: 'Read the server entry point to verify how requests enter the system.',
        tools: [{ name: 'read', input: { filePath: 'src/server/index.ts' }, output: 'route registration loaded' }],
      },
    ],
  },
  {
    prompt: 'Where should I start reading this codebase?',
    answer: 'Start from `src/server/index.ts` for the request lifecycle, then `src/workspace/resolve.ts` for session selection, and finally `src/dashboard/store.ts` for the UI cache. The tests in `test/` show the intended contracts.',
    simple: true,
  },
  {
    prompt: 'Why does the dashboard stay on the old user after switching accounts?',
    answer: 'The selected user is cached in the dashboard store and is not invalidated when the auth session changes.',
    loops: [
      {
        thinking: 'Search for every place that reads or persists the selected user.',
        tools: [{ name: 'grep', input: { pattern: 'selectedUser|currentUser', include: 'src/**/*.ts' }, output: '9 matches in 4 files' }],
      },
      {
        thinking: 'The dashboard cache is the likely culprit. Read its subscription and reset path.',
        tools: [{ name: 'read', input: { filePath: 'src/dashboard/store.ts' }, output: 'cache subscription inspected' }],
      },
    ],
  },
  {
    prompt: '这个面板和普通终端日志有什么区别？',
    answer: '普通终端日志是一条线性 scrollback；这里把每轮对话展开成树，并在画布上按因果关系定位。查上下文不用再 PageUp / PageDown。',
    simple: true,
  },
  {
    prompt: 'Check how the terminal tab title maps to the active workspace',
    answer: 'The title format is `OC | <workspace>`. I will compare it with the workspace name before falling back to cwd.',
    loops: [
      {
        thinking: 'Verify the title parser before changing the workspace resolver.',
        tools: [{ name: 'read', input: { filePath: 'src/terminal-title.ts' }, output: 'parser located' }],
      },
    ],
  },
  {
    prompt: '把 active workspace 的判断提前到 cwd 之前',
    answer: 'I will resolve the workspace from the terminal title first, then fall back to the latest cwd session.',
    loops: [
      {
        thinking: 'Keep the fallback intact so terminals without a title still work.',
        tools: [{ name: 'edit', input: { filePath: 'src/workspace/resolve.ts' }, output: 'resolver updated' }],
      },
    ],
  },
  {
    prompt: '这个项目用的是什么测试运行器？',
    answer: '`node:test`。测试文件通过 `npm test` 运行，不依赖 Jest/Vitest。',
    simple: true,
  },
  {
    prompt: 'Add a usage aggregation endpoint for the admin dashboard',
    answer: 'The endpoint will aggregate sessions in a selected range and return compact KPI data.',
    loops: [
      {
        thinking: 'Read the existing API shape so the new endpoint stays consistent.',
        tools: [{ name: 'read', input: { filePath: 'src/server/routes.ts' }, output: 'route conventions loaded' }],
      },
      {
        thinking: 'Implement the aggregation without returning full event payloads.',
        tools: [{ name: 'write', input: { filePath: 'src/server/dashboard.ts' }, output: 'endpoint added' }],
      },
      {
        thinking: 'Run the focused tests and check the response shape.',
        tools: [{ name: 'test', input: { filePath: 'test/dashboard-history.test.ts' }, output: '7 tests passed' }],
      },
    ],
  },
  {
    prompt: '为什么全部会话要跟 24h / 7d / 30d 范围走？',
    answer: 'A bounded range keeps the query predictable and matches the heatmap window without loading full history.',
    loops: [
      {
        thinking: 'Check the documented constraint before changing the data model.',
        tools: [{ name: 'read', input: { filePath: 'SPEC.md' }, output: 'range constraint confirmed' }],
      },
    ],
  },
  {
    prompt: 'Does it read my private conversations?',
    answer: 'It reads local agent storage in read-only mode and serves it over localhost. Nothing is uploaded, and there is no telemetry or OCR.',
    simple: true,
  },
  {
    prompt: 'Handle 30 days of events without blocking the SSE stream',
    answer: 'I will aggregate in small batches and yield to the event loop between sessions.',
    loops: [
      {
        thinking: 'Measure the cost first; the index is large and the handler is synchronous.',
      },
      {
        thinking: 'The scan needs a bounded window and a yield point per session.',
        tools: [{ name: 'bash', input: { command: 'node scripts/measure-dashboard.mjs --days 30' }, output: '109 sessions / 2.4s' }],
      },
      {
        thinking: 'Apply the batched aggregation and re-run the measurement.',
        tools: [{ name: 'edit', input: { filePath: 'src/server/dashboard-history.ts' }, output: 'batched aggregation applied' }],
      },
    ],
  },
  {
    prompt: 'Verify cache hit rate after aggregation',
    answer: 'I will compare the existing KPI output with the new range aggregation on the same fixture.',
    loops: [
      {
        thinking: 'Use the same fixture and compare the cache KPI, not the raw usage totals.',
        tools: [{ name: 'test', input: { filePath: 'test/dashboard-history.test.ts' }, output: 'cache KPI matched' }],
      },
    ],
  },
  {
    prompt: 'Can you explain cacheRead vs cacheWrite in one paragraph?',
    answer: 'cacheRead is reused prompt context served from the prompt cache. cacheWrite is new context being written into the cache for a future call. Reads are cheaper; writes happen when the cache is cold or the prefix changes.',
    simple: true,
  },
  {
    prompt: 'Compare MySQL and SQLite adapters',
    answer: 'The SQLite adapter uses a single read-only connection, while MySQL needs a bounded connection pool.',
    loops: [
      {
        thinking: 'Inspect the MySQL adapter first, then compare its lifecycle with SQLite.',
        tools: [{ name: 'grep', input: { pattern: 'createPool|createConnection', include: 'src/adapters/mysql*' }, output: 'pool lifecycle found' }],
      },
      {
        thinking: 'SQLite is single-process. Confirm there is no hidden pool.',
        tools: [{ name: 'grep', input: { pattern: 'DatabaseSync|readOnly', include: 'src/adapters/sqlite*' }, output: 'single connection confirmed' }],
      },
    ],
  },
  {
    prompt: '除了 opencode / pi，其他 agent 支持吗？',
    answer: 'Codex、Kimi Code、ZCode、Cline 已有适配，但未大量验证；不同版本或安装方式可能需要自行调整适配层。',
    simple: true,
  },
  {
    prompt: '补 tests for range filtering and history mapping',
    answer: 'I will cover 24h/7d/30d filtering, unknown sources and the history-to-dashboard mapping.',
    loops: [
      {
        thinking: 'Cover the empty and out-of-range cases before the happy path.',
        tools: [{ name: 'test', input: { filePath: 'test/metrics.test.ts' }, output: '8 tests passed' }],
      },
    ],
  },
  {
    prompt: 'SSE 断线后前端会怎样？',
    answer: '状态会显示为「重连中」，当前会话数据保留；连接恢复后继续接收增量，不需要重新打开页面。',
    simple: true,
  },
  {
    prompt: 'Can I preview it without a local agent?',
    answer: 'Yes. Run `npm run demo`; it starts the UI with synthetic multi-turn data and five sessions for the Dashboard.',
    simple: true,
  },
  {
    prompt: 'Rewrite README around workspace switching',
    answer: 'I will lead with the PageUp/PageDown problem and keep implementation details out of the overview.',
    loops: [
      {
        thinking: 'Keep the setup section short and remove source-level details.',
        tools: [{ name: 'write', input: { filePath: 'README.md' }, output: 'README rewritten' }],
      },
    ],
  },
  {
    prompt: 'Why keep 24h as the default range?',
    answer: '24h is the cheapest useful window: it answers “what happened in this session today” without scanning 30 days of history. The range control is still one click away.',
    simple: true,
  },
  {
    prompt: 'Final pass: scan branches for sensitive info',
    answer: 'I will scan all branches and tags for credentials, local paths and private keys before publishing.',
    loops: [
      {
        thinking: 'Run a content scan first, then inspect branch tips for local paths.',
        tools: [{ name: 'bash', input: { command: 'git grep -I -n -E "token|secret|password" $(git rev-list --all)' }, output: 'no credential patterns' }],
      },
      {
        thinking: 'The only remaining hit is an old local path; rewrite the affected refs and prune objects.',
        tools: [{ name: 'bash', input: { command: 'git filter-branch --tree-filter ./redact.sh --all' }, output: 'refs rewritten' }],
      },
    ],
  },
];

function makeTurn({ index, startedAt, prompt, answer, loops, simple = false }) {
  if (simple) {
    const u = usage(index + 1);
    return {
      id: `turn-${index + 1}`,
      index,
      prompt,
      model: { provider: 'deepseek', id: 'deepseek-chat' },
      startedAt,
      endedAt: startedAt + 3_200,
      durationMs: 3_200,
      status: 'ok',
      usage: u,
      events: [
        { seq: 0, type: 'prompt', at: startedAt, data: { text: prompt } },
        {
          seq: 1,
          type: 'model-call',
          at: startedAt + 1_000,
          data: {
            model: { id: 'deepseek-chat' },
            provider: 'deepseek',
            request: { raw: '{"messages":[...]}' },
            response: { text: answer, usage: u },
          },
        },
        { seq: 2, type: 'answer', at: startedAt + 2_400, data: { text: answer } },
      ],
    };
  }

  const events = [];
  const total = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  let seq = 0;
  let offset = 0;
  const push = (type, at, data) => {
    events.push({ seq: seq++, type, at, data });
  };
  const add = (u) => {
    for (const key of Object.keys(total)) total[key] += u[key] || 0;
  };

  push('prompt', startedAt, { text: prompt });
  push('context', startedAt + 700, {
    text: 'Project conventions: TypeScript strict mode, pnpm workspace, latest CI run is green.',
    source: 'system',
  });
  offset = 1_600;

  loops.forEach((loop, loopIndex) => {
    const u = usage(index + 1 + loopIndex);
    add(u);
    const modelAt = startedAt + offset;
    const callId = (toolIndex) => `call-${index}-${loopIndex}-${toolIndex}`;
    const tools = loop.tools || [];
    const toolCalls = tools.map((tool, toolIndex) => ({
      id: callId(toolIndex),
      name: tool.name,
    }));

    push('model-call', modelAt, {
      model: { id: 'deepseek-chat' },
      provider: 'deepseek',
      request: { raw: '{"messages":[...]}' },
      response: {
        reasoning: loop.thinking,
        text: loop.text || '',
        usage: u,
        toolCalls,
      },
    });
    push('reasoning', modelAt + 400, { text: loop.thinking });
    offset += 2_600;

    tools.forEach((tool, toolIndex) => {
      const id = callId(toolIndex);
      push('tool-call', startedAt + offset, {
        name: tool.name,
        callId: id,
        input: tool.input,
      });
      offset += 1_700;
      push('tool-result', startedAt + offset, {
        callId: id,
        status: 'ok',
        output: tool.output || 'done',
        durationMs: 180 + toolIndex * 90,
      });
      offset += 700;
    });

    offset += 500;
  });

  push('answer', startedAt + offset + 800, { text: answer });
  const endedAt = startedAt + offset + 1_200;

  return {
    id: `turn-${index + 1}`,
    index,
    prompt,
    model: { provider: 'deepseek', id: 'deepseek-chat' },
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
    status: 'ok',
    usage: total,
    events,
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
  const turnGap = 6 * MINUTE;
  const mainStart = now - EVENTS.length * turnGap - 12 * MINUTE;
  const mainTurns = EVENTS.map((item, index) =>
    makeTurn({
      index,
      startedAt: mainStart + index * turnGap,
      prompt: item.prompt,
      answer: item.answer,
      loops: item.loops || [],
      simple: item.simple,
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
