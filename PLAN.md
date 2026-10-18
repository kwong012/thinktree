# thinktree · 实施编排 (PLAN)

> 依据 `SPEC.md`。本文件定义**模块边界、接口契约、交付阶段与验收点**。实现严格按此编排推进。

## 1. 目录与模块边界

```
thinktree/
├── SPEC.md                 约束与规格（唯一需求来源）
├── PLAN.md                 本文件（编排）
├── package.json            后端（零运行时依赖）
├── src/
│   ├── schema/trace.js     统一数据模型（契约）
│   ├── sources/            各 agent 源（每个 agent 一个文件）
│   │   ├── opencode.js     本期唯一源
│   │   └── _adapter.md     适配器接口约定
│   ├── proc.js             进程存活 + 前台窗口聚焦（PowerShell 轮询）
│   ├── registry.js         汇总所有源的活会话，标注 alive/focused/lastActive
│   ├── server/index.js     后端 API + SSE + 托管前端产物
│   └── web/
│       ├── dist/           前端构建产物（git 忽略）
│       └── index.html      开发回退占位
├── webapp/                 前端工程（依赖隔离，独立 node_modules）
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx
│       ├── App.jsx         外壳：连接、tab 栏
│       ├── api.js          /api 客户端 + SSE
│       ├── layout.js       dagre 分层布局 + d3-force 概览
│       ├── lody.js         zoom → LOD 档位
│       └── canvas/
│           ├── GraphCanvas.jsx
│           └── nodes/      SendNode / ReasonNode / ToolNode / AnswerNode…
└── workfile-temp/          临时文件（git 忽略）
```

## 2. 依赖隔离规则（硬约束）

- **后端 `package.json` 无任何 dependencies**；只用 Node 内置（`node:sqlite`/`node:http`/`node:fs`…）。
- **前端依赖全部在 `webapp/`**（react / @xyflow/react / @dagrejs/dagre / d3-force / vite）。
- 前端**不**直接读文件/进程；一切经后端 `/api`。
- 构建：`npm run build:web` → 产物进 `src/web/dist`，由后端托管；开发用 `npm run dev:web`（vite 代理 `/api` → 后端）。

## 3. 接口契约

### 3.1 Source 适配器（`src/sources/<agent>.js`）
```js
export function create<Agent>Source(opts) {
  return {
    id, name, interface, available,      // 元信息
    listLiveSessions(procSnapshot),      // → 活会话摘要[]
    getSession(rawId),                   // → 统一 Session（含 turns/events）
    subscribe(cb)                        // 可选：变更回调（实时）
  }
}
```

### 3.2 后端 API（见 SPEC §9）
`/api/agents` · `/api/session/:source/:id` · `/api/stream`(SSE) · `/api/proc`

### 3.3 前端引擎（纯函数，可单测）
- `layout.js`：`buildGraph(session) → {nodes, edges}`；`layoutDagre(nodes, edges)`；`layoutForce(nodes, edges)`。
- `lody.js`：`lodFor(zoom) → 'far'|'mid'|'near'`（阈值可配）。

## 4. 交付阶段与验收

### Phase 0 — 约束与编排 ✅（本文件 + SPEC.md）
- 验收：SPEC/PLAN 存在且一致；git 仓库已建。

### Phase 1 — 后端骨架（可达、可测）
- 交付：`proc.js`、`sources/opencode.js`（由现有 adapter 迁移）、`registry.js`、`server/index.js`。
- 验收：
  - `GET /api/proc` 返回运行中的 agent 进程 + 前台窗口。
  - `GET /api/agents` 只返回**活会话**（opencode 进程存活时）。
  - `GET /api/session/opencode/<id>` 返回统一 Session。
  - `/api/stream` SSE 在会话更新后 ≤2s 推送一次。

### Phase 2 — 前端骨架 + 画布
- 交付：webapp 工程、`App.jsx`（tab 栏）、《GraphCanvas》、节点组件。
- 验收：
  - 拉取 `/api/agents`，每个活会话一个 tab。
  - 画布用 dagre 渲染 `发送→思考/工具→回答`，含连线。
  - 无限画布可平移/缩放。

### Phase 3 — 语义缩放 LOD
- 交付：`lody.js` + 节点按档位切换渲染。
- 验收：远（只留结构与连线）/ 中（标题）/ 近（细节+IO）三档正确切换。

### Phase 4 — 实时联通
- 交付：`api.js` SSE 客户端，增量更新画布。
- 验收：opencode 产生新事件 → 面板 ≤2s 出现新节点；进程退出 → tab 消失。

### Phase 5 — 端到端验收
- 验收：开一个真实 opencode 会话跑一轮工具调用，面板实时、正确呈现整个信息流。

### Phase 6 — 扩展源（后续）
- 依次新增 `sources/{pi,cline,kimi,zcode,codex}.js`，每个只依赖 §3.1 契约，**不动 UI**。

## 5. 任务看板

| # | 任务 | 阶段 | 状态 |
|---|---|---|---|
| 1 | SPEC.md | 0 | ✅ |
| 2 | PLAN.md | 0 | ✅ |
| 3 | git 仓库 + .gitignore | 0 | ✅ |
| 4 | 依赖隔离（webapp 工程骨架） | 0 | ⬜ |
| 5 | src/proc.js 进程/聚焦 | 1 | ⬜ |
| 6 | src/sources/opencode.js 迁移 | 1 | ⬜ |
| 7 | src/registry.js | 1 | ⬜ |
| 8 | src/server/index.js 重写 | 1 | ⬜ |
| 9 | webapp 骨架 + tab 栏 | 2 | ⬜ |
| 10 | GraphCanvas + 节点组件 | 2 | ⬜ |
| 11 | 语义缩放 LOD | 3 | ⬜ |
| 12 | SSE 实时联通 | 4 | ⬜ |
| 13 | 端到端联调 | 5 | ⬜ |
