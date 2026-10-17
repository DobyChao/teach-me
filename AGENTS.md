# 重建工程约定

本分支从空提交 f5e1e56 开始。旧工作保存在 codex/companion-rebuild 的 54623c6；只以 docs/DESIGN-NOTES.md 的产品决议作为依据，不恢复旧 main.js。

## 工作入口

先读 docs/rebuild/README.md、PRODUCT.md、tasks.json 和 PROGRESS.md。任务状态以 tasks.json 为唯一来源。实现、规划、验收证据一起随 Git 提交。不能把预览/单元测试通过描述成真机验收通过。

## 边界

- src/core 是不依赖 Electron/React 的领域与控制器；src/host 是 Electron 适配；src/shared 是 DTO 与运行时协议；src/renderer 是 React UI。
- 保留单一输入面、冷灰 + 粉 token。Agent 等消息与用户录音分别建模。所有 scene 类型均计入指引存在性。
- Renderer 不持有会话 token、窗口句柄，不发任意 IPC。固定方法白名单、主进程运行时校验、sender 校验。
- 每次输入有 turn id，截图在聚焦前；发送成功才清草稿；取消后晚回调必须失效。录音释放/失败必须清设备。
- 默认只指不代操作。画布默认穿透；编辑时接收鼠标；用户笔迹与 Agent 指引分层。
- 依赖锁文件提交；截图、录音、会话数据、日志和本地配置不提交。
- 命令：npm run check。UI 还须真实布局验证；焦点/截图/多屏须 Windows 真机。未验证保留 pending。
- 保持小提交，更新任务和证据；不自动 push。
