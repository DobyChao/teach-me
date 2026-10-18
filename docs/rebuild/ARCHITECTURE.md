# 工程架构

## 目标边界

```text
CLI / Agent（保留公开命令语义）
    → localhost API（认证、会话权限、输入校验）
    → application controllers（会话、输入、截图、审批、语音）
    → platform adapters（Electron/Windows/文件系统/ASR）
    → typed preload bridge（固定方法、结果与事件）
    → React renderer（投影状态、发出意图）
```

领域状态不依赖 Electron、React 或 DOM。控制器拥有异步操作和取消令牌；Renderer 不发起系统截图，也不保存原窗口句柄。

## 渐进目录

当前工程：`src/core/`（领域控制器）、`src/shared/`（DTO + schema）、`src/host/`（Electron 与 Windows 适配）、`src/renderer/`（React）和 `bin/`（CLI）。不读取旧 UI 来渲染新界面。

本分支是孤立的空分支，根 `package.json` 与锁文件只服务新实现。`npm run app` 启动新宿主；旧应用保留在另一分支。引用旧纯函数前须明确输入输出并补行为测试，不能把旧全局状态带进来。

## 状态所有权

| 状态 | 所有者 | Renderer 可见 |
| --- | --- | --- |
| 会话 token、消息队列、ack | 宿主会话服务 | session id、连接与 Agent 状态 |
| 原窗口句柄、截图、采集屏几何、turn id | 输入控制器 | 输入阶段、附件元信息、错误 |
| Agent waiting/thinking/offline | 会话控制器 | 原样投影，不用超时猜“空闲” |
| 语音 starting/recording/transcribing/review | 语音控制器 | 阶段与转写；不覆盖 Agent 状态 |
| Agent 指引、笔迹、隐藏状态 | 场景服务 | 可见性、是否可清除、是否可附画板 |
| 用户画板元素数、清除 epoch | 宿主 | 可清除/可附画板；renderer 持有完整编辑场景与历史 |
| 草稿、展开态、hover | 面板 | 本地 UI 状态；尺寸意图报宿主 |

用户画板使用 renderer 中的 Excalidraw 实例持有编辑场景、选择和撤销栈；宿主仅保存元素数与清除代数 epoch。固定 `board-change` DTO 不传第三方任意场景对象，只允许 overlay sender；清除、换屏与替换旧会话递增 epoch，晚到的更新失效。无会话也可绘画；首次连接同一屏幕时保留用户预先画的内容。Agent 场景仍由宿主管理，不能进入用户的选择/橡皮/撤销栈。发送附件由宿主调用固定的用户画板导出函数，合成独立 Agent 笔迹后验证 PNG，并再次校验 turn/session/epoch；编辑器不持有宿主 token 或句柄。内容不跨应用重启持久化。

## 输入事务（M2 的强制设计）

每次输入有唯一 turn id：`preparing → editing/recording → submitting → delivered`，可转 `cancelled/failed`。保存原窗口→抓图→允许聚焦；截图失败可以重试、明确仅发文字或取消。提交成功后清草稿，失败保留。异步回调必须校验 turn id，取消或结束后的截图/语音结果不得污染下一次输入。一次提交防重入；消息有客户端 id，重试不重复投递。

聚焦前截图要求的鼠标实现方案在 ADR-003；M2 未真机验证不能算交付。

## IPC 与权限

共享协议定义请求、响应与事件；主进程做运行时校验、sender/window 校验和错误归一。preload 仅暴露明确方法（例如 prepareInput、submitInput、cancelInput、subscribeSnapshot），不能暴露通用 send/invoke。每个请求必须有接收器、响应与超时行为测试。订阅返回 unsubscribe，React effect 负责清理。

Electron contextIsolation + sandbox，关闭 nodeIntegration。远程/自定义 HTML 不加载应用 preload；禁止导航、新窗口和网络，固定宿主水印。来源：[Electron IPC](https://www.electronjs.org/docs/latest/tutorial/ipc)、[Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)。

## UI 与验证

共享 token 管颜色、字体、间距、圆角；组件按职责拆分 Header/Thread/ContinueOffer/Composer。收起只隐藏消息区域，不卸载输入组件。CSS 不承担业务状态机。

单测验证领域判定和取消/去重；组件测试验证交互；协议测试走桥接双方；浏览器验证布局与可访问性；Windows 真机验证焦点、截图、穿透、多屏。jsdom 不承担布局验收。Vite 构建外单跑 tsc。

## 项目记忆的所有权

根 MEMORY.md 负责恢复入口、长期意图和信息归属，不另存任务状态。tasks.json负责状态/依赖/nextUp，PRODUCT/DECISIONS/ACCEPTANCE/evidence负责规格、理由、完成条件和实际观察；PROGRESS只保留当前接续，旧正文归档。`scripts/project-memory.cjs`从任务生成CONTEXT.md，并对显式白名单内的工程源文件计算摘要；不包含自身输出、Git元数据或运行数据，不依赖HEAD或时间戳，避免提交后自失效。文本行尾统一，Windows/CI检出方式不影响结果。

`context:check`检查规范入口链接、复用plan引用校验并只读比较生成内容；源文件变化后必须显式生成并审阅。`npm run check`和CI调用同一命令。该机制只保证结构与同步，无法证明人工接续完整或验证结论真实；功能、平台证据仍按原验收要求管理。实现工具仅用于工程开发，不进入Electron/renderer运行边界。
