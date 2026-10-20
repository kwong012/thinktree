# thinkTREE

实时观察 AI agent 如何把一次提问变成答案。

thinkTREE 读取本机 agent 的结构化会话存储，把「发送 → 上下文 → 模型调用 → 思考 → 工具 → 回答」渲染成可缩放的工作轨迹画布，并提供按 agent 聚合的用量 Dashboard。

> 只读本地数据，不上传、不截屏、无遥测。

![thinkTREE 画布与 Dashboard](docs/screenshot.png)

## 特性

- **多 agent 并行观察**：顶部 tab 区分 opencode / pi / codex / kimi / zcode / cline。
- **Canvas 2D 工作轨迹**：节点与连线批量绘制、视口裁剪，支持大量节点。
- **语义缩放（LOD）**：远看结构、中看摘要、近看细节。
- **实时跟随**：自动跟随终端当前选中的会话；SSE 增量更新。
- **拖拽与碰撞**：节点可拖动，支持「停留 / 回弹」两种物理模式。
- **左侧轨迹树**：按轮次展开步骤，点击直接定位节点。
- **Dashboard**：当前会话或所选时间范围内的全量历史会话；token、缓存、上下文、费用、轮次、热力图与会话明细。

## 快速开始

要求：

- Node.js **>= 22.5**（使用 `node:sqlite`）
- Windows 10/11（进程存活、cwd 与 Windows Terminal tab 跟随依赖 PowerShell / UIAutomation）
- 其他平台可运行前端与文件型数据源，但进程/终端相关能力会降级

```bash
# 安装前端依赖
npm run web:install

# 构建前端
npm run build:web

# 启动（默认 http://localhost:9178）
npm start
```

Windows 也可以直接双击 `thinktree.bat`，使用交互菜单启动 / 停止 / 查看日志。

前端开发：

```bash
npm run dev:web   # Vite 5518，/api 代理到 9178
```

## 支持的 agent

| Agent | 本地数据 |
|---|---|
| **opencode** | `~/.local/share/opencode/opencode.db`（SQLite v2 + legacy） |
| **pi** | `~/.pi/agent/sessions/**/*.jsonl` |
| **Codex** | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` |
| **Kimi Code** | `~/.kimi-code/sessions/<wd>/<sid>/` |
| **ZCode** | `~/.zcode/cli/db/db.sqlite` |
| **Cline** | `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\tasks\<id>\` |

## Dashboard

- **当前会话**：只统计当前打开的会话。
- **全部会话**：统计当前 agent 在所选 **24h / 7d / 30d** 范围内的全部历史会话。
- 范围控件位于 Dashboard 头部，同时作用于全部会话的 KPI、Token、缓存趋势、上下文构成、会话表与热力图。

![Dashboard](docs/dashboard.png)

## 环境变量

| 变量 | 作用 |
|---|---|
| `PORT` | 后端端口，默认 `9178` |
| `OPENCODE_DB` | opencode SQLite 路径 |
| `OPENCODE_CONFIG_DIR` | opencode 配置目录 |
| `PI_SESSION_DIR` | pi 会话目录 |
| `CODEX_SESSION_DIR` | Codex 会话目录 |
| `KIMI_CODE_HOME` | Kimi Code 数据目录 |
| `ZCODE_DB` | ZCode SQLite 路径 |
| `CLINE_TASKS_DIR` | Cline 任务目录 |
| `TT_EXIT_ON_CLIENT_CLOSE` | 设为 `1` 时，浏览器全部关闭后退出服务 |

## 架构

```text
src/
  server/           HTTP API + SSE + 静态资源
  sources/          各 agent 的数据源适配器
  adapters/         opencode SQLite 读取
  dashboard-history 历史 Dashboard 聚合
  schema/           统一 trace 数据模型
webapp/
  src/canvas/       Canvas 2D 画布与交互
  src/dashboard/    ECharts Dashboard
  src/motion.js     统一缓动与补间
```

后端零运行时依赖，只使用 Node 内置模块；前端依赖隔离在 `webapp/`，构建产物输出到 `src/web/dist/`，由后端托管。

## 测试

```bash
npm test
```

包含 Dashboard 历史聚合与前端指标映射测试。

## 隐私

thinkTREE 只读取本机 agent 的本地存储，并通过本地 HTTP 提供给浏览器：

- 不上传会话内容
- 不截图 / OCR
- 无遥测
- SQLite 以只读模式打开

## License

尚未选择开源许可证；上传 GitHub 前请补充 `LICENSE`。
