# Agent 使用协议（重建版本）

本地 CLI：`node bin/teach-me.mjs`。每个 Agent 使用稳定、不同的 `--client 名称`，或设置 `TEACH_ME_CLIENT`。有 CODEX_THREAD_ID 时默认使用它；无法识别宿主时默认 default。同名 client 会复用连接凭据，不能代表两个独立 Agent。

## 教学循环

1. `start --topic '学习目标' [--display ID]` 启动宿主并连接。由 CLI 拉起的第一次 start 免审批；已运行宿主上的新连接需要用户批准。多屏且没指定 ID 时请用户选屏。
2. `say '先打开文件菜单。'` 只发短句。
3. `wait --timeout 480` 等用户；执行工具允许至少 10 分钟。只能有一个 wait。超时安静地再等，ended 时停止。
4. 收到消息后打开所有 shots.path，按文件实际 width/height 读坐标。优先用用户刚发送的画面。
5. `show scene.json` 显示指引并说一句，然后回到 wait。用户亲自操作，不代点击、滚动或输入。

wait 先把结果写到 stdout 并等待写入回调，再确认消息；未确认的消息会在后续 wait 重发。进程/工具被打断后继续等待，避免重复教学。

## 命令

| 命令 | 行为 |
| --- | --- |
| start / attach --session ID | 建立教学 / 审批连接 |
| status | 会话、选屏、近期截图路径 |
| say 文字 | 面板显示 Agent 的短句 |
| show JSON或文件 | 必须含非空 say；一次替换整个 Agent 场景 |
| capture | 根据用户审批档位抓图；最多三次尝试 |
| zoom --shot s1 --rect x,y,w,h | 从同一帧的原始像素裁切，不重新截图 |
| clear | 仅清 Agent 指引；--all 也清用户笔迹，需要用户授权 |
| board | 报告用户和 Agent 笔迹数量 |
| stop | 结束并关闭应用 |

## 场景

```json
{"say":"点这里打开文件。","shot":"s1","pattern":"point","to":[100,80],"label":"文件"}
```

基础 items：arrow、box、spotlight、label、keys、stroke、click、drag、path、step、scroll、html。pattern 当前支持 point/highlight/keys/click/drag。整个场景共用一张 shot，不支持逐 item 混用截图。

HTML 示例：`{"type":"html","rect":[100,100,300,180],"html":"<div>解释</div>","ttl":15000}`。最多一段、256KB、屏幕面积最多 35%、TTL 最多 60 秒。禁止 file，素材仅 data/blob；宿主水印不由内容控制。资源占用有看门狗，但尚未完成硬上限验收。

返回图片长边最多 1024；几何换算使用采集时的屏幕 bounds/scaleFactor。zoom 保留 crop 偏移，仍按 zoom 返回图片的像素画。屏幕变更后旧坐标被拒绝，先重新 capture。

## 已知限制

Agent 需要持续调用 wait：超时后重新 wait，收到消息后 ack、回答，再回到 wait。一次 wait 结束后退出的 Agent 不会自动被应用唤醒。无活跃 wait 且 ready 15 秒或 thinking 5 分钟无活动时，面板提示连接待确认；消息保留到同一会话重连。活跃长轮询不会因此超时。

此协议是重建版本，不完整兼容旧 CLI 参数。尚未实现 install-skill、say --copy、capture --title/轻量窗口上下文、内置首次引导。热键当前固定为 Ctrl+Alt+W 和 Ctrl+Alt+H。不要把未支持的旧命令写进 Agent 工作流。

截图保留在用户数据目录的 sessions 下，默认启动时清理七天前的会话；本地 ASR 的临时录音在成功或失败后删除。不要把这些文件加入 Git。
