# thinktree · 约束与规格 (SPEC)

> 本文件是项目的**唯一约束来源**。实现与本文件冲突时以实现为准；需求变更先改本文件。

## 1. 目标

一个**运行时实时**驱动的 **agent 工作底层面板**：把每个 agent 从「发送」到「返回答案」之间的信息流可视化。

- 只面向**当前存活的 agent**；CLI/TUI 优先跟随 Windows Terminal 当前选中的 tab（opencode `OC | <title>`、pi `π - ...`），否则取 cwd 最新会话；不做历史浏览。
- 多 agent 并行时用 **tab** 区分。
- 主区是**无限画布**，自由缩放/平移，**语义缩放（LOD）**：缩小仍保留信息，放大展开细节。
- 每次**发送**、每次**回答**各是一个框；中间过程（模型调用/思考/工具）也是节点；**因果与上下文关系用连线表达**。

## 2. 非目标

- ❌ 模型内部计算（权重/注意力/logits/KV cache）。客户端拿不到。
- ❌ 推理引擎内部调度（prefill/decode/batching）。
- ❌ 历史会话浏览/回放（面板只显示存活进程对应的当前会话；Dashboard 可按范围聚合历史统计，不提供逐条回放）。
- ❌ 截屏 / OCR（各家都有本地结构化存储）。
- ❌ 逐字滚动的直播轨迹。

## 3. 术语

| 术语 | 含义 |
|---|---|
| Source | 一个 agent 的实时数据来源（存储 + 适配器） |
| Session | 一次会话，含多个 Turn |
| Turn | 一次「发送 → 返回答案」 |
| Event | Turn 内一步（prompt/context/model-call/reasoning/tool-call/tool-result/step/answer/…） |
| Alive | 对应 agent 进程存活 |

## 4. 捕获源（已实现）

**读原生本地存储**，不做屏幕捕获。desktop 与 CLI 版写同一存储。

| Agent | 数据源 | 解析要点 |
|---|---|---|
| **opencode** | `~/.local/share/opencode/opencode.db` | SQLite；`session_v2`+`session_message`（v2）或 `session`+`message`+`part`（legacy） |
| **pi** | `~/.pi/agent/sessions/**/*.jsonl` | `session`/`model_change`/`message`；assistant 内容含 `thinking`/`text`/`toolCall`，自带 usage |
| **Codex** | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | `session_meta`/`response_item`(message·reasoning·function_call·output)/`event_msg`(token_count·task_*) |
| **Kimi Code** | `~/.kimi-code/sessions/<wd>/<sid>/` | `state.json`（标题/时间）+ `agents/main/wire.jsonl`（`turn.prompt`、`context.append_loop_event`: step/content.part/tool.call/tool.result/step.end） |
| **ZCode** | `~/.zcode/cli/db/db.sqlite` | `session`+`message`+`part`（与 opencode legacy 同构）；另有 `rollout/model-io-*.jsonl` 原始 IO |
| **Cline** | `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\tasks\<id>\` | `task_metadata.json` + `api_conversation_history.json` + `ui_messages.json`（无任务时 available=false） |

路径覆盖：`OPENCODE_DB`、`PI_SESSION_DIR`、`CODEX_SESSION_DIR`、`KIMI_CODE_HOME`、`ZCODE_DB`、`CLINE_TASKS_DIR`；opencode 配置目录可用 `OPENCODE_CONFIG_DIR`。

分层策略：L1 读原生存储（已覆盖全部）；L2 hook/插件；L3 PTY 兜底（未实现）。

## 5. 统一数据模型（契约）

见 `src/schema/trace.js`：

```
Source  { id, name, interface, available, description }
Session { id, sourceId, title, agent, model{provider,id,variant},
          directory, createdAt, updatedAt, usage, turns[] }
Turn    { id, index, agent, model, startedAt, endedAt, durationMs,
          status: ok|error|aborted|running, usage, error?, prompt, events[] }
Event   { seq, type, at, data }
        type ∈ prompt | context | model-call | reasoning | tool-call
              | tool-result | step | answer | switch | status | note
