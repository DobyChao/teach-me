# 项目即记忆

目标：换一个 Agent、换一台机器或隔一段时间回来，只靠 Git 中的工程文件也能继续工作。这里是检索入口；任务状态、决议与证据各自只维护一份。

## 先恢复上下文

1. 读 [AGENTS.md](AGENTS.md) 的工程约定，执行 `npm run context:check`。
2. 读 [CONTEXT.md](docs/rebuild/CONTEXT.md)：自动生成的任务状态、优先接续项和证据链接。过期时先核对源文件，再运行 `npm run context` 并审阅差异。
3. 读 [规划入口](docs/rebuild/README.md)、[产品规格](docs/rebuild/PRODUCT.md)、[tasks.json](docs/rebuild/tasks.json) 与 [当前接续](docs/rebuild/PROGRESS.md)，再按任务查阅 ADR、架构、验收与证据。
4. 动手前用 `git status --short`、`git log -5 --oneline` 核对实际工作区。文档里的“某次运行成功”不表示本机现在仍在运行，也不表示已经推送。

## 长期意图与已接受的取舍

| 记住什么 | 为什么／权威来源 |
| --- | --- |
| 伴随教学，只指不代操作，复用用户已有 Agent | [PRODUCT R01](docs/rebuild/PRODUCT.md)、[Agent 协议](docs/AGENT-PROTOCOL.md) |
| 产品与协议Agent无关；通用安装前置，具体宿主只作为可选预设 | 用户2026-10-19纠正README；[ADR-021](docs/rebuild/DECISIONS.md)、[skill安装步骤](README.md#2-install-the-skill)；文件安装与宿主发现分别验收 |
| CLI帮助与默认README使用英文，另保留中文README并互链 | 用户2026-10-19要求；[ADR-020](docs/rebuild/DECISIONS.md)、[English](README.md)、[简体中文](README.zh-CN.md) |
| 产品由桌面App、全局tma命令和可安装Agent skill组成 | 用户2026-10-19明确要求；[ADR-019](docs/rebuild/DECISIONS.md)、[安装入口](README.md#install-for-your-agent)、[技能源码](skills/teach-me/SKILL.md)；当前是源码安装，独立安装包仍待交付 |
| 用户认可原设计方向，要求从空工程重建 | [ADR-001](docs/rebuild/DECISIONS.md#adr-001--接受--2026-10-17--独立重建)，旧快照只供追溯 |
| React + TypeScript + Vite，现有 CSS token；保持唯一输入面 | [ADR-001 / ADR-012–014](docs/rebuild/DECISIONS.md)、[架构边界](docs/rebuild/ARCHITECTURE.md) |
| 冷灰与粉色；小／中／大按情境切换，保护草稿、录音与审批 | [R22](docs/rebuild/PRODUCT.md)、[切换矩阵](docs/rebuild/PANEL-MODES.md) |
| 设置使用独立可移动窗口；主面板过渡包含内容测高，不在终点跳变 | 用户2026-10-19反馈；[ADR-016](docs/rebuild/DECISIONS.md)取代原内嵌设置和静止后直接测高 |
| 用户纠正动效仍卡、系统标题框突兀；浅深/系统模式，主题与桌宠分别扩展 | [ADR-017](docs/rebuild/DECISIONS.md)、[外观契约](docs/rebuild/APPEARANCE.md)取代逐帧原生resize和系统标题栏；桌宠资源/动作尚未实施 |
| 用户自己的画板采用本地 Excalidraw，与 Agent 指引分层 | [ADR-011](docs/rebuild/DECISIONS.md)；目前不跨应用重启保存，不能默认承诺保存 |
| 聚焦前取图；取消后晚回调失效；成功投递才清草稿 | [AGENTS.md](AGENTS.md)、[输入事务](docs/rebuild/ARCHITECTURE.md) |
| 项目规划和记忆直接放在工程里，随 Git 提交 | 用户2026-10-18明确要求“项目即记忆”；[ADR-004 / ADR-015](docs/rebuild/DECISIONS.md) |
| 小提交，不自动 push；测试层级和未验证项必须写清 | [工程约定](AGENTS.md)、[验收标准](docs/rebuild/ACCEPTANCE.md) |

## 信息放在哪里

| 信息 | 唯一维护位置 |
| --- | --- |
| 用户意图、范围、产品行为 | [PRODUCT.md](docs/rebuild/PRODUCT.md)；注明来源 |
| 为什么这样做、替代方案为何放弃、谁取代谁、开放问题 | [DECISIONS.md](docs/rebuild/DECISIONS.md)；历史保留，后续 ADR 明确取代 |
| 模块所有权、边界与协议 | [ARCHITECTURE.md](docs/rebuild/ARCHITECTURE.md)、[AGENT-PROTOCOL.md](docs/AGENT-PROTOCOL.md) |
| 任务状态、依赖、优先接续项与具体下一步 | [tasks.json](docs/rebuild/tasks.json)；nextUp引用已有任务，不复制状态 |
| 怎么才算完成 | [ACCEPTANCE.md](docs/rebuild/ACCEPTANCE.md) |
| 实际做过什么、结果、失败尝试、环境与验证限制 | [evidence/](docs/rebuild/evidence/T18.md)；按任务建证据，不只写“测试通过” |
| 当前接续注意事项与历史入口 | [PROGRESS.md](docs/rebuild/PROGRESS.md)；旧正文移入 history/，不堆成流水账 |
| 完整当前任务视图 | [CONTEXT.md](docs/rebuild/CONTEXT.md)；从上述来源生成，不手改 |

## 每轮工作如何留下记忆

- 开始：理解现有决议；选取或建立任务，写清验收。新请求优先于原排序，及时修改 nextUp。
- 过程中：用户改变范围或纠正理解时更新规格/ADR；发现有效失败尝试时记下条件、观察、原因是否确认和重试条件。事实、推断、候选建议分别标明。
- 结束或中断：回写任务、证据、PROGRESS 中的接续要点；未完成时保留状态，给出具体下一步。更新 MEMORY 仅限长期约束或入口变化。
- 提交前：`npm run context` → 审阅差异 → `npm run check` → 实现和相关记忆同一次提交。检查失败时先修源文件，不能只改生成摘要或删除失败记录。

`context:check` 会检查入口链接、优先任务引用和上下文是否与源文件同步；`check` 与 CI 调用同一检查。它不能证明文档语义正确或真机已经验收，仍需审阅证据。

不要提交截图、录音、对话正文、token、endpoint、日志、用户本机配置或绝对机器路径；证据写可重复步骤和脱敏结论。`.runtime/` 与应用数据目录只是本机临时数据，不是项目记忆。
