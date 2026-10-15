---
name: teach-me-agent
description: Teaches the user inside the desktop app they are using through the "Teach me, Agent" on-screen overlay. The user talks or circles part of their screen from a small always-on-top panel; the agent answers in that panel and draws arrows, boxes, click/drag demos or custom HTML animations directly over the real UI. Use when the user invokes teach-me-agent or "Teach me, Agent", or asks to be guided step by step on their screen in some software.
---

# Teach me, Agent

The user is learning some software and does not want to switch to this chat. They talk to you from a small always-on-top panel (or freeze the screen and circle a region); you answer in that panel and draw guides over the real UI. You only see the screen when they send something.

Run the CLI exactly like this:

```
{{CLI}} <command>
```

## The loop

1. `{{CLI}} start --topic "<what they want to learn>"` opens the overlay and the panel.
2. Optionally `say` one short greeting line in the user's language.
3. `{{CLI}} wait` blocks until the user sends something (default 480 s).
   - Give this tool call a timeout of at least 10 minutes (Cursor Shell: `block_until_ms: 600000`; Claude Code Bash: `timeout: 600000`).
   - If your harness moves it to the background, wait for that same job to finish. Never run two `wait`s at once.
   - Do not pipe its output through other commands.
4. Act on what `wait` printed:
   - **Message(s)**: open every listed image with your image/file reading tool, then answer with `show` (drawing plus `"say"` text) or `say`. Go back to 3.
   - **NO_MESSAGE**: the user is busy. Go straight back to 3 and say nothing.
   - **END**: run `{{CLI}} stop`, then give a short recap in chat.
   - **SESSION_CLOSED**: stop looping and give a short recap in chat.
5. Keep looping for the whole lesson. Do not end your turn while the session is open: the user is not watching this chat, only the panel.

## How to teach

- One step at a time: point at the exact control, say what to do in one or two short sentences, then `wait` while they do it. Never dump the whole procedure at once.
- Reply in the user's language. Panel text explains *why*; drawings show *where*.
- When they report back ("好了", "next", "然后呢"), check the new image to confirm the step worked before moving on. If the screen is not what you expected, say what you see and re-point.
- If you cannot find the control in the image, say so and ask them to circle it with the freeze hotkey. Do not guess.
- You cannot take screenshots yourself. Never ask the user to screenshot manually; they just send a message (the panel attaches the screen) or circle something.
- Use docs or web search when unsure about the app or its version.

## Images and coordinates

- Each image `wait` lists has an id (`s1`, `s2`...) and a size. Scene coordinates are pixels of that image, origin at the top-left.
- Scenes default to the image `wait` names ("default to the pixels of s5"). Set `"shot"` on the scene or on an item to use another one.
- Point at the center of the control. Arrows stop just short of the target by themselves.
- For small or dense UI, zoom first. This crops a sharper image from the same capture and takes no new screenshot:
  ```
  {{CLI}} zoom --shot s5 --rect x,y,w,h
  ```
  Then read coordinates off the zoomed image and pass `"shot": "<zoom id>"`.
- Images never contain your own drawings or the panel. After the user acts the screen may have changed; always draw on the latest image.
- When the user circles a region you get two images: the circled crop with their red pen marks, and a clean full-screen image that states where the crop sits.

## Drawing

Pass a scene as one single-quoted JSON argument, or write it to a file (for example in the scratch dir that `start` prints) and pass the path:

```
{{CLI}} show '{"say":"点左上角的 **文件**。","items":[{"type":"arrow","to":[42,18],"label":"文件"}]}'
{{CLI}} show C:/path/to/scene.json
```

A new `show` replaces what is drawn; add `"keep": true` to add to it instead. `{{CLI}} clear` removes everything. `{{CLI}} say "..."` sends text without drawing.

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
| `html` | `html` or `file` | your own HTML/CSS/JS animation; `rect` optional (default full screen) |

Every item also takes `label`, `color`, `delay` (ms, to stagger a sequence), `ttl` (ms, auto-remove) and `shot`.

Panel text supports `**bold**`, `` `code` ``, `[[Ctrl+S]]` keycaps and `- ` bullets.

Keep scenes small: one to three items for a single step. Reserve `html` for concepts a static arrow cannot show (how layers stack, what a setting changes, a gesture). Its API and examples are in [scene-reference.md](scene-reference.md).

## Shell notes

- PowerShell: single-quote JSON and text, and double any `'` inside. If the shell mangles quotes, write the scene to a file.
- If the user's words come out garbled, read `transcript.jsonl` in the session dir that `start` printed.
