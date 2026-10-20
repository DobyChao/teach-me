# 当前项目上下文

> 由 `npm run context` 生成，禁止手改。任务状态仅维护在 tasks.json。
> 用 `npm run context:check` 检查是否过期；旧验证不代表本轮验证或当前运行状态。

## 恢复入口

[项目记忆](../../MEMORY.md) · [工程约定](../../AGENTS.md) · [产品规格](PRODUCT.md) · [决策理由](DECISIONS.md) · [架构](ARCHITECTURE.md) · [当前接续](PROGRESS.md) · [验收](ACCEPTANCE.md)

## 优先接续

以下排序来自 tasks.json.nextUp；用户新请求可改变排序，动手前先核对工作区。

### 1. T14 · 定位 npm 启动后退出并补全退出诊断

状态：`in_progress`。优先理由：用户多次反馈应用静置后退出；原始根因尚未复现，影响基本可用性。

下一步：先读 T14 证据和启动诊断实现，复核 npm run app 的静置/退出/重复启动；记录终端退出码与宿主事件，区分进程退出和捕获不可见，再决定修复。

验收入口：A19；证据：[T14.md](evidence/T14.md)

### 2. T28 · 补齐通用接收能力并验证Agent所选原生通路

状态：`todo`。优先理由：原生通路仍待验证；按用户决议让Agent自主选择接通，不预设逐家实现适配器。

下一步：按ADR-024由Agent选当前环境通路，在隔离且可访问的现有会话验证外部输入/空闲回复；按实际需要补通用接收、可靠ack、单消费者交接与健康状态，失败用wait。

验收入口：A33；证据：[T28.md](evidence/T28.md)

### 3. T17 · 小中大三档与情境平滑切换

状态：`in_progress`。优先理由：三档交互已实现，完整输入与切换体验仍需补齐；先保护草稿与连续使用。

下一步：读 PANEL-MODES.md 与 T17/T18 证据，补连续切换与编辑保护的剩余矩阵；Microsoft拼音完整收发已验，其他IME、真实麦克风和多屏分别验收。

验收入口：A22；证据：[T17.md](evidence/T17.md)

### 4. T02 · React 面板与浏览器布局验收

状态：`in_progress`。优先理由：局部布局已修复，但密集工具、审批、长消息等完整视觉状态仍未验收。

下一步：按 A03 覆盖520/460宽与多行草稿、长历史、审批/工具满载的实际布局，记录边界；不以构建或DOM断言替代桌面观察。

验收入口：A03；证据：[DESKTOP-001.md](evidence/DESKTOP-001.md)

## 全部任务

状态为整项验收状态，todo 也可能已有部分实现；不能把完成比例当作产品交付比例。

