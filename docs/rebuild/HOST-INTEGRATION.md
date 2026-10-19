# Agent接收策略：原生唤醒优先，wait兜底

2026-10-19，来源是用户结束快速试用后的反馈。教学行为由[skill](../../skills/teach-me/SKILL.md)定义；消息传输可替换。T27交付规则修订，T28才负责适配器实现。

## 当前实现与边界

当前`Session`拥有用户消息队列、递增id、pending与ack；CLI只有wait长轮询，先打印再ack。宿主capture返回`{shot}`，要打开`shot.path`；用户消息返回`shots[]`。Renderer广播不是外部Agent唤醒通道，status近期截图也不是实时画面。

本仓库未实现原生消息桥、宿主hook注册、事件订阅命令或唤醒能力探测。安装skill不会获得这些能力。现阶段没有另行接通并验证的桥时，仍须保持wait；把skill改成“可以直接结束，hook会唤醒”会重现无回复。

## 官方能力核对

以下是接入候选，均不是TMA已支持声明；实际宿主版本、会话可达性和权限需实测。

首次核对覆盖Codex、Claude Code、OpenCode；用户追问其他Agent后，补查Gemini CLI、Cursor、GitHub Copilot CLI/SDK。以下六种均为官方文档研究，不代表已完成六套接入实验。

| 宿主 | 官方能力 | 对本项目的含义 |
| --- | --- | --- |
| Codex | [Hooks](https://learn.chatgpt.com/docs/hooks)是生命周期扩展，普通async完成不会开始新的空闲turn；[app-server](https://learn.chatgpt.com/docs/app-server)可turn/start、turn/steer；[CLI queue](https://learn.chatgpt.com/docs/cli/reference#codex-queue)可向已有会话排入文本 | hook名称不等于消息入口；要验证正确现有会话实际接收/继续。不能推定新app-server能接管任意桌面对话。queue文档说明文本限制，本机help存在该命令也不证明唤醒已接通 |
| Claude Code | [Channels](https://code.claude.com/docs/en/channels)把外部事件推入打开的会话，当前为research preview；[hooks](https://code.claude.com/docs/en/hooks)的普通async通常等下一轮，asyncRewake退出2可唤起 | 有真实事件通道候选，但受宿主版本/启用方式限制，需要TMA专用接收端；不能把任意PostToolUse当作外部事件监听 |
| OpenCode | [Plugins](https://opencode.ai/v2/docs/build/plugins/)暴露session.prompt等会话调用；[API](https://dev.opencode.ai/v2/docs/api)描述prompt持久接收与调度 | 插件可以承载外部桥，但仍需订阅TMA消息、绑定已有session并处理失败，不是安装SKILL.md即可完成 |
| Gemini CLI | [ACP模式](https://geminicli.com/docs/cli/acp-mode/)通过stdio JSON-RPC接收prompt并提供newSession/loadSession；[Notification hook](https://geminicli.com/docs/hooks/reference/#notification)是CLI向外发出的告警事件 | ACP是可编程消息入口候选，需要当前ACP客户端协作；不能据此推定能注入任意已打开的终端会话。[resume](https://geminicli.com/docs/cli/session-management/)恢复历史也不证明能唤醒原运行实例。官方ACP页示例为--acp，[CLI参考](https://geminicli.com/docs/cli/cli-reference/)仍列--experimental-acp，实际开关须按安装版本help核对 |
| Cursor | [stop hook](https://cursor.com/docs/hooks#stop)可返回followup_message触发后续轮次，有循环上限；[Cloud Agents API](https://cursor.com/docs/cloud-agent/api/endpoints#create-a-run)的POST /v1/agents/{id}/runs向既有云端Agent发送后续提示，沿用对话与工作区；忙碌返回409 | stop发生时才能续跑，不能由此断言空闲后任意外部消息可进入本地IDE对话。云端API是真实接入候选，但范围是云端Agent；本地现有IDE对话的外部投递尚未确认，不能用新建云端Agent替代用户会话 |
| GitHub Copilot CLI/SDK | [SDK兼容表](https://docs.github.com/en/copilot/how-tos/copilot-sdk/troubleshooting/compatibility)列出resumeSession、send/sendAndWait、默认enqueue、运行中immediate以及附件输入 | SDK控制的会话有明确投递接口，是原生适配候选；仍需验证对用户当前CLI会话的可达性/连接所有权，不能推定能接管任意独立终端或编辑器对话 |

T27轮次只读核对本机`codex --version`和`codex queue --help`：0.163.0-alpha.10.2有queue。没有实际投递到用户会话；受限环境提示无法创建PATH别名，未据此改配置。官方文档是接口依据，不能替代端到端实验。

区分三件事：生命周期hook在某个事件发生时执行；会话API让持有连接的客户端投递消息；现有会话桥负责把TMA输入送到用户正在使用的那条对话。前两者不能自动证明第三者。尚未确认本地投递不等于该宿主永远不支持，后续应按实际版本补实验。

接入选择按用户当前宿主和会话可达性进行；本机Codex入口仅是可先做实验的便利条件，不是产品依赖。Claude Channels、OpenCode会话API、Copilot SDK、Gemini ACP都应评估是否能复用用户会话；Cursor云端与本地必须分别记录支持范围。共同队列/ack/交接契约保持Agent无关，宿主差异由适配层承担，skill保留通用能力选择与wait兜底规则。

## 适配器应满足的契约

1. 绑定TMA session/client与目标宿主会话，收到App用户输入才触发，不能投递到另一条对话或自动新建替代Agent。
2. 区分外部通知和启动/继续模型处理：验证空闲能开始处理，忙碌时有正确排队/steer，结束教学后不再唤醒。
3. 用户消息和附件进入宿主可靠接收边界后才确认TMA消息；失败可重试，按session/message id去重。现有CLI wait在stdout后自动ack，不能直接拿它做后台转发再假定不会丢消息。
4. 同一时刻一个消费者；原生失活先停旧消费者再降级wait，恢复也要交接未处理消息。用户取消、会话结束或宿主退出后停止重连。
5. 原生模式空闲仍可能健康；当前ready 15秒/thinking 5分钟无活动的提示依赖长轮询假设，接适配器时需要显式健康信号，不能只删wait就宣称在线。
6. 凭据与宿主句柄留在主机适配层，Renderer不持有；skill只描述如何选择已验证能力，不承担后台进程/调度或全局hook配置。

## T28的可执行起点

先在隔离、可访问的现有宿主会话验证外部投递→空闲实际回复，候选为本机queue/app-server或宿主channel；记录实际版本和权限。再接TMA队列与持久接收/ack边界，覆盖重复、失败、取消、结束、双消费者交接和idle健康状态。通过后才能暴露“native可用”，安装指南和skill才可把该配置作为已启用选项。

本轮不改宿主hook、不注册事件桥、不启动新试用；主动capture规则可以独立生效，原生唤醒交付继续保持todo。
