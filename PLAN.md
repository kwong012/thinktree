# thinktree · 实施编排 (PLAN)

> 依据 `SPEC.md`。本文件定义模块边界、接口契约与当前进度。

## 1. 目录结构

```
thinktree/
├── SPEC.md / PLAN.md / AGENTS.md
├── package.json                 后端（零运行时依赖）
├── src/
│   ├── schema/trace.js          统一数据模型（契约）
│   ├── proc.js                  进程存活 + 前台窗口聚焦（PowerShell worker）
│   ├── registry.js              汇总所有源的活会话
│   ├── sources/
│   │   ├── index.js             源注册表
│   │   ├── util.js              JSONL/SQLite 解析共用工具
│   │   ├── opencode.js          SQLite（v2 + legacy）
│   │   ├── pi.js                pi JSONL
│   │   ├── codex.js             Codex rollout JSONL
│   │   ├── kimi.js              Kimi wire.jsonl + state.json
│   │   ├── zcode.js             ZCode SQLite
│   │   └── cline.js             Cline VSCode 任务
│   ├── adapters/                opencode 底层读取器 + 配置
│   ├── server/index.js          API + SSE + 托管前端产物
│   └── web/dist/                前端构建产物（git 忽略）
├── webapp/                      前端工程（依赖隔离）
│   └── src/
│       ├── App.jsx              外壳 / tab / 主题 / 语言
│       ├── api.js               /api 客户端 + SSE
│       ├── layout.js            树 + 分层网格布局、防重叠
│       ├── lod.js               zoom → LOD
│       ├── i18n.js              中英词典
│       ├── styles.css           主题变量与全部样式
│       ├── canvas/
│       │   ├── GraphCanvas.jsx  画布外壳：工具栏、展开、物理模式、轨迹开关
│       │   ├── CanvasStage.jsx  Canvas 2D 渲染器：节点/边/视口裁剪/小地图/交互
│       │   ├── NodeDetail.jsx   展开详情（单个 DOM 覆盖层）
│       │   ├── DesignTree.jsx   左侧轨迹树
│       │   ├── KindIcon.jsx     自绘极简 SVG 图标
│       │   ├── physics.js       局部唤醒碰撞求解（return / stay）
│       │   └── context.js       LOD / 语言 / 展开上下文
│       └── dashboard/
│           ├── Dashboard.jsx    右侧抽屉：范围、KPI、图表、会话表
│           ├── metrics.js       usage / 缓存 / 上下文 / 热力图聚合
│           ├── options.js       ECharts 图表配置
│           ├── EChart.jsx       ECharts 实例、resize、dispose
│           └── dashboard.css    Dashboard 样式
├── workfile-temp/               临时文件（git 忽略）
```

## 2. Source 接口

```js
{
  id, name, interface, description, available,
  processPatterns: RegExp[],                     // 进程存活判定
  listLive(procSnapshot) -> { processes, sessions },
  getSession(rawId) -> 统一 Session
}
```

新增 agent：在 `sources/` 加文件 + 在 `sources/index.js` 登记，**不动 UI/server**。

## 3. 进度

| 模块 | 状态 |
|---|---|
| 统一 schema / 模型调用节点 | ✅ |
| 进程存活 + 前台聚焦（PowerShell） | ✅ |
| opencode 源（v2 + legacy） | ✅ |
| pi 源 | ✅ |
| Codex 源 | ✅ |
| Kimi 源 | ✅ |
| ZCode 源 | ✅ |
| Cline 源（无任务时 available=false） | ✅ |
| 后端 API / SSE | ✅ |
| 前端工程 / 依赖隔离 | ✅ |
| 树状 + 分层网格布局（接近方形） | ✅ |
| 语义缩放 LOD | ✅ |
| 框内展开（实测高度重排） | ✅ |
| 拖拽 / 框选 / 实时避让 / 30px 间距 / 回弹 | ✅ |
| 流动虚线 + 最新上下文高亮 + 焦点洋红高亮 | ✅ |
| 远档全量色块 + 骨架连线 + 非缩放线宽 | ✅ |
| 提问包络框 + 整轮拖动 | ✅ |
| 可交互大号小地图（可隐藏） | ✅ |
| Canvas 2D 渲染（批量路径 / 视口裁剪 / 无节点 DOM） | ✅ |
| 局部唤醒物理（return / stay，默认 return） | ✅ |
| 性能：7200 节点 / 7998 连线压测（p95 约 12–18ms） | ✅ |
| 深/浅主题 + 中英切换 + SVG 图标 | ✅ |
| `thinkTREE` 品牌字标 | ✅ |
| Dashboard：agent 全活会话聚合 + 缓存/上下文/token + 24h/7d/30d 热力图 | ✅ |
| 提交规范（每次改动即提交） | ✅（见 AGENTS.md） |

## 4. 后续可选

- ZCode `rollout/model-io-*.jsonl` 原始 request/response 透传到 model-call 节点。
- JSONL 增量 tail（避免每次整文件读取）。
- PTY 兜底源（无本地存储的 CLI agent）。
- 移除已不参与渲染的 `@xyflow/react` 依赖。
- 更多 agent（Claude Code、Gemini CLI 等）。

## 5. 启动 / 停止

- 双击根目录 `thinktree.bat`：打开交互菜单（启动/停止/状态/浏览器/日志/清空）。
- `[1]` 启动服务并自动用 Edge/Chrome 全屏（F11）打开浏览器。
- 关闭浏览器标签/窗口后，SSE 客户端归零，服务在 2 秒后自动退出。
- 手动运行：`npm start`，默认端口 `9178`（`PORT` 可覆盖）。
- 前端开发：`npm run dev:web`（Vite `5518`，`/api` 代理到 `9178`）。

## 6. 会话定位

- CLI/TUI：优先跟随 Windows Terminal 当前选中的 tab；否则读取进程 cwd，显示每个 cwd 的最新会话（不列历史）。
- opencode：读取 `OC | <会话标题>` 标签页，按 session title 精确匹配；标题不在最近 100 条时按标题补查数据库。
- pi：读取 Windows Terminal 标签页 `π - <会话名> - <用户>`，按 `session_info.name` 精确匹配。
- 桌面端：不参与 cwd 匹配。
