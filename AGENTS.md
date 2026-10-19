# 项目约定

## Git 分支

- 当前开发分支为 `test`；后续改动提交到该分支。
- 合并或切换工作分支后，同步更新本行。

## Git 提交

- **每次改动完成后立即提交**，不必再询问用户（用户明确要求）。
- 提交前确保前端可构建：`npm run build:web`（或在 `webapp/` 下 `npm run build`）。
- 只提交源码与文档；`node_modules/`、`src/web/dist/`、`workfile-temp/`、`.playwright-mcp/` 已被忽略。
- 提交信息用简洁英文，`type: summary` 风格（如 `feat: ...`、`fix: ...`）。
