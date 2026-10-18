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
│       └── canvas/
│           ├── GraphCanvas.jsx  画布、展开、拖拽、避让、高亮
│           ├── NodeCard.jsx     节点卡片 / 框内展开详情
│           ├── FlowEdge.jsx     流动虚线边
│           ├── KindIcon.jsx     自绘极简 SVG 图标
│           └── context.js       LOD / 语言 / 展开上下文
└── workfile-temp/               临时文件（git 忽略）
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
| 性能：视口裁剪 / 部分 SSE / 静态边 | ✅ |
| 深/浅主题 + 中英切换 + SVG 图标 | ✅ |
| 提交规范（每次改动即提交） | ✅（见 AGENTS.md） |

## 4. 后续可选

- ZCode `rollout/model-io-*.jsonl` 原始 request/response 透传到 model-call 节点。
- JSONL 增量 tail（避免每次整文件读取）。
- PTY 兜底源（无本地存储的 CLI agent）。
- 大数据量下的虚拟化/性能优化。
- 更多 agent（Claude Code、Gemini CLI 等）。
