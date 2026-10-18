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

## ADR-009 · 接受 · 2026-10-17 · 稳定激活代理与浮窗层级

ADR-008 仍在每次输入切换 Electron setFocusable，Windows 会连带删除/添加任务栏入口。现在面板和画布的 Electron 激活代理从创建起保持可激活，实际鼠标激活由宿主 Win32 NOACTIVATE 位控制，任务栏角色只在首次/角色变化时应用，不在每次输入重建。取帧前保持 NOACTIVATE，取帧后解除；系统拒绝普通 focus 时使用原生前台激活兜底，再聚焦 WebContents。取消或旧异步回调按 turn 检查，不得让旧输入重新占据焦点。

面板和画布不提供常规最小化；热键在确实已最小化/隐藏时恢复同一个窗口。外部前台窗口变化时仅提升已可见、未最小化的原浮窗 Z 序，不调用 show/hide、不激活；恢复外部窗口只使用 SetForegroundWindow，不再冗余 BringWindowToTop。新增无正文窗口生命周期日志，用于区分 hide/minimize 与崩溃/退出。

## ADR-010 · 接受 · 2026-10-17 · 主线替换

用户本轮明确授权修复后备份原 master、将当前重建分支变成 master 并推送，该授权覆盖平时“不自动 push”的默认约定。先 fetch 并记录 origin/master 原 SHA，先推独立备份并核对，再以该 SHA 为 lease 更新 master；远端有并发变更即停止替换并重新处理。此次提升主线不表示所有产品任务已经验收，待验证任务继续留在 tasks.json。

## ADR-011 · 接受 · 2026-10-17 · 复用 Excalidraw 用户编辑器

用户明确指出用户自己的画板能力不足，并要求优先借用开源项目。选择 MIT 许可的 `@excalidraw/excalidraw` 0.18.1（支持 React 19），以本地 React 组件接入透明屏幕画板。tldraw SDK 的生产使用需要额外许可，不采用。许可与版权保留在 THIRD-PARTY-NOTICES.md，字体与其 notices 随构建复制；依赖和兼容修复 overrides 写入锁文件。

保留 Excalidraw 自带的编辑工具、选择、样式、撤销和缩放；仅编辑时展示界面并接收鼠标，完成后保留实例、隐藏界面并穿透。离线可画，首次连接同一屏幕时保留预先绘制内容；替换旧会话时清除。用户内容和 Agent 场景分层；主进程不导入第三方场景格式，仅校验来自 overlay 的数量/epoch。用户画板清除会重置其历史，不能用旧撤销或晚回调恢复清除前内容。发送透明屏幕坐标 PNG，独立合成 Agent 笔迹，不截取编辑器 UI。图片/文本等编辑数据在 renderer 内存持有，不写配置或 Git。

包按需加载；字体本地打包。0.18.1 即使设置本地路径仍追加字体 CDN fallback，构建适配将该 fallback 改为同一本地路径，CSP 继续阻止远程资源；禁用 AI、外部嵌入、外链打开和在线协作入口。手动选择库、图片导入等附加流程未验证，不扩展声称。

依据：[MIT 许可](https://github.com/excalidraw/excalidraw/blob/master/LICENSE)、[官方集成方式](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/integration)、[官方导出 API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/export)、[tldraw 许可](https://tldraw.dev/community/license)。

## ADR-012 · 接受 · 2026-10-18 · 可移动 mini 输入面

收起宽 360 DIP、空态约 76 DIP，展开宽 520 DIP；多行输入自动增高，始终复用同一 textarea。状态栏保留拖动把手与展开入口，语音/画板/发送使用图标，附件/清理/设置收进可增高的“更多”，不使用会被原生窗口裁掉的悬空菜单。

Windows 实验中 CSS 原生拖动区域存在但窗口未随鼠标移动，因此标题区用 Pointer Capture 接收手势。Renderer 只通过固定 panel-drag 白名单发送手势 id 与屏幕 DIP 位移；主进程校验范围、绑定原窗口起点、忽略结束后的晚回调，按钮和输入区不启动拖动。不发送窗口句柄，不改变现有 NOACTIVATE/截图/任务栏策略。位移随事件采样，避免 IPC 延迟导致主进程事后读取鼠标位置而丢失起点。ResizeObserver 带收起状态，过时尺寸报告不跨模式应用。

宿主在本地 panel-position.json 保存屏幕 id 和右下锚点，独立于教学屏幕；展开/收起向左上增长，不能容纳时限制在工作区。显示器移除或布局变化时回退到可用屏幕并夹紧；负坐标/小工作区由纯几何测试覆盖，多屏不同缩放的实际拖动仍须真机另验。配置和截图均不进 Git。

参考：[Electron 官方拖动区域说明](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions)。CSS 区域通过不替代 Windows 实际拖动通过。

## ADR-013 · 接受 · 2026-10-18 · 三档面板与情境切换

用户追加双入口小胶囊参考图；将 ADR-012 的360宽布局保留为中号，默认小号120×48，大号520。具体切换矩阵、保护条件与阅读时间见 [PANEL-MODES.md](PANEL-MODES.md)。状态策略在 core，宿主负责计时/原生尺寸与焦点，renderer只报告草稿存在性、工具打开与减少动态效果偏好；保留唯一输入。回复不打断用户编辑；审批必须可见；悬停不放大，空闲才收小。

Windows 通过宿主200ms插值同一窗口尺寸实现过渡；更新的目标替换旧目标，拖动前结束动画。设置与系统减少动态效果受尊重。依据：[Electron setBounds API](https://www.electronjs.org/docs/latest/api/browser-window#winsetboundsbounds-animate)、[W3C 交互动画与减少动态效果](https://www.w3.org/WAI/WCAG22/Techniques/css/C39.html)。这些资料支持实现与可访问性边界；切换时机是本项目设计决议。

## 开放问题

| 问题 | 最晚决策任务 | 处理原则 |
| --- | --- | --- |
| 鼠标入口非激活/聚焦时序 | T03 | 必须真机实验，见 ADR-003 |
| Windows 系统 ASR 实现与可用性 | T06 | 先探测；不把 Web Speech 等同于 Windows 系统识别 |
| HTML CPU/内存限额的可执行方案 | T05 | 看门狗/终止验证；不能把 CSP 当资源限额 |
| 新会话附件偏好是否继承 | T06 | 明确 reset 边界并测试，默认遵循“有笔迹默认附带” |
