# Teach me, Agent

用户留在当前软件中操作，Agent 用短句和屏幕上的指引一步步教学。

本分支从空白开始重建。旧工作在 `codex/companion-rebuild` 的 `54623c6`。

## 项目规划

- [项目即记忆：新 Agent 从这里开始](MEMORY.md)
- [自动生成的当前上下文](docs/rebuild/CONTEXT.md)
- [计划入口](docs/rebuild/README.md)
- [产品规格](docs/rebuild/PRODUCT.md)
- [架构](docs/rebuild/ARCHITECTURE.md)
- [任务状态](docs/rebuild/tasks.json)
- [接续记录与限制](docs/rebuild/PROGRESS.md)
- [验收标准](docs/rebuild/ACCEPTANCE.md)
- [原始设计决议](docs/DESIGN-NOTES.md)

## 开发

Windows + Node.js 24。

开始工作先运行 `npm run context:check`；每轮将新决议、任务、验证证据与接续要点写回项目，再用 `npm run context` 刷新摘要。`npm run check` 与 CI 会拒绝过期上下文，详见 [项目记忆](MEMORY.md)。

```powershell
npm ci
npm run check
npm run app
```

Agent 从命令行启动教学：`node bin/teach-me.mjs start --topic '学习使用软件'`。随后使用 `wait`、`say`、`capture`、`show`。详情：`node bin/teach-me.mjs help`。

[Agent 协议与支持范围](docs/AGENT-PROTOCOL.md)。每个 Agent 使用不同的 `--client` 或 `TEACH_ME_CLIENT`。

UI 不包含浏览器模拟后端，必须由 Electron 加载；`npm run dev` 只用于前端开发，不能代替真实桌面运行。

面板有小/中/大三档：默认120×48 DIP双入口胶囊，点击写字或输入快捷键打开360宽输入框，收到回复/审批或点击展开显示520宽完整对话。输入中收到回复只标记新消息；草稿、录音、审批和画板编辑期间不自动收小。横线可手动收成胶囊，输入与草稿保持同一份；拖动左侧把手/状态栏可移动，重启记住位置。完整规则见 [三档面板决议](docs/rebuild/PANEL-MODES.md)。

用户画板复用 [Excalidraw](https://github.com/excalidraw/excalidraw)（MIT，见 [第三方声明](THIRD-PARTY-NOTICES.md)）。在面板点击“画板”打开编辑工具，无需先连接 Agent。右上角“完成画板”恢复点击穿透；再次打开可继续编辑。首次连接 Agent 会保留已画内容，勾选“附画板”随消息发送透明图片。用户清除与 Agent 清除独立；画板内容仅在本次应用运行内存中保留。

未连接时点写字可查看并复制连接说明。上翻阅读旧步骤时，新回复只显示跳至最新的提示；回到底部后继续跟随。实际试用记录与下一步优化建议见 [T18](docs/rebuild/evidence/T18.md)。开发时可用 `node scripts/dogfood.mjs` 启动隔离体验实例，用 `--verify` 回归入口、阅读和长草稿布局；先运行构建，测试数据不进 Git。

设置入口打开独立窗口，可拖动、调整大小；保存/取消固定在底部，关闭后教学草稿继续保留。三档和内容高度重新测量均连续过渡，系统减少动态效果时直接切换；详情与验证范围见 [T20](docs/rebuild/evidence/T20.md)。

后续体验修正在[T21](docs/rebuild/evidence/T21.md)：过渡使用页面合成层，设置去除系统标题栏，新增浅色/深色/跟随系统；当前设置窗口预览，保存后所有窗口与画板工具栏应用。主题token与后续桌宠规划见[外观契约](docs/rebuild/APPEARANCE.md)。

当前实现与未验证能力详见接续记录。本分支尚未完成全部 v1 功能。

若 `npm run app` 自行结束，终端会输出 Electron 的退出码、Windows 状态码和运行时长。诊断保存在 `%APPDATA%/teach-me-agent-v2/runtime.log`（设置 `TEACH_ME_AGENT_HOME` 时位于该目录）；不包含对话正文或 token。重复启动会提示已有实例，避免将第二个进程正常退出误认为原窗口退出。远控里有任务栏图标但没有浮窗时，同时检查设置中的远控可见开关。
