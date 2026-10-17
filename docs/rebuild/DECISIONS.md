# 架构决策记录

## ADR-001 · 接受 · 2026-10-17 · 独立重建

用户认可现有设计/交互，但希望避免在旧实现上持续补丁，并明确要求新建空分支。采用孤立分支 codex/companion-rebuild-empty，从 f5e1e56 建立根工程，React + TypeScript + Vite，CSS token + 共享组件，不引入 Tailwind。旧应用只保留在另一分支；随时可回到快照 54623c6，新分支不恢复旧 main.js。

## ADR-002 · 接受 · 2026-10-17 · 状态语义修正

Agent 状态使用 offline/ready/waiting/thinking/ended；语音状态独立。waiting 表示等待用户消息，应允许继续；录音或草稿非空时隐藏继续。所有 scene 内容都计入指引存在性；用户画板附件仍只表示笔迹层。这修正原 notes 中将“在听”视为忙碌、将 board.agent 作为全部指引判据的实现约定。

## ADR-003 · 待验证 · 2026-10-17 · 鼠标入口的聚焦前截图

约束已确定：不能在 textarea focus 以后才保存原软件；不能把已经聚焦自己的窗口当作“原软件”。候选实现：宿主跟踪最近的外部前台窗口，在非激活面板入口准备输入，记录帧后显式激活输入。需要验证从非激活窗口到可编辑面板的时序；仅仅阻止浏览器 pointerdown 默认行为不能证明原生窗口未激活。

M2 必须先做 Windows 小实验，记录鼠标与全局快捷键路径的窗口句柄、截图时间、激活时间、发送与取消后的前台窗口。不满足 R03 时不能靠改文档为“发送时截图”绕过。

## ADR-004 · 接受 · 2026-10-17 · 规划即工程文件

tasks.json 为状态唯一来源；需求、验收、ADR 与证据随实现提交。检查器拒绝未知引用、循环依赖、缺失完成证据、依赖未完成却 done。CI 执行同一检查；禁止只有聊天记录宣称完成。

## ADR-005 · 接受 · 2026-10-17 · 远控可见性

用户要求在虚拟屏／远程控制画面里看见应用。原实现对所有窗口无条件调用 setContentProtection(true)。新增 showInScreenCapture 配置及设置页开关，开启时统一关闭面板、画布与 HTML 的内容保护；保存后立即应用，新 HTML 窗口继承。旧配置缺省 false，继续保护；本机按用户要求配置为 true。应用自己的 captureScreen 仍先临时隐藏应用窗口，因此该开关不决定 Agent 截图是否包含指引。

此变更控制应用是否允许被捕获，不安装虚拟显示驱动，不保证所有第三方远控采集方案兼容；真实客户端画面尚未验证。

## ADR-007 · 接受 · 2026-10-17 · 取消取图显隐与真实 CLI 验证

用户反馈上一轮升级后仍闪烁、无回复。ADR-006 的缩短隐藏时间不能消除 hide/show，废止该取图方案。改为取帧前对面板、画布、HTML 临时启用系统捕获排除，finally 恢复用户的远控可见设置；不隐藏窗口、不改焦点。显式启用 Chromium AllowWindowCaptureExclusionInRemoteSessions，避免 Electron 44 某些版本远程会话中内容保护被忽略。不同远控方案仍须实测，不能只用 isContentProtected 推断画面已排除。

CLI 从 fetch 改用 node:http，八分钟长轮询仅受明确请求期限约束，不再受独立响应头期限限制。既有测试只调用 API，不能代表命令行完成端到端验收；新增真实 CLI 子进程两轮 UI→wait/ack→say，以及超过五分钟无响应头后再收消息的实验。未证实上次 fetch failed 是超时还是应用退出，不写成已定位唯一根因。

增加有大小上限的本地 runtime.log，只记录启动/退出原因、进程退出、wait 开始/完成及消息数量；不记录文字、截图、路径或 token，不提交到 Git。用于区分应用退出和网络等待失败。

## ADR-006 · 取图方案已由 ADR-007 取代 · 2026-10-17 · 输入去重与连接存活提示

prepare 的并发调用共用一次记窗/取图/聚焦，已有编辑回合仅重新聚焦，不重复截图。窗口仅在取帧期间隐藏，35ms 合成等待后取帧，随后立即恢复；缩放、PNG 编码与写盘在可见状态执行，失败也恢复。保留截图排除自身的约束，因此单次取帧仍可能短暂闪一下，不能宣称零闪烁。面板缓存实际高度，同尺寸不重复 setBounds，HTML 可见状态未变时不重复 showInactive。

Agent 必须持续 wait，超时后再次 wait；单次 wait 结束不意味着后台仍有人自动回答。宿主在无活跃 wait 且 ready 超过 15 秒、thinking 超过 5 分钟时显示 offline（文案为连接待确认），保留未确认消息；新的 wait/say 恢复状态。这是活动超时判断，不是进程存活证明。活跃长轮询不触发过期。

## ADR-008 · 接受 · 2026-10-17 · 将任务栏身份与输入焦点分开

Electron Windows 的 SetFocusable 同时调用 SetSkipTaskbar(!focusable)，原先输入/发送/设置/画板切换会改变任务栏入口。仅紧接着 setSkipTaskbar(false) 在本机现场仍会在失焦后消失，不能作为修复完成。主面板明确使用 WS_EX_APPWINDOW、清除 TOOLWINDOW，画布明确使用 TOOLWINDOW、清除 APPWINDOW，再应用任务栏入口策略。保留 NOACTIVATE 位以维持聚焦前取图，更新样式不激活、不移动、不改 Z 序；异步平台调用之后检查 turn 是否仍有效。

主面板在活动与非活动状态均保留一个任务栏入口；画布与 HTML 不参与任务栏。快捷键没有创建窗口的路径，用句柄、渲染 PID 和 browser-window-created 计数验证复用。启动时设置角色，后续每次焦点切换均重申策略。设置与画板不因可聚焦而成为新的任务栏窗口。来源：[Electron SetFocusable 实现](https://github.com/electron/electron/blob/main/shell/browser/native_window_views.cc)、[Microsoft 扩展窗口样式](https://learn.microsoft.com/en-us/windows/win32/winmsg/extended-window-styles)。

## 开放问题

| 问题 | 最晚决策任务 | 处理原则 |
| --- | --- | --- |
| 鼠标入口非激活/聚焦时序 | T03 | 必须真机实验，见 ADR-003 |
| Windows 系统 ASR 实现与可用性 | T06 | 先探测；不把 Web Speech 等同于 Windows 系统识别 |
| HTML CPU/内存限额的可执行方案 | T05 | 看门狗/终止验证；不能把 CSP 当资源限额 |
| 新会话附件偏好是否继承 | T06 | 明确 reset 边界并测试，默认遵循“有笔迹默认附带” |
