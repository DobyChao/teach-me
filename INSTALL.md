# Installation guide for Agents

Use this guide when the user asks you to install Teach me, Agent from this checkout. Install the desktop App, global CLI, and teaching skill for the Agent host you are currently running in. The runtime teaching instructions are in [skills/teach-me/SKILL.md](skills/teach-me/SKILL.md).

## Identify the environment and destination

Work from the repository root containing the `teach-me-agent` package. The desktop App requires Windows and Node.js 24 or later. Check the actual environment and report missing prerequisites if installation cannot proceed.

Resolve the current Agent host's real skills parent directory from its instructions, configuration, or a path the user supplied. Prefer an explicit directory over a guessed host. If the destination cannot be established, ask for the missing location. The installer appends `teach-me` to this parent directory.

The unqualified `tma skill install` and `npm run setup` currently select a Codex location preset. Use the explicit-directory workflow below for a host-independent installation.

## Build and register the App and CLI

From the checkout, install dependencies using the lockfile when needed, build, and register the global command:

```powershell
npm ci
npm run build
npm link --offline
```

Verify that `tma --version` works. If the global command is not found, inspect `npm prefix -g` and command resolution; the source CLI remains available as `node bin/teach-me.mjs`. Report a remaining PATH issue instead of claiming the global command is ready. The CLI links to this checkout, so the repository must remain in place.

## Install the skill

Replace the placeholder with the skills parent directory you resolved:

```powershell
tma skill install --skills-dir "<resolved-skills-parent-directory>"
```

This installs `teach-me/SKILL.md` and returns the destination. The installer preserves foreign skills and local modifications; if it refuses an existing destination, report the conflict rather than replacing those files manually.

Check the result internally before reporting success:

```powershell
tma skill status --skills-dir "<resolved-skills-parent-directory>"
```

The expected status is `installed`, with `SKILL.md` present at the returned destination. Use `tma skill path` with the same directory only if you need to inspect the path separately. Reinstalling an unchanged managed skill is safe; updates use the same directory.

If the host has no native skill loader, explain that limitation and offer the [teaching instructions](skills/teach-me/SKILL.md) plus the local CLI protocol (`tma protocol`) as the integration path. Copying a file alone does not establish native skill support.

## Finish

Follow the host's supported skill-reload procedure, or tell the user to start a new Agent session. Distinguish installed files from verified host discovery.

Report the App build result, whether the global `tma` command resolves, the skill destination and status, and any required reload. Installation does not start teaching: wait for the user to request a connection before running `tma start`. A standalone App installer remains unshipped; this is installation from source.
