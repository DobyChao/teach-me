# 同类产品与 Agent 屏幕指引工具调研

调研日期：2026-10-21。本文为独立发布的调研正文，验证范围与限制见文末。

来源：本轮在线读取的官方产品网页与 GitHub README。以下能力是维护者公开描述，不代表已安装、代码审计或真机验证；功能、平台和维护状况可能变化。本次不比较价格、用户规模和未经核验的性能数据。

## 结论

Teach-me 的比较基准来自[产品规格](PRODUCT.md)：伴随教学、默认只指不代操作、复用用户已有 Agent，通过桌面 App、全局 tma CLI 与 skill 连接；包含用户输入、截图与审批、双向会话、Agent 指引及独立用户画板。规格范围不等于全部功能已完成验收，当前状态见 [tasks.json](tasks.json)。

同类分为两个观察方向：

1. **给已有 Agent 提供屏幕表达工具**：Arin、Big Arrow。与我们的 Agent 分离、协议、CLI 和覆盖层设计最接近。
2. **把模型和交互集成在产品中的教学助手**：Clicky、Clicky Windows、Skilly、DuckyHelper、Copilot Vision、Screen Vision、AI-Tutor。适合对照完整教学体验。

“复用已有 Agent”已有明确同类，不能单独作为 Teach-me 独有优势。Arin 和 Big Arrow 由用户补充，修正了首轮偏重完整教学助手、遗漏指引工具的检索范围。现阶段可以验证的产品方向是：在 Windows 上把用户提问、Agent 看屏、现场标注和操作后反馈连接得足够顺畅；这只是分析建议，尚无对照实测证明体验领先。

## Agent 屏幕指引工具：优先研究

