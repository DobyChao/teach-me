# Teach me, Agent

English | [简体中文](README.zh-CN.md)

Stay in your current software and learn by doing. Your Agent guides you one step at a time with short explanations and on-screen annotations.

This project was rebuilt from an empty branch. The previous implementation is preserved at `54623c6` on `codex/companion-rebuild`.

## Project planning

- [Project as memory: start here](MEMORY.md)
- [Generated project context](docs/rebuild/CONTEXT.md)
- [Planning guide](docs/rebuild/README.md)
- [Product specification](docs/rebuild/PRODUCT.md)
- [Architecture](docs/rebuild/ARCHITECTURE.md)
- [Task status](docs/rebuild/tasks.json)
- [Current handoff notes and limitations](docs/rebuild/PROGRESS.md)
- [Acceptance criteria](docs/rebuild/ACCEPTANCE.md)
- [Original design decisions](docs/DESIGN-NOTES.md)

## Development

Requires Windows and Node.js 24.

Start with `npm run context:check`. Record new decisions, tasks, verification evidence, and handoff notes in the repository, then regenerate the context with `npm run context`. Both `npm run check` and CI reject stale context. See [project memory](MEMORY.md).

```powershell
npm ci
npm run check
npm run app
```

## Install for your Agent

The desktop App, global CLI, and Agent skill work together. To install from source, run `npm ci` in this checkout, then:

```powershell
npm run setup
```

This builds the App, registers the global `tma` command with `npm link --offline` (keeping the `teach-me-agent` alias), and installs the `$teach-me` skill for Codex. The CLI links to this checkout; register it again if you move or delete the repository. A standalone installer and release remain part of T08 and have not been delivered.

From any directory:

```powershell
tma --version
tma skill status
tma start --topic 'Learn to use this software'
```

In a new Codex conversation, invoke `$teach-me`, for example: "Use $teach-me to connect to the local App and teach me how to use Paint." Existing conversations may need to reload skills. During teaching, the Agent uses `wait` for your replies and `say`/`show` for guidance; you operate the software yourself. Run `tma help` for commands and `tma protocol` for the full Agent protocol.

You can also install each part separately: after building, run `npm link --offline`, then `tma skill install --agent codex`. The skill is copied to `CODEX_HOME/skills/teach-me`, or `~/.codex/skills/teach-me` when `CODEX_HOME` is unset. Use `tma skill path` to inspect the destination, or `--skills-dir DIR` to specify the skills parent directory for another compatible host. The versioned source is [skills/teach-me/SKILL.md](skills/teach-me/SKILL.md); run the install command again after changing it. The installer updates only its own unmodified files and stops if it finds an unrelated skill with the same name or local edits.

If your terminal cannot find `tma`, use `npm prefix -g` to locate the global command directory, check that it is in PATH, and reopen the terminal. Before global registration, you can still use `node bin/teach-me.mjs`. Setup does not start a teaching session or modify other Agent configuration.

See the [Agent protocol and supported features](docs/AGENT-PROTOCOL.md). Each Agent should use a distinct `--client` or `TEACH_ME_CLIENT`.

## Using the App

The UI requires Electron and has no browser mock backend. `npm run dev` is for frontend development and does not replace the desktop App.

The panel has three sizes: a default 120 × 48 DIP capsule, a 360-DIP-wide composer opened by the writing button or input shortcut, and a 520-DIP-wide conversation opened by replies, approvals, or the expand button. Replies arriving while you type show a notification without rearranging the input. Drafts, recording, approvals, and drawing edits prevent automatic collapse. The minimize control returns to the capsule while preserving the same input and draft. Drag the left grip or status bar to move the panel; its position is remembered across restarts. See the [panel mode rules](docs/rebuild/PANEL-MODES.md).

The user drawing board uses [Excalidraw](https://github.com/excalidraw/excalidraw) under the MIT license; see [third-party notices](THIRD-PARTY-NOTICES.md). Open the drawing board from the panel without connecting an Agent first. Finish editing to restore click-through behavior, then reopen it to continue. The first Agent connection preserves existing drawings. You can attach the board to a message as a transparent image. User drawings and Agent annotations have separate clear controls. Board contents are held only in memory for the current App run.

When disconnected, the writing entry opens connection instructions that you can copy. While you read older steps, new replies show a jump-to-latest prompt; automatic following resumes at the bottom. See the [T18 usage review](docs/rebuild/evidence/T18.md) for findings and proposed improvements. After building, developers can run `node scripts/dogfood.mjs` for an isolated instance, or add `--verify` to check the disconnected entry, reading position, and long-draft layout. Test data stays out of Git.

Settings open in a separate window that can be moved and resized. Save and cancel stay at the bottom, and closing settings preserves the teaching draft. Panel mode and content-height changes animate; reduced-motion preferences switch directly. See [T20](docs/rebuild/evidence/T20.md) for details and verification scope.

The [T21 refinements](docs/rebuild/evidence/T21.md) use renderer compositing for transitions, remove the system title bar from settings, and add light, dark, and system color modes. Settings preview changes locally; saving applies them to all windows and the board toolbar. See the [appearance contract](docs/rebuild/APPEARANCE.md) for theme tokens and future desktop-pet plans.

## Status and troubleshooting

See the handoff notes for implemented features and unverified behavior. This branch has not completed all v1 functionality.

If `npm run app` exits on its own, the terminal reports the Electron exit code, Windows status code, and runtime duration. Diagnostics are saved to `%APPDATA%/teach-me-agent-v2/runtime.log`, or inside `TEACH_ME_AGENT_HOME` when set; they do not include message text or tokens. Repeated launches report an existing instance so that a second process exiting normally is not mistaken for the original App closing. If remote control shows a taskbar icon but no floating panel, also check the App's screen-sharing visibility setting.
