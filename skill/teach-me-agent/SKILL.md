---
name: teach-me-agent
description: Guides the user inside the desktop app they are using through the "Teach me, Agent" on-screen companion. The user holds one entry to talk or clicks it to type; the agent answers in the capsule and draws over the real UI. Use when the user invokes teach-me-agent or "Teach me, Agent", or asks to be guided step by step on their screen in some software.
---

# Teach me, Agent

The user stays in the app they are learning. You point at the real UI; you do not click, type, or scroll for them. They talk or type from one on-screen entry. You answer in the capsule and draw guides on the screen they picked. You only see the screen when they send a message (screenshot on by default) or when you call `capture` and they allow it.

Run the CLI exactly like this:

```
{{CLI}} <command>
```

## Session

One lesson is on screen at a time, with one session id.

- The agent that launches the app uses `start`. That connection does not ask the user. `start` prints the session id. The user picks the screen unless you pass `--display`.
- Any other agent uses `attach --session <id>`. The user must allow it. If a lesson is already active, no answer denies the connection. Do not launch a second app.
- `status` prints the session id, display, and capture tier. `stop` closes the overlay.

## The loop

1. `{{CLI}} start --topic "<what they want to learn>"` opens the overlay.
2. Optionally `say` one short greeting in the user's language.
3. `{{CLI}} wait` blocks until the user sends something (default 480 s).
   - Give this tool call a timeout of at least 10 minutes (Cursor Shell: `block_until_ms: 600000`; Claude Code Bash: `timeout: 600000`).
   - If your harness moves it to the background, wait for that same job to finish. Never run two `wait`s at once.
   - Do not pipe its output through other commands.
4. Act on what `wait` printed:
   - **Message(s)**: open every listed image, then answer with `show` (drawing plus a short `say`) or `say`. Go back to 3.
   - **NO_MESSAGE**: the user is busy. Go straight back to 3 and say nothing.
   - **END**: run `{{CLI}} stop`, then give a short recap in chat.
   - **SESSION_CLOSED**: stop looping and give a short recap in chat.
5. Keep looping for the whole lesson. Do not end your turn while the session is open: the user is watching the capsule, not this chat.

`wait` does not include capture context (process, mouse, window bounds, or title). That context comes only from `capture`.

## How the user talks to you

- One entry: **hold** to speak, **click** to type. Default hotkey `Ctrl+Alt+W` (the user can change it).
- A screenshot is taken when speech starts, or before the text box opens. Their message attaches that screenshot unless they turned the setting off.
- If the board has ink, they can attach it with the message. Treat a second image marked as board ink as their drawing, not the screen.
- **继续** is a separate button (hotkey unbound until they set one). It means "go on", and it can include a screenshot.
- `Ctrl+Alt+H` hides and shows your guides. If `wait` says guides are hidden, still answer; they will see drawings when they unhide.
- The board is always on and click-through until they enter edit mode. User ink and your strokes are separate. `clear` removes your guides; `clear --all` also clears their ink. Do not clear their ink unless they ask.

## How to teach

- One step at a time: point at the exact control, say what to do in one or two short sentences, then `wait`. Never dump the whole procedure at once.
- Reply in the user's language. Capsule text explains *why*; drawings show *where*.
- Every `show` includes a short `say`. The capsule shows only what you send through `say` or `show`, not this chat.
- When they report back ("好了", "next", "然后呢"), check the new image before moving on. If the screen is not what you expected, say what you see and re-point.
- If you cannot find the control, say so and ask them to mark it on the board. Do not guess.
- Prefer the image they just sent. Call `capture` only when you need a fresh look and they have not just sent one. `capture` follows their approval setting (ask every time, allow for this lesson after a short countdown, or always allow) and may be denied. It retries a few times, then fails. Pass `--title` only when you truly need the foreground window title.
- `{{CLI}} say --copy "..."` also copies the line, for text they should paste themselves.
- Use docs or web search when unsure about the app or its version.

## Images and coordinates

- Each image `wait` or `capture` lists has an id (`s1`, `s2`...) and a size. Scene coordinates are pixels of that image, origin at the top-left.
- Scenes default to the image `wait` names. Set `"shot"` on the scene or on an item to use another one.
- The app converts those pixels with the scale and bounds recorded on that shot. If `status` or a `show` warning says the layout changed, run `capture` (or wait for their next message) and draw on the new image. Do not reuse old coordinates.
- Point at the center of the control. Arrows stop just short of the target by themselves.
- For small or dense UI, zoom first. This crops a sharper image from the same capture and takes no new screenshot:
  ```
  {{CLI}} zoom --shot s5 --rect x,y,w,h
  ```
  Then read coordinates off the zoomed image and pass `"shot": "<zoom id>"`.
- A new `show` replaces the previous scene. `"keep": true` is ignored.
- Images from the user do not include your guides. After they act, the screen may have changed; draw on the latest image.

## Drawing

Three layers, in this order: a preset `pattern`, basic items, and one custom HTML snippet. Pass a scene as one single-quoted JSON argument, or write it to a file (for example in the scratch dir that `start` prints) and pass the path:

```
{{CLI}} show '{"say":"点左上角的 **文件**。","pattern":"point","to":[42,18],"label":"文件"}'
{{CLI}} show C:/path/to/scene.json
```

`show` without a non-empty `say` fails. `{{CLI}} say "..."` sends text without drawing. `{{CLI}} clear` removes your guides. `{{CLI}} board` only reports whether the board has ink.

Patterns: `point` (`to`), `highlight` (`rect`), `click` (`at`), `drag` (`from` and `to`), `keys` (`keys`), `steps` (`steps`: a list of `{at, label}`).

| type | required | notes |
|------|----------|-------|
| `arrow` | `to` [x,y] | `from` optional (auto-placed); label sits at the tail |
| `box` | `rect` [x,y,w,h] | glowing outline |
| `click` | `at` | `button`: left (default), right, double, middle |
| `drag` | `from`, `to` | an animated cursor drags along the path |
| `path` | `points` [[x,y],...] | movement along a route |
| `spotlight` | `rect` | dims everything else |
| `step` | `at`, `n` | numbered badge for a sequence |
| `label` | `at`, `text` | free text bubble, top-left corner at `at` |
| `keys` | `keys` ["Ctrl","S"] | shortcut keycaps; `at` optional (bottom center) |
| `scroll` | `at`, `direction` | up, down, left, right |
| `stroke` | `points` | ink on the agent board layer, not a guide overlay |
| `html` | `html`, `rect` | text only; see the limits below |

Every item also takes `label`, `color`, `delay` (ms), `ttl` (ms) and `shot`.

Panel text supports `**bold**`, `` `code` ``, `[[Ctrl+S]]` keycaps and `- ` bullets.

Keep scenes small: one to three items for a single step. Use a pattern when it fits. Reserve `html` for a concept a static arrow cannot show. Its API, size limits, and examples are in [scene-reference.md](scene-reference.md).

Custom HTML is text in the scene (no `file`). The host sandboxes it, draws a fixed watermark, and drops it on a timer. One HTML item per scene. It cannot be clicked and has no network.

## Shell notes

- PowerShell: single-quote JSON and text, and double any `'` inside. If the shell mangles quotes, write the scene to a file.
- If the user's words come out garbled, read `transcript.jsonl` in the session dir that `start` printed.
