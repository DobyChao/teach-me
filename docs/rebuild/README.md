# 重建计划

更新：2026-10-18。空分支基线：`f5e1e56`（设计参考快照 `54623c6`）。本目录是随 Git 演进的工程规划，外部聊天和 agent 私有记忆不是进度来源。

当前主线为 `master`，从重建分支提升；原 master 位于 `codex/master-backup-20261017`（本地与 origin 均已保存）。详情见 `evidence/T13.md`；功能验收仍以 tasks.json 为准。

## 工作流

先从根 [MEMORY.md](../../MEMORY.md) 恢复项目意图与权威来源，运行 `npm run context:check`。自动生成的 [CONTEXT.md](CONTEXT.md) 提供任务全貌与优先接续项；变更源文件后运行 `npm run context`，审阅差异并随实现提交。生成器不依赖聊天、个人记忆、运行中的应用或绝对机器路径。

规格 `PRODUCT.md` → 决策 `DECISIONS.md` → 任务 `tasks.json` → 验收 `ACCEPTANCE.md` → 证据 `evidence/` → 接续记录 `PROGRESS.md`。

`tasks.json` 是任务状态的唯一来源；nextUp只引用任务并写优先理由和下一步。CONTEXT.md是生成视图，不维护第二份手写勾选看板。`PROGRESS.md` 只记录当前结论、验证限制与入口，旧正文归档在 history/，不让历史状态混入当前结论。

状态：`todo`、`in_progress`、`blocked`、`done`。done 必须有证据且所有依赖 done；blocked 必须写原因。证据至少包含命令、结果、限制；真机任务必须有实际桌面观察记录。规划检查器只能验证结构，不能替人判断证据真假。

## 阶段与退出条件

| 阶段 | 交付 | 退出条件 |
| --- | --- | --- |
| M0 规划基础 | 规格、ADR、任务图、验收、检查器 | 需求可追踪，检查器通过 |
| M1 UI 与领域基础 | React/TS/Vite、token、单一输入组件、状态预览 | 类型/领域测试/构建通过；视觉验收单列 |
| M2 桌面输入闭环 | 新 Electron 宿主、typed bridge、截图与焦点控制器 | 鼠标/快捷键输入与失败重试在 Windows 真机通过 |
| M3 Agent 闭环 | 会话、CLI、消息 ack、指引、缩放 | 真实 Agent 完成一轮看屏→指引→用户反馈 |
| M4 配套体验 | 画板、审批、语音、设置、引导 | 正常/拒绝/取消/超时均可恢复 |
| M5 交付 | 多屏、故障恢复、打包、文档 | 回归与安装包验收通过 |

顺序优先建立真实的文字纵向链路，再扩展语音与设置。旧实现留在另一分支，不整体搬旧 main.js，不因界面看起来完整而宣称完成。

## 如何继续

运行 `npm run plan`，按 `tasks.json.nextUp` 的建议排序检查依赖、验收与证据；用户新请求可改变排序。未解决的产品/平台决策在 `DECISIONS.md` 的开放问题表，需要对应决策的工作开始前先形成明确结论。

最近一次实际试用的问题、修复与后续优化建议见 [T18 试用记录](evidence/T18.md)。隔离运行 `npm run build` 后执行 `node scripts/dogfood.mjs`，自动验证用 `node scripts/dogfood.mjs --verify`；不会占用正常应用的快捷键，截图附件默认关闭，测试数据位于忽略的 `.runtime/dogfood`。

## 变更规则

交互变化：同一提交修改规格、ADR、相关验收和任务；工程变化：修改架构、任务及验证；仅进度变化：任务 + 证据 + PROGRESS。发现旧文档矛盾时保留原始讨论，由 ADR 写明取舍。

记忆闭环：新意图/纠正写来源，决策写理由，失败写条件与观察，未验证项保留；收尾更新任务、证据与接续，运行 `npm run context` 和 `npm run check`。CONTEXT的源摘要覆盖规范入口、src/bin/scripts/test/docs与CI文件及依赖声明；源代码或规划改变而未刷新会失败。检查不读.runtime、Git元数据、用户配置或日志；不校验文档事实是否真实，不代替验收。使用方法见 [MEMORY.md](../../MEMORY.md)。
