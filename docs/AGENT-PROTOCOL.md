# Agent 使用协议（重建版本）

全局 CLI：`tma`（兼容 `teach-me-agent`）；未注册时用 `node bin/teach-me.mjs`。产品与协议Agent无关，需要宿主能执行本地命令、查看图片并可靠接收App消息。源码安装：`npm ci`、`npm run build`、`npm link --offline`，再按[skill安装步骤](../README.md#2-install-the-skill)显式选择宿主技能父目录。App由start按需启动，源技能见[SKILL.md](../skills/teach-me/SKILL.md)。

每个 Agent 使用稳定、不同的 `--client 名称`，或设置 `TEACH_ME_CLIENT`。有 CODEX_THREAD_ID 时默认使用它；无法识别宿主时默认 default。同名 client 会复用连接凭据，不能代表两个独立 Agent。以下命令均以 `tma` 为前缀。

## 教学循环

1. `start --topic '学习目标' [--display ID]` 启动宿主并连接。由 CLI 拉起的第一次 start 免审批；已运行宿主上的新连接需要用户批准。多屏且没指定 ID 时请用户选屏。
2. 需要界面信息时先观察：打开新消息全部`shots.path`；没有足够新的相关画面则主动`capture`，打开返回的`shot.path`再判断。首次视觉指引、操作后状态未知、指错/新弹窗或错误都要重新取证；用户已附足够新的图时复用，小图标用zoom，概念问题不无谓抓屏。
3. `say '先打开文件菜单。'`只发短句，或`show scene.json`显示指引并说一句；scene绑定实际查看的shot。用户亲自操作，不代点击、滚动或输入。拒绝取图后不循环申请或盲猜当前坐标。
4. 收消息优先使用已配置并端到端验证的原生桥；仅有宿主hook能力不算接入。**当前CLI没有原生适配器，默认仍用wait兜底**。未来已验证原生模式按适配器的投递/ack路径接收，不能同时开第二消费者。
5. 兜底时`wait --timeout 480`，外层工具允许至少490秒或通过后台会话续等；只能有一个wait。超时安静再等，ended/用户停止时结束；收到消息回到观察与教学，不因超时定时抓图。

wait 先把结果写到 stdout 并等待写入回调，再确认消息；未确认的消息会在后续 wait 重发。进程/工具被打断后继续等待，避免重复教学。

原生策略与官方宿主能力边界见[HOST-INTEGRATION.md](rebuild/HOST-INTEGRATION.md)。安装skill不会注册hook或自动获得唤醒能力。

## 命令

| 命令 | 行为 |
| --- | --- |
| start / attach --session ID | 建立教学 / 审批连接 |
| status | 会话、选屏、近期截图路径 |
| wait [--timeout 秒] | 兼容兜底接收，默认480秒；输出后CLI自动ack |
| say 文字 | 面板显示 Agent 的短句 |
| show JSON或文件 | 必须含非空 say；一次替换整个 Agent 场景 |
| capture | Agent主动请求当前画面，遵守审批；返回shot.path须打开，内部最多三次尝试 |
| zoom --shot s1 --rect x,y,w,h | 从同一帧的原始像素裁切，不重新截图 |
| clear | 仅清 Agent 指引；--all 也清用户笔迹，需要用户授权 |
| board | 报告用户和 Agent 笔迹数量 |
| stop | 结束并关闭应用 |
| help / --help / --version | 查看英文命令帮助与版本，不启动 App |
| protocol | 输出本协议，不依赖当前工作目录 |
| skill install --skills-dir 目录 | 安装/更新通用教学skill；支持--agent codex位置预设与install-skill别名 |
| skill status / path | 查看安装状态/目标；--skills-dir 可指定技能父目录 |

通用安装用--skills-dir指定宿主认可的技能父目录，安装器会在其中创建teach-me/SKILL.md；status使用同一目录验证。文件安装与宿主发现分别确认，不支持skill加载时可让Agent直接读取指引并调用CLI。未指定目录时仍兼容Codex预设，位置为CODEX_HOME/skills/teach-me或~/.codex/skills/teach-me；现有npm run setup也保留构建/link/安装Codex预设的快捷行为。

安装器不会修改其他Agent配置，不覆盖外来技能或已修改的安装内容；再次install可更新本工具管理且未经修改的版本，之后按宿主规则重载。CLI start/attach输出属于本地连接结果，含凭据，不要把完整结果或客户端文件复制到聊天/仓库。

## 场景

```json
{"say":"点这里打开文件。","shot":"s1","pattern":"point","to":[100,80],"label":"文件"}
```

基础 items：arrow、box、spotlight、label、keys、stroke、click、drag、path、step、scroll、html。pattern 当前支持 point/highlight/keys/click/drag。整个场景共用一张 shot，不支持逐 item 混用截图。

HTML 示例：`{"type":"html","rect":[100,100,300,180],"html":"<div>解释</div>","ttl":15000}`。最多一段、256KB、屏幕面积最多 35%、TTL 最多 60 秒。禁止 file，素材仅 data/blob；宿主水印不由内容控制。资源占用有看门狗，但尚未完成硬上限验收。

返回图片长边最多 1024；几何换算使用采集时的屏幕 bounds/scaleFactor。zoom 保留 crop 偏移，仍按 zoom 返回图片的像素画。屏幕变更后旧坐标被拒绝，先重新 capture。

## 已知限制

当前只交付wait接收路径：超时后重新wait，CLI输出后自动ack，处理消息并按需观察/主动capture后继续接收。没有另行配置并验证的原生桥时，Agent退出等待不会自动被应用唤醒。无活跃wait且ready 15秒或thinking 5分钟无活动时，面板提示连接待确认；消息保留到同一会话重连。活跃长轮询不会因此超时。未来原生模式须同步适配健康状态及可靠ack，不能只移除wait。

CLI 的 wait 默认等待 480 秒，使用 node:http 的明确请求期限。若命令失败，保留具体错误，先用 status 判断应用/会话是否仍在：同一会话仍活跃时可重试；应用已退出或会话变更须报告，不能声称仍在监听。本地 runtime.log 只记录进程/等待生命周期，不含消息内容。

此协议是重建版本，不完整兼容旧 CLI 参数。尚未实现 say --copy、capture --title/轻量窗口上下文、内置首次引导。热键当前固定为 Ctrl+Alt+W 和 Ctrl+Alt+H。不要把未支持的旧命令写进 Agent 工作流。当前全局命令依赖源码 checkout，独立安装包尚属T08。

截图保留在用户数据目录的 sessions 下，默认启动时清理七天前的会话；本地 ASR 的临时录音在成功或失败后删除。不要把这些文件加入 Git。
