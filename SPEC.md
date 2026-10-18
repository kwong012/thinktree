# thinktree · 约束与规格 (SPEC)

> 本文件是整个项目的**唯一约束来源**。任何实现若与本文件冲突，以实现本文件为准；若要变更需求，先改本文件。

## 1. 目标 (Goal)

一个**运行时实时**驱动的 **agent 工作底层面板**：把每个 agent 从"发送"到"返回答案"之间的**完整信息流**可视化。

- 面向**当前存活的会话**（不回溯历史）。
- 多个 agent 并行时**区分**，每个 agent 一个 **tab**。
- 主区是**无限画布**，自由缩放/平移，**语义缩放（LOD）**：
  - 缩小时像 Obsidian 关系图——自动隐藏次要信息，只留结构与连线；
  - 放大时自动展开细节。
- 每次**发送**与每次**回答**各是一个**节点框**；框之间展示**底层流程**；**工具调用**也是节点；**前后关联**用连线表达。

## 2. 非目标 (Non-Goals)

明确**不做**：

- ❌ 模型内部原理（权重、注意力、token 概率分布）——客户端看不到。
  （但**模型调用的输入/输出**要看，见 §5.1）
- ❌ 推理引擎内部（prefill/decode、KV Cache、batching、调度）——属服务端。
- ❌ 历史会话浏览/回放（只跟活会话）。
- ❌ 截屏 / OCR（见 §4，各家都有本地结构化存储，无需屏幕识别）。
- ❌ DeepSeek-harness 那种逐字滚动直播轨迹。

## 3. 术语

| 术语 | 含义 |
|---|---|
| **Source（源）** | 一个 agent 的实时数据来源（某存储 + watcher）。 |
| **Agent** | 一个 agent 产品（opencode / pi / Cline / Kimi / ZCode / Codex…）。 |
| **Session（会话）** | 一次 agent 对话，含多个 Turn。 |
| **Turn（轮）** | **一次"发送→返回答案"**，是本面板的核心单位。 |
| **Event（事件）** | Turn 内按信息流顺序发生的一步（发送/上下文/思考/工具调用/工具返回/步骤/回答/状态…）。 |
| **Alive（存活）** | 对应 agent 进程存活（见 §6）。 |

## 4. 捕获策略（已调研定案）

**读各家原生本地存储**（client 侧可见、结构化、实时），**不做屏幕捕获**。desktop 版与 CLI 版写同一份存储，因此一个 adapter 覆盖该 agent 的 CLI/TUI/desktop 三种形态。

已在本机核实存在：

| Agent | 形态 | 数据源 | 格式 / 增量 |
|---|---|---|---|
| opencode | CLI/TUI(+desktop) | `~/.local/share/opencode/opencode.db` | SQLite(WAL) → 轮询 |
| pi | CLI/TUI/RPC | `~/.pi/agent/sessions/--<cwd>--/*.jsonl` | JSONL 树(id/parentId/leafId) → tail |
| Cline | VSCode 插件 | `<globalStorage>/saoudrizwan.claude-dev/tasks/<id>/*.json` | 整文件重写 → 轮询 |
| Kimi Code | CLI/TUI(+app) | `~/.kimi-code/sessions/<wdKey>/<sid>/agents/main/wire.jsonl` | JSONL → tail |
| ZCode | desktop+CLI | `~/.zcode/cli/db/db.sqlite` + `~/.zcode/cli/rollout/model-io-*.jsonl` | SQLite+JSONL |
| Codex | CLI+Desktop | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | JSONL → tail |

**分层策略**（未来扩展）：
- **L1 读原生存储**（首选，覆盖以上全部）。
- **L2 Hook/插件**（agent 提供事件/钩子时，如 opencode plugin）。
- **L3 PTY 包裹**（万能兜底，用于**没有**存储的 agent；非本期范围）。

## 5. 统一数据模型（Source 与 UI 的契约）

所有源归一化为同一套 trace（见 `src/schema/trace.js`）：

```
Source  { id, name, interface, available, description }
Session { id, sourceId, title, agent, model{provider,id,variant},
          directory, worktree, createdAt, updatedAt, usage, turns[] }
Turn    { id, index, agent, model, startedAt, endedAt, durationMs,
          status: ok|error|aborted|running, usage, error?, prompt, events[] }
Event   { seq, type, at, data }
        type ∈ prompt | context | model-call | reasoning | tool-call | tool-result
              | step | answer | switch | status | note
```