```

**硬约束**：UI 只读此模型；新增 agent = 新增一个 source，**不改 UI**。

### 5.1 模型调用节点（model-call）

- 每次模型调用一个节点，展开可看 `request`（能拿到的部分）与 `response`（思考/文本/工具调用/usage）。
- 有原始 IO 的源（ZCode `model-io-*.jsonl`）可在后续透传 `raw`。
- 仍不包含模型内部计算。

## 6. 存活与聚焦

- **进程存活**：PowerShell 常驻 worker，每秒输出进程表 + `GetForegroundWindow` 前台窗口。
- **会话存活**：agent 进程存活 **且** 会话在活跃窗口内（30 分钟）或为最近会话。
- **聚焦**：前台窗口进程匹配 agent 时标记 focused；TUI 跑在终端里时读取 Windows Terminal 当前选中的 tab（opencode/pi），失败再回退「最近活跃」。
- **Tab 排序**：聚焦优先 → 最近活跃倒序。

## 7. 技术选型

| 项 | 选择 |
|---|---|
| 运行时 | Node ≥ 22.5（`node:sqlite`），后端零运行时依赖 |
| 后端 | `node:http` + SSE |
| 进程/聚焦 | PowerShell 轮询（base64 传参避免乱码） |
| 前端 | Vite 8 + React 19（独立 `webapp/`，依赖隔离） |
| 画布 | 自研 Canvas 2D（`CanvasStage.jsx`）：节点/边批量路径 + 视口裁剪，无逐节点 DOM |
| 布局 | 自研：以提问为根的树 + 分层网格（每轮 4 簇/行、轮次网格排布，整体接近方形） |
| 语义缩放 | 读 viewport zoom → far/mid/near 三档 |
| 动效 | 连线流动虚线；节点位移回弹缓动；镜头平滑过渡 |
| 物理 | 仅唤醒碰撞相关节点（上限 800）；`return` 回弹 / `stay` 停留，默认 `return` |
| 端口 | 默认 `9178`（`PORT` 环境变量覆盖）；Vite dev `5518`，`/api` 代理到 `9178` |
| 环境变量 | `OPENCODE_DB` / `PI_SESSION_DIR` / `CODEX_SESSION_DIR` / `KIMI_CODE_HOME` / `ZCODE_DB` / `CLINE_TASKS_DIR` 覆盖数据源路径；`OPENCODE_CONFIG_DIR` 覆盖配置目录；`TT_EXIT_ON_CLIENT_CLOSE=1` 控制浏览器关闭后退出 |
| Dashboard | 右侧抽屉；ECharts 6（懒加载）+ Radix Dialog；当前会话或当前 agent 指定范围内的全量历史会话 |

## 8. 依赖隔离

- 后端 `package.json` **无 dependencies**（仅 Node 内置）。
- 前端依赖全部在 `webapp/`，构建产物输出 `src/web/dist`，由后端托管。
- 前端只经 `/api` 取数，不直接读文件/进程。
- `@xyflow/react` 仍在依赖清单中，但已不参与渲染（Canvas 2D 接管），后续移除。
- Dashboard 依赖只进 `webapp/`；ECharts 通过动态 import 懒加载，不进入首屏包。

## 9. 后端 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/agents` | 存活 agent + 活会话 + `alive/focused` 标记 |
| GET | `/api/session/:source/:id` | 归一化会话（含 turns/events） |
| GET | `/api/dashboard/:source?range=24h\|7d\|30d` | 指定范围的历史 Dashboard 聚合（不含事件正文） |
| GET | `/api/stream` | SSE：agents 快照 + 会话增量 |
| GET | `/api/proc` | 进程/聚焦快照（调试） |

## 10. UI 行为

- **画布**：无限平移/缩放；中/右键拖拽平移，滚轮缩放。
- **布局**：每轮以提问为根、向下扩散；整体长宽比约束在 **1:1.5 ~ 1.5:1**（当前约 1.16:1）。
- **语义缩放**：远（轻量色块）/ 中（标题+摘要）/ 近（完整内容），任何档位都保留信息。
- **远档**：保留全部节点（按类型染色），只显示提问主线/跨轮上下文/当前轮连线；线宽不随缩放变细。
- **提问包络**：点击提问 → 出现整轮包络框并选中整轮；拖动任一成员整轮一起移动。
- **小地图**：390×255 独立 Canvas（缓存底图）；单击跳转 / 拖拽视口 / 滚轮缩放 / 可隐藏。
- **性能**：Canvas 批量绘制 + 视口裁剪；仅当前轮连线动画；SSE 只推变化轮；7200 节点 / 7998 连线平移帧耗时 p95 约 12ms（近）/ 18ms（远）。
- **展开**：点击框 → 框整体变大显示完整详情（单个 DOM 覆盖层，无内部滚动），按实测高度重新布局。
- **避让**：框间最小间距 30px；拖动时被压到的框实时让位；位移带回弹缓动；工具栏可切「回弹 / 停留」。
- **交互**：可拖拽任意框；中/右键拖拽平移；滚轮缩放；双击回到最新；空白左键拖拽框选，Shift/Ctrl/Cmd 多选不触发展开。
- **连线**：流动虚线；跨轮「上下文」虚线；最新一轮的上下文检索/缓存命中高亮（琥珀色）。
- **焦点高亮**：点击某框时，该框及直接相连的上下文关系用洋红高亮（与其它高亮配色区分）。
- **主题/语言**：深/浅主题、中/英切换；图标为自绘 SVG 线稿（不使用 emoji）。
- **品牌**：`thinkTREE` 字标；左侧 t 型分叉节点（白色笔画 + 青色节点），第二个 `T` 青色。
- **Dashboard**：右上角「数据」按钮展开右侧抽屉，宽度 78%（75–80%），高度占满画布区；保留顶部栏/tab/session 切换。「全部会话」统计当前 agent 在所选 24h/7d/30d 范围内的全量历史会话；「当前会话」仍只统计当前会话。范围控件位于头部，热力图默认近 24 小时，可切近 7 天/近 30 天；24h 为逐小时条带，7d 为日期×小时网格，30d 为逐日条带。按 ESC/关闭按钮/顶部按钮收起，不遮挡顶部控件、不重排画布。

## 11. 风险

- 各 agent JSONL/SQLite 为内部格式，可能随版本变化 → 解析保守 + 容错。
- TUI 标签标题缺失/重复/截断 → 回退 cwd 最新会话或最近活跃。
- 超大活跃文件（数 MB）读取成本高 → 只读末尾窗口；后续改为增量 tail。
- Cline 任务目录在某些安装/未使用场景不存在 → available=false。
