# 重建工程约定

工程从空提交 f5e1e56 重建。旧工作保存在 codex/companion-rebuild 的 54623c6；初始产品依据为 docs/DESIGN-NOTES.md，后续已接受的用户决议进入 PRODUCT.md 与 DECISIONS.md，不恢复旧 main.js。

## 工作入口

项目即记忆。先读 [MEMORY.md](MEMORY.md) 与 [当前上下文](docs/rebuild/CONTEXT.md)，运行 `npm run context:check` 确认未过期；再读 docs/rebuild/README.md、PRODUCT.md、tasks.json 和 PROGRESS.md，按任务追溯 ADR、架构与证据。

- `tasks.json` 是任务状态和下一步排序的唯一来源；CONTEXT.md 是生成的视图，不能手改。PROGRESS.md 只保留当前接续要点，旧记录归档到 history/。
- 新需求、用户纠正、决策理由、失败尝试、验证限制和下一步必须回写项目。不能只留在聊天、Agent 私有记忆或未提交的临时文件里；不把整段聊天搬进文档。
- 换会话或压缩上下文后，先从项目恢复；仓库已有答案时不要要求用户重新复述。无法确认的内容保留为开放问题，不猜测补全。
- 动手前认领/建立任务并明确验收；收尾更新规格/ADR（如有变化）、任务、证据和接续记录，运行 `npm run context`，审阅生成差异，再运行 `npm run check`。中断时写清未完成项、已知失败和可直接执行的下一步。
- 实现、规划、验收证据一起随 Git 提交。不能把预览/单元测试通过描述成真机验收通过；历史通过记录也不能冒充本轮验证。
- 用户当前指令优先；仓库内以已接受的后续 ADR 明确取代旧决议。代码、规格和证据冲突时先核实并记录差异，不能静默改写历史或把推测记成事实。

## 边界

- src/core 是不依赖 Electron/React 的领域与控制器；src/host 是 Electron 适配；src/shared 是 DTO 与运行时协议；src/renderer 是 React UI。
- 保留单一输入面、冷灰 + 粉 token。Agent 等消息与用户录音分别建模。所有 scene 类型均计入指引存在性。
- Renderer 不持有会话 token、窗口句柄，不发任意 IPC。固定方法白名单、主进程运行时校验、sender 校验。
- 每次输入有 turn id，截图在聚焦前；发送成功才清草稿；取消后晚回调必须失效。录音释放/失败必须清设备。
- 默认只指不代操作。画布默认穿透；编辑时接收鼠标；用户笔迹与 Agent 指引分层。
- 依赖锁文件提交；截图、录音、会话数据、日志和本地配置不提交。
- 命令：npm run check。UI 还须真实布局验证；焦点/截图/多屏须 Windows 真机。未验证保留 pending。
- 保持小提交，更新任务和证据；不自动 push。