| 项目与官方来源 | 官方描述的能力 | 与 Teach-me 的关系与边界 |
| --- | --- | --- |
| [Arin 官网](https://anistark.github.io/arin/)／[仓库](https://github.com/anistark/arin) | macOS 本地 daemon；通过 MCP、CLI、Unix socket JSON 协议接受指令；光球指示、高亮、文字、自由笔迹与引导；不点击、不键入、不滚动；MIT | 与 Agent 无关的指引协议、画布和只指不代操作边界接近。它定位为标注层，不能据官网推定具备我们的双向教学会话、用户录音、审批与用户画板流程 |
| [Big Arrow](https://github.com/franzenzenhofer/big-arrow-on-the-screen) | macOS Swift CLI + Claude Code／Codex skill；箭头、圈、框、文字牌和可选朗读；支持坐标、窗口、辅助功能元素等定位；不点击、不键入、不截图；MIT | 与全局命令 + skill + 既有 Agent 的组合接近；重点是现场指向和交接，不是完整教学 App。看屏取证需由 Agent 的其他工具完成 |

### 可借鉴的具体机制

**Arin：协议与绘制服务边界。**让 Agent 决定内容，桌面服务负责渲染，MCP 和 CLI 可以作为不同调用入口。值得进一步检查各入口能力是否一致、会话结束如何清理、坐标如何定义与失效。官网提到的屏幕帧比较不能直接等同于向 Agent 提供截图工具；本轮未验证这一接口。

**Big Arrow：定位与生命周期。**README 描述了目标元素／窗口跟随、被遮挡时隐藏、超时清理、所属 Agent 退出清理、用户回复 hook 清理，以及 JSON 输出与明确退出码。还描述了 `--no-raise`、`--until-click`、复制按钮和朗读等交接设计。这些机制可作为后续协议和故障恢复的参考。

需要保留的区别：Big Arrow 在某些目标模式下默认先把应用／窗口／标签页带到前台，`--no-raise` 可关闭；“覆盖层不抢焦点”不能概括为所有命令都不改变前台应用。其 README 也说明文字牌／箭杆点击可关闭标注，不能简写成整个覆盖层所有区域均穿透。上述描述尚未实测，macOS 实现不可直接当作 Windows 方案。

## 完整教学体验的对照

| 项目与官方来源 | 官方描述的相似点 | 主要区别／研究价值 |
| --- | --- | --- |
| [Clicky](https://github.com/farzaa/clicky) | macOS 光标旁 AI 老师；截图、按键说话、语音解释、屏幕指向与透明覆盖层 | 自行集成 Claude、语音识别和朗读服务；可参考轻量伴随交互与指针动画 |
| [Clicky Windows](https://github.com/AbhishekVulla/clicky-windows) | Windows 看屏、语音问答、指向／标注；Python／PyQt6 覆盖层、多模型与本地服务选项、应用记忆和 Markdown 知识库 | 同平台的重要对照；自行组织模型和语音链路。可研究覆盖层与响应延迟处理；README 架构描述截图前隐藏覆盖层，与我们避免 hide/show 闪烁的约束不同，不能直接照搬 |
| [Skilly](https://github.com/tryskilly/skilly) | macOS 看屏教学、实时语音、动画指针、多屏；`SKILL.md` 定义教学阶段、完成信号和领域词汇；还提供网页嵌入组件 | 教学 skill 主要用于其内置导师的课程／提示内容；不能因文件名相同就等同于 Teach-me 给外部 Agent 安装工具用法的 skill。适合参考课程推进和步骤完成判断 |
| [Screen Vision](https://github.com/r-muresan/screen.vision) | 浏览器共享屏幕；根据目标每次给一条指令，比较操作前后画面并推进；画中画指引 | Next.js／FastAPI 应用，自行调用模型。适合参考步骤验证；本轮所读 README 的模型与配置章节存在不同表述，具体依赖需运行或查代码确认 |
| [DuckyHelper](https://duckyhelper.com/features/) | macOS 快捷键胶囊、看屏语音解释、圈／箭头／框／高亮／标签、白板、用户指向反馈 | 当前所读官网明确列为 Mac 应用；适合参考边讲边画和轻量入口。官网“未经请求不点击”不等于永久禁用操作能力；不能据此认定其边界与我们完全相同 |
| [Copilot Vision + Highlights](https://www.microsoft.com/en-us/microsoft-copilot/blog/2025/06/12/copilot-vision-on-windows-with-highlights-is-now-available-in-the-u-s/) | Windows 共享应用、实时交流；“show me how”在应用内指出点击位置与操作步骤 | 集成在 Copilot 中；是现场软件指导的直接体验对照。来源为2025-06-12官方发布文章，其中地区、应用数量等发布时限制不当作2026年的当前可用范围 |
| [AI-Tutor](https://github.com/Jasondaou1/AI-Tutor) | Windows 屏幕／OCR 讲解、语音问答、浮动面板，能检测画面／应用变化，支持自动与手动解释 | 更偏课件、PDF及屏幕内容解释；可参考自动讲解和按需问答切换，不据此推定有精确现场标注 |

## 对 Teach-me 的启发与取舍

以下是研究候选，不是已接受 ADR，也不自动进入实现排序：

| 优先研究什么 | 对应问题 | 建议如何验证 |
| --- | --- | --- |
| Big Arrow 的定位与清理 | 坐标过期、窗口遮挡、Agent 退出后遗留标注 | 查其协议和实现，再以窗口移动／遮挡／退出场景对照；元素定位涉及当前暂不做的完整辅助功能树，扩大范围前另行决策 |
| Arin 的多入口协议 | CLI、MCP 与底层消息协议如何保持一致 | 查命令与工具映射、错误返回和会话隔离；是否加入 MCP 需独立论证，不因竞品存在而默认采用 |
| Clicky Windows 的原生覆盖层 | Windows 焦点、穿透、DPI、语音响应 | 查实现后选择最小可复现场景；作者性能数字与多屏声明均须本机复验 |
| Skilly／Screen Vision 的教学推进 | 何时解释、何时等待、如何确认完成 | 先定义同一软件任务与误操作场景，比较单步指引、截图新鲜度和纠错能力 |
| DuckyHelper 的胶囊与标注节奏 | 入口是否打断操作、标注是否遮挡目标 | 观察演示并设计本地布局验证；保持单一输入面及用户／Agent 笔迹分层 |

当前最值得验证的整体体验：用户可在目标软件中提问，Agent 获得足够新鲜的画面，给出不会遮挡操作的指引，用户完成后可以继续反馈；失联、拒绝截图和取消均可恢复。上述结论不代表当前已通过完整验收，也没有改变现有产品边界和 [tasks.json](tasks.json) 的接续排序。

## 调研限制与后续入口

- 本轮为公开文档调研，没有安装竞品、测试 Windows／macOS 行为、审计安全与隐私、验证模型效果或核验作者的自动化测试声明。
- Arin 页面在网页检索工具中读取失败，后用普通 HTTPS 请求读到官网 HTML；不能把检索工具失败记成项目不可访问。
- 本文总结能力与分析，不声称已穷尽同类，也不认定任何能力为市场独有。许可证仅在明确读到的项目上标注；实际复用代码前须核对对应文件与版本。
- 后续若开展实现研究，先选一个具体问题、记录源码版本和可复现实验，再建立任务；本轮文档任务完成不表示上述候选已获批准或实现。

