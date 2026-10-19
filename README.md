# Teach me, Agent

English | [简体中文](README.zh-CN.md)

Stay in your current software and learn by doing. Your Agent guides you one step at a time with short explanations and on-screen annotations.

Teach me, Agent is agent-agnostic: it connects your existing Agent to a desktop teaching panel through a local CLI. Your Agent needs local command execution, image reading, and reliable delivery of App replies. The Agent chooses whether to use a supported hook or event channel in its environment, connecting and verifying delivery to the current conversation when practical. Otherwise it uses `tma wait`, the transport included with this checkout.

[Let your Agent install it](#let-your-agent-install-it) · [Manual installation](#install-for-your-agent)

## Let your Agent install it

With this repository open in your Agent, copy this request:

```text
Read INSTALL.md in this repository, install Teach me, Agent and its skill for your current Agent environment, and verify the installation.
```

The [Agent installation guide](INSTALL.md) covers setup, choosing the right skill directory, installation, and verification. Your Agent handles those steps. The manual alternative follows below.

## Install for your Agent

### 1. Install the App and CLI

Requires Windows and Node.js 24. From this repository:

```powershell
npm ci
npm run build
npm link --offline
tma --version
```

This registers `tma` and the compatible `teach-me-agent` alias. The CLI links to this checkout; register it again after moving the repository. A standalone installer has not been delivered yet (T08).

### 2. Install the skill

For manual installation, choose the **skills parent directory recognized by your Agent** and replace the placeholder below. Only this command installs the skill:

```powershell
tma skill install --skills-dir "<your-agent-skills-directory>"
```

On success, this command already returns the destination and installation status.

<details>
<summary>Optional: inspect the destination and installation status</summary>

These commands only inspect the installation; they do not install anything:

```powershell
tma skill path --skills-dir "<your-agent-skills-directory>"
tma skill status --skills-dir "<your-agent-skills-directory>"
```

Installation creates:

```text
<your-agent-skills-directory>/
  teach-me/
    SKILL.md
```

The status command should report `"status": "installed"`. This confirms the files were installed; skill discovery and invocation follow your Agent host's own loading rules.

</details>

**Manual installation:** copy the entire [skills/teach-me](skills/teach-me) folder into that skills parent directory. If your Agent cannot load skills, give it [SKILL.md](skills/teach-me/SKILL.md) as instructions and use `tma protocol` for the command details. The CLI connection works independently of a native skill loader.

For CLI-managed installations, rerun the install command with the **same directory** after repository updates. The installer updates its own unmodified files and stops if it finds an unrelated skill or local edits. For manual installations, update your copied folder manually and preserve any local edits.

### 3. Connect your Agent

Reload skills or open a new Agent session, then use your host's skill invocation flow. For example:

> Use the teach-me skill to connect to the local Teach me, Agent App and teach me how to use Paint.

The Agent can also connect directly through the CLI:

```powershell
tma start --client my-lesson --topic 'Learn to use Paint'
```

Each Agent needs a distinct `--client` or `TEACH_ME_CLIENT`. During teaching, the Agent actively requests a fresh capture when visual guidance needs one, sends steps with `say`/`show`, and receives replies through its chosen mechanism, using `wait` when no verified native route is available. You operate the software. See `tma help` and the [Agent protocol](docs/AGENT-PROTOCOL.md), also available through `tma protocol`.

### Optional: Codex preset

Codex is the currently built-in skill-location preset. Codex users can replace step 2 with:

```powershell
tma skill install --agent codex
```

Optionally check it with `tma skill status --agent codex`.

Its destination is `CODEX_HOME/skills/teach-me`, or `~/.codex/skills/teach-me` when unset. In a new Codex conversation, use `$teach-me`. The existing `npm run setup` shortcut builds the App, registers the CLI, and installs this Codex preset. Other hosts use the explicit directory flow above; their skill discovery has not been verified here.

## Using the App

The UI requires Electron and has no browser mock backend. `npm run dev` is for frontend development and does not replace the desktop App.

The panel has three sizes: a default 120 × 48 DIP capsule, a 360-DIP-wide composer opened by the writing button or input shortcut, and a 520-DIP-wide conversation opened by replies, approvals, or the expand button. Replies arriving while you type show a notification without rearranging the input. Drafts, recording, approvals, and drawing edits prevent automatic collapse. The minimize control returns to the capsule while preserving the same input and draft. Drag the left grip or status bar to move the panel; its position is remembered across restarts. See the [panel mode rules](docs/rebuild/PANEL-MODES.md).

The user drawing board uses [Excalidraw](https://github.com/excalidraw/excalidraw) under the MIT license; see [third-party notices](THIRD-PARTY-NOTICES.md). Open the drawing board from the panel without connecting an Agent first. Finish editing to restore click-through behavior, then reopen it to continue. The first Agent connection preserves existing drawings. You can attach the board to a message as a transparent image. User drawings and Agent annotations have separate clear controls. Board contents are held only in memory for the current App run.

When disconnected, the writing entry opens connection instructions that you can copy. While you read older steps, new replies show a jump-to-latest prompt; automatic following resumes at the bottom. See the [T18 usage review](docs/rebuild/evidence/T18.md) for findings and proposed improvements. After building, developers can run `node scripts/dogfood.mjs` for an isolated instance, or add `--verify` to check the disconnected entry, reading position, and long-draft layout. Test data stays out of Git.

Settings open in a separate window that can be moved and resized. Save and cancel stay at the bottom, and closing settings preserves the teaching draft. Panel mode and content-height changes animate; reduced-motion preferences switch directly. See [T20](docs/rebuild/evidence/T20.md) for details and verification scope.

The [T21 refinements](docs/rebuild/evidence/T21.md) use renderer compositing for transitions, remove the system title bar from settings, and add light, dark, and system color modes. Settings preview changes locally; saving applies them to all windows and the board toolbar. See the [appearance contract](docs/rebuild/APPEARANCE.md) for theme tokens and future desktop-pet plans.

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

This project was rebuilt from an empty branch. The previous implementation is preserved at `54623c6` on `codex/companion-rebuild`.

Requires Windows and Node.js 24.

Start with `npm run context:check`. Record new decisions, tasks, verification evidence, and handoff notes in the repository, then regenerate the context with `npm run context`. Both `npm run check` and CI reject stale context. See [project memory](MEMORY.md).

```powershell
npm ci
npm run check
npm run app
```

## Status and troubleshooting

If your terminal cannot find `tma`, use `npm prefix -g` to locate the global command directory, check that it is in PATH, and reopen the terminal. Before global registration, use `node bin/teach-me.mjs` from the checkout. Installing files does not start teaching or modify other Agent configuration.

See the handoff notes for implemented features and unverified behavior. This branch has not completed all v1 functionality.

If `npm run app` exits on its own, the terminal reports the Electron exit code, Windows status code, and runtime duration. Diagnostics are saved to `%APPDATA%/teach-me-agent-v2/runtime.log`, or inside `TEACH_ME_AGENT_HOME` when set; they do not include message text or tokens. Repeated launches report an existing instance so that a second process exiting normally is not mistaken for the original App closing. If remote control shows a taskbar icon but no floating panel, also check the App's screen-sharing visibility setting.
