# 项目约定

## Git 分支

- 当前开发分支为 `master`；后续改动提交到该分支。
- 合并或切换工作分支后，同步更新本行。

## Git 提交

- **每次改动完成后立即提交**，不必再询问用户（用户明确要求）。
- 提交前确保前端可构建：`npm run build:web`（或在 `webapp/` 下 `npm run build`）。
- 只提交源码与文档；`node_modules/`、`src/web/dist/`、`workfile-temp/`、`.playwright-mcp/` 已被忽略。
- 提交信息用简洁英文，`type: summary` 风格（如 `feat: ...`、`fix: ...`）。

## 远程推送

- 默认只推送 `master`、`dash`、`test`；`xiaoguo` 保留本地，不推送。
- 不推送历史标签，除非明确需要。

## 仓库卫生

- `.gitignore` 已覆盖依赖、构建产物、运行时临时文件、日志、测试产物与环境变量。
- 不提交本地绝对路径、凭据、`.env` 或数据库/日志文件；默认路径用 `homedir()` 拼接，并允许环境变量覆盖。
