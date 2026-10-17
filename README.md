# Teach me, Agent

用户留在当前软件中操作，Agent 用短句和屏幕上的指引一步步教学。

本分支从空白开始重建。旧工作在 `codex/companion-rebuild` 的 `54623c6`。

## 项目规划

- [计划入口](docs/rebuild/README.md)
- [产品规格](docs/rebuild/PRODUCT.md)
- [架构](docs/rebuild/ARCHITECTURE.md)
- [任务状态](docs/rebuild/tasks.json)
- [接续记录与限制](docs/rebuild/PROGRESS.md)
- [验收标准](docs/rebuild/ACCEPTANCE.md)
- [原始设计决议](docs/DESIGN-NOTES.md)

## 开发

Windows + Node.js 24。

```powershell
npm ci
npm run check
npm run app
```

Agent 从命令行启动教学：`node bin/teach-me.mjs start --topic '学习使用软件'`。随后使用 `wait`、`say`、`capture`、`show`。详情：`node bin/teach-me.mjs help`。

UI 不包含浏览器模拟后端，必须由 Electron 加载；`npm run dev` 只用于前端开发，不能代替真实桌面运行。

当前实现与未验证能力详见接续记录。本分支尚未完成全部 v1 功能。
