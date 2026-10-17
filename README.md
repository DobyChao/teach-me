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

[Agent 协议与支持范围](docs/AGENT-PROTOCOL.md)。每个 Agent 使用不同的 `--client` 或 `TEACH_ME_CLIENT`。

UI 不包含浏览器模拟后端，必须由 Electron 加载；`npm run dev` 只用于前端开发，不能代替真实桌面运行。

当前实现与未验证能力详见接续记录。本分支尚未完成全部 v1 功能。

若 `npm run app` 自行结束，终端会输出 Electron 的退出码、Windows 状态码和运行时长。诊断保存在 `%APPDATA%/teach-me-agent-v2/runtime.log`（设置 `TEACH_ME_AGENT_HOME` 时位于该目录）；不包含对话正文或 token。重复启动会提示已有实例，避免将第二个进程正常退出误认为原窗口退出。远控里有任务栏图标但没有浮窗时，同时检查设置中的远控可见开关。
