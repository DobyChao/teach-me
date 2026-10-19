---
name: teach-me
description: Guide a user through software with the local Teach me, Agent desktop App and tma CLI. Use for live step-by-step teaching with screen annotations and user replies in the App, or when the user explicitly asks to connect Teach me. Not for ordinary repository development or general screenshot analysis.
---

# Teach me, Agent

Teach through the user's local App. The user operates the target software; explain and annotate rather than taking over clicks, scrolling, or typing.

## Connect

Run `tma --version` and `tma help` to confirm availability. If missing, report that the App/CLI needs setup; do not guess a checkout path, download a similarly named package, or claim a connection.

Use a stable unique client for this teaching conversation: `tma start --client <id> --topic "学习目标"`. Reuse that `--client` on every command (or set `TEACH_ME_CLIENT`). `CODEX_THREAD_ID` is the default client when available. Distinct agents need distinct clients.

`start` launches the App when necessary. A new connection to an already running App may wait for the user's approval; say so and respect denial. For an existing session use `tma attach --client <id> --session <session-id>`. For multiple displays, use an explicit `--display` ID or let the user select in the App.

Connection credentials stay in the local App data directory. Do not copy endpoint/client files or tokens into messages, scene files, or Git.

## Teaching loop

- Send one useful step with `tma say --client <id> "先打开文件菜单。"`.
- Wait with `tma wait --client <id> --timeout 480`. The tool running it needs at least 490 seconds. Keep exactly one pending wait for this client; `wait` handles acknowledgement after output, so do not send a separate ack.
- On a timeout, quietly wait again while teaching remains active. On `ended`, stop. Do not claim to be listening after the wait process has exited.
- Read the user's text and open every `shots.path` with the agent's image tool before reasoning about the screen. Use the actual image width/height and the newest user frame.
- Reply with `say`, or write a JSON scene file and run `tma show --client <id> <scene-file>`. Then return to `wait`.

For example, after inspecting screenshot `s1`, use coordinates from that image:

```json
{"say":"点这里打开文件。","shot":"s1","pattern":"point","to":[100,80],"label":"文件"}
```

Every scene needs a nonempty `say`; one scene replaces the entire Agent layer. `tma clear` clears only Agent annotations. `clear --all` also clears the user's drawing, so use it only if the user requests that.

## Images and recovery

Use user-provided frames first. When another frame is needed, `tma capture` follows the App's screenshot approval policy; do not bypass refusal. `tma zoom --shot s1 --rect x,y,w,h` crops that same frame. Draw in the returned image's pixel coordinates, including when using a zoom; do not multiply by desktop DPI yourself. After display changes, capture again instead of reusing old coordinates.

Run `tma protocol` for supported scene types, HTML limits, coordinate rules, and known limitations. Do not invent options from older versions.

If a command or wait fails, keep the concrete error and run `tma status --client <id>`. Reconnect only to the intended active session; if the App exited, credentials became stale, approval was denied, or the session ended, report that instead of claiming continued listening. Retry timeouts on the same active session; avoid reconnect loops after denial.

`tma stop` closes the App, so use it when the user asks to end/close teaching. Agent waiting is not microphone recording; do not describe it as microphone access.