| 任务 | 状态 | 依赖 | 证据 |
| --- | --- | --- | --- |
| T00 空分支内建立规划与约束 | done | — | [T00.md](evidence/T00.md) |
| T01 类型协议、领域控制器与工程构建 | done | T00 | [T01.md](evidence/T01.md) |
| T02 React 面板与浏览器布局验收 | in_progress | T01 | [DESKTOP-001.md](evidence/DESKTOP-001.md) |
| T03 Electron 截图与焦点真实输入闭环 | todo | T02 | — |
| T04 CLI、Agent 会话教学闭环 | todo | T03 | — |
| T05 完整指引、画板、审批与 HTML 安全 | todo | T04 | — |
| T06 语音、完整设置与三步引导 | todo | T05 | — |
| T07 多屏、缩放与断屏故障恢复 | todo | T06 | — |
| T08 打包、回归与交付 | todo | T07 | — |
| T09 实现远控可见性开关并配置本机 | done | T01 | [T09.md](evidence/T09.md) |
| T10 修复输入重复准备、窗口闪烁及失联状态 | in_progress | T01 | [T10.md](evidence/T10.md) |
| T11 稳定任务栏身份并验证快捷键复用窗口 | done | T01 | [T11.md](evidence/T11.md) |
| T12 修复外部前台切换与快捷键重新拉起观感 | in_progress | T01 | [T12.md](evidence/T12.md) |
| T13 备份原 master 并推送重建主线 | done | T00 | [T13.md](evidence/T13.md) |
| T14 定位 npm 启动后退出并补全退出诊断 | in_progress | T01 | [T14.md](evidence/T14.md) |
| T15 以 Excalidraw 扩展用户画板 | in_progress | T01 | [T15.md](evidence/T15.md) |
| T16 mini 输入面与面板位置记忆 | in_progress | T01 | [T16.md](evidence/T16.md) |
| T17 小中大三档与情境平滑切换 | in_progress | T01 | [T17.md](evidence/T17.md) |
| T18 实际试用并修复连接入口、阅读跳动与长草稿布局 | done | T01 | [T18.md](evidence/T18.md) |
| T19 建立项目即记忆的入口、接续与自动过期检查 | done | T00、T01 | [T19.md](evidence/T19.md) |
| T20 修复可见过渡并将设置拆为独立窗口 | done | T01 | [T20.md](evidence/T20.md) |
| T21 合成层平滑过渡、统一设置标题及外观主题基础 | done | T01 | [T21.md](evidence/T21.md) |
| T22 定位并修复动效收尾闪烁和拖动放大 | done | T01 | [T22.md](evidence/T22.md) |
| T23 建立App、全局tma与可安装Agent skill入口 | done | T01 | [T23.md](evidence/T23.md) |
| T24 CLI英文帮助与中英文README入口 | done | T23 | [T24.md](evidence/T24.md) |
| T25 Agent无关的README与明显的skill安装步骤 | done | T23、T24 | [T25.md](evidence/T25.md) |
| T26 一句话委托Agent安装并拆开可选检查 | done | T25 | [T26.md](evidence/T26.md) |
| T27 修订主动视觉取证与原生唤醒优先的skill规则 | done | T23、T26 | [T27.md](evidence/T27.md) |
| T28 补齐通用接收能力并验证Agent所选原生通路 | todo | T27 | [T28.md](evidence/T28.md) |
| T29 由Agent自主选择接收机制的通用skill | done | T27 | [T29.md](evidence/T29.md) |
| T30 清理失败时仍能退出并重新启动 | done | T01 | [T30.md](evidence/T30.md) |
| T31 发送已成功时焦点恢复失败不再吞掉后续改稿 | done | T01 | [T31.md](evidence/T31.md) |
| T32 主面板渲染进程崩溃后有界恢复 | done | T30、T31 | [T32.md](evidence/T32.md) |
| T33 Windows辅助进程代次隔离与故障诊断 | done | T30、T32 | [T33.md](evidence/T33.md) |
| T34 加入审批绑定申请会话并拒绝失效目标 | done | T01 | [T34.md](evidence/T34.md) |

## 尚未完成任务的接续说明

- **T02**：真实 DOM、输入/选择区、520/460 基础布局通过；密集工具、长消息与全部状态视觉仍待验收。
- **T03**：已有部分实现；状态表示整项验收尚未完成，不能据此宣称能力已交付。
- **T04**：已有部分实现；状态表示整项验收尚未完成，不能据此宣称能力已交付。
- **T05**：已有部分实现；状态表示整项验收尚未完成，不能据此宣称能力已交付。
- **T06**：已有部分实现；状态表示整项验收尚未完成，不能据此宣称能力已交付。
- **T07**：已有部分实现；状态表示整项验收尚未完成，不能据此宣称能力已交付。
- **T08**：按任务 verify 和验收标准核对实现及缺口。
- **T10**：39 测试、23 项 Electron、310 秒 CLI 长等待与两轮收发、Windows 原生快捷键/真实排除取图/键盘 Enter/回复渲染和草稿清除通过；第三方远控持续画面及独立外部软件焦点恢复未验证，保留 in_progress。
- **T12**：修复与 Paint 三轮真实快捷键/取消/发送通过；完整 Win+R 启动入口因电脑工具限制未验证，保留 pending。
- **T14**：本轮45分钟隔离未连接实例持续在线，强制终止/正常stop启动器记录通过；同桌面并行验收有焦点变化、快捷键被占用，未覆盖睡眠/锁屏。历史静置退出根因仍未知。
- **T15**：基础工具、附件与分层集成通过；真实鼠标矩形及布局已观察，原生键盘焦点等完整验收继续记录。
- **T16**：360 DIP mini 与真实 Windows 标题拖动已观察；多屏不同缩放实际拖动仍 pending。
- **T17**：T33后最新构建完整重跑原生Microsoft拼音、回复不重排、中文多行、候选Enter不误发和再次Enter发送；wait收到两条消息、ack及正常stop通过。其他IME、麦克风、多屏及完整切换矩阵pending。
- **T28**：已有六种宿主历史文档研究，未实现原生通路。ADR-024后由Agent自主选择/按需接通，不预设逐家内置适配器；本任务按实际需要补通用消息接收、可靠ack、单消费者交接和健康状态，再验收所选通路。安装hook或恢复历史不等于已唤醒。

## 收尾

更新规格/ADR、tasks.json、证据和当前接续 → `npm run context` → 审阅差异 → `npm run check` → 一起提交。
具体命令和验证边界见 MEMORY.md、README.md 与各任务 verify；不将运行数据写入项目记忆。

<!-- source-sha256: 69669187e667f299c7096619a7ac1f9c44917781ff59ac309bb95da8db87eb11 -->
