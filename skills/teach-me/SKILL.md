---
name: teach-me
description: Guide a user through software with the local Teach me, Agent desktop App and tma CLI. Use for live step-by-step teaching with screen annotations and user replies in the App, or when the user explicitly asks to connect Teach me. Not for ordinary repository development or general screenshot analysis.
---

# Teach me, Agent

Teach through the user's local App. The user operates the target software; explain and annotate rather than taking over clicks, scrolling, or typing.

## Connect

Run `tma --version` and `tma help` to confirm availability. If missing, report that the App/CLI needs setup; do not guess a checkout path, download a similarly named package, or claim a connection.

Use a stable unique client for this teaching conversation: `tma start --client <id> --topic "学习目标"`. Reuse that `--client` on every command (or set `TEACH_ME_CLIENT`). Distinct agents need distinct clients.

`start` launches the App when necessary. A new connection to an already running App may wait for the user's approval; say so and respect denial. For an existing session use `tma attach --client <id> --session <session-id>`. For multiple displays, use an explicit `--display` ID or let the user select in the App.

Connection credentials stay in the local App data directory. Do not copy endpoint/client files or tokens into messages, scene files, or Git.

## Observe actively before guiding

Take responsibility for obtaining the visual evidence a step needs. Do not wait for the user to attach a screenshot or explicitly ask you to capture.

- For a screen-dependent lesson, call `tma capture --client <id>` before the first visual instruction if you have no adequate current frame. Open the returned `shot.path` with your image tool before choosing a control or coordinates.
- Capture again when the user's action may have changed the app, page, dialog, or result and their new reply has no adequate current image. A text-only "done" is not visual confirmation. Capture when an annotation is reported wrong, an unexpected error appears, or the visible state is uncertain; inspect the new frame before correcting the instruction.
- Open every user-supplied `shots.path`. Reuse a frame that actually shows the current relevant state; avoid a redundant capture when it already answers the visual question. A screenshot listed by `status` is a past frame, not a live view.
- For a tiny or ambiguous icon, use `tma zoom --client <id> --shot <shot-id> --rect x,y,w,h` and inspect the crop before guessing. Give verbal clarification if the target still cannot be identified reliably.
- Answer conceptual questions without unnecessary capture. Do not take screenshots on a fixed timer, on every wait timeout, or merely to keep a connection alive.

Capture follows the App's approval policy. Request it through `tma capture` rather than asking the user to take a screenshot manually. Respect denial or cancellation; do not repeat the request in a loop or fall back to stale coordinates as if they were current.

## Choose how to receive replies

Decide how to receive App replies using the capabilities actually available in your current environment. Prefer a supported hook, event channel, or native wakeup when suitable. Reuse an existing route or connect one using supported session-scoped facilities when practical; otherwise use `tma wait`. You do not need a host-specific recipe from this skill.

Before relying on a native route, verify that App input reaches **this same conversation and triggers handling while idle**. Merely finding a hook or notification feature is insufficient, and installing the skill does not create a route. If delivery cannot be established and verified, keep the wait fallback active rather than assuming you will be woken.

With a working native route, retrieve any signaled input and attachments, acknowledge only after reliable receipt, then yield to that mechanism. Keep one inbox consumer; do not also run a model-side wait. If the route fails, stop its consumer and retain pending messages before falling back. End session-scoped listeners when teaching stops. The standalone CLI provides only the wait transport; it prints and auto-acknowledges, so forwarding its stdout alone is not proof of reliable native delivery.

**Compatibility fallback:** run `tma wait --client <id> --timeout 480` when no reliable native delivery is active. The tool running it needs at least 490 seconds. Keep exactly one pending wait for this client; the CLI acknowledges after printing, so do not send a separate ack. On a timeout, quietly wait again while teaching is active. On `ended` or a user stop request, stop. Do not end the turn assuming an unconfigured hook will wake you, or claim to be listening after the wait process exits. When using this fallback, append `--wait` to the final `tma say`/`tma show` of each step to deliver and resume waiting in a single command (output: `{delivered, messages, ended, timeout}`); never run it alongside a separate wait.

## Teach one step at a time

Read the reply, obtain or inspect the visual evidence it needs, then send one useful step with `tma say --client <id> "先打开文件菜单。"`, or write a scene file and run `tma show --client <id> <scene-file>`. Stay available through the active receive strategy; returning to a long wait is a fallback, not the teaching policy itself.

When gathering that evidence will take noticeable time (capture, zoom, or deeper inspection), first send a very short acknowledgment such as `tma say --client <id> "我看一下屏幕…"` so the user sees immediate feedback instead of silence, then inspect and deliver the real step. Skip the extra message for quick conceptual answers; do not stack chatter.

For example, after inspecting screenshot `s1`, use coordinates from that image:

```json
{"say":"点这里打开文件。","shot":"s1","pattern":"point","to":[100,80],"label":"文件"}
```

Every scene needs a nonempty `say`; one scene replaces the entire Agent layer. `tma clear` clears only Agent annotations. `clear --all` also clears the user's drawing, so use it only if the user requests that.

## Images and recovery

Draw in the inspected image's pixel coordinates, including when using a zoom. Bind the scene to that frame's `shot` id; do not multiply by desktop DPI yourself. After display changes, capture again instead of reusing old coordinates.

Run `tma protocol` for supported scene types, HTML limits, coordinate rules, and known limitations. Do not invent options from older versions.

If a command or wait fails, keep the concrete error and run `tma status --client <id>`. Reconnect only to the intended active session; if the App exited, credentials became stale, approval was denied, or the session ended, report that instead of claiming continued listening. Retry timeouts on the same active session; avoid reconnect loops after denial.

`tma stop` closes the App, so use it when the user asks to end/close teaching. Agent waiting is not microphone recording; do not describe it as microphone access.