**硬约束**：UI 只读此模型；新增 agent = 新增一个 adapter，**不改 UI**。

### 5.1 模型调用节点（model-call）

- 画布上每次**模型调用**是一个节点，展开可看 `request`（发给模型的内容）与 `response`（模型返回的内容）。
- 能拿到的边界：完整输入上下文、思考、回答、工具调用、usage；有原始 IO 的源（ZCode `model-io-*.jsonl`）透传 `raw`。
- **仍不包含**模型内部计算（权重/注意力/logits/KV cache）。

## 6. 存活与聚焦规则 (Liveness & Focus)

- **进程存活**：轮询进程表，匹配可执行名（`opencode`/`pi`/`codex`/`kimi`/`zcode`/`Code` 等）。实现：PowerShell 轮询（`Get-Process`），Windows 优先。
- **会话存活**：`agent 进程存活` 且（该会话最近活跃 / 该会话 cwd 被进程持有）。活跃窗口默认 **120s**。
- **聚焦**：`GetForegroundWindow` → pid → 进程名 → 映射到 agent。
  - 桌面/IDE agent（ZCode / Codex Desktop / VSCode-Cline）可**直接映射**；
  - TUI agent 跑在终端里（前台进程是终端），**回退到"最近活跃"**判定。
- **Tab 排序**：`聚焦` 优先 → 其余按 `lastActive` 倒序。
- **实时**：源用 `fs.watch`/tail 或轮询兜底（依据存储格式），增量归一化后经 SSE 推给前端。

## 7. 技术选型 (Tech Decisions)

| 项 | 选择 | 备注 |
|---|---|---|
| 运行时 | Node ≥ 22.5 | 用内置 `node:sqlite`，后端零重依赖 |
| 后端 | `node:http` + SSE | 无框架 |
| 进程/聚焦 | PowerShell 轮询 | 零编译 |
| 前端 | **Vite + React** | 独立工程，依赖隔离 |
| 画布 | **@xyflow/react (React Flow)** | 无限画布/平移缩放/minimap/自定义节点 |
| 布局 | **@dagrejs/dagre** 分层 DAG + **d3-force** 概览 | dagre 走主流程，d3-force 做缩小辐射图 |
| 语义缩放 | 读 viewport zoom → 切节点详情档位 | 3 档 LOD |
| 平台 | Windows 优先 | 其余平台留接口 |

## 8. 依赖隔离约束

- 前端独立 `webapp/package.json`；构建产物输出到后端静态目录，由后端托管。
- 后端**不引入**前端依赖；前端**不直接**读文件/进程，只经后端 API。
- 所有非交付临时文件放 `workfile-temp/`（见全局 AGENTS.md）。

## 9. 后端 API 契约

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/agents` | 存活 agent 列表 + 各自的活会话 + `alive/focused/lastActive` 标记 |
| GET | `/api/session/:source/:id` | 归一化后的单个 Session（含 turns/events） |
| GET | `/api/stream` | SSE：活会话增量（新增事件/新 turn/状态变化） |
| GET | `/api/proc` | 进程/聚焦快照（调试用） |

## 10. 验收总则 (Definition of Done)

- 只显示**活会话**；进程退出后其 tab 自动消失。
- 每个 Turn 在画布上呈现为：`发送框 → (上下文/思考/工具…) → 回答框`，**连线表达因果**。
- **语义缩放**三档正确切换（远=只留结构与连线；近=展开细节）。
- 实时：agent 产出新事件后，前端在 **≤2s** 内出现对应节点。
- 多 agent 并行时各自一个 tab，聚焦者优先。

## 11. 风险与待定

- TUI 聚焦映射（终端 → 具体 agent 会话）存在不确定性 → 先用 lastActive 兜底。
- opencode 进程 ↔ 具体 session 无直接 pid 映射 → 先用"最近活跃 + 进程存活"启发式。
- 各 agent JSONL schema 为内部格式、可能随版本变 → 每个 adapter 做**保守解析 + 容错**，未知字段透传。
- SQLite/WAL 读取需只读打开，避免干扰写方。
