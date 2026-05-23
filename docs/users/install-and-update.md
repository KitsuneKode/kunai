---
title: Install And Update
description: Install Kunai across platforms and keep source, global, and packaged installs current.
---

# Install And Update

Kunai supports source installs, global package installs, and packaged binary-style installs.

## Install

```sh
# Interactive installer (OS detection, optional deps, npm/bun/source)
curl -fsSL https://raw.githubusercontent.com/KitsuneKode/kunai/main/install.sh | bash

# Inspect installer actions first
curl -fsSL https://raw.githubusercontent.com/KitsuneKode/kunai/main/install.sh | bash -s -- --dry-run
```

```sh
npm install -g @kitsunekode/kunai
kunai
```

From source:

```sh
git clone https://github.com/kitsunekode/kunai.git
cd kunai
bun install
bun run link:global
kunai
```

## Update Checks

Kunai may run a cached background update check at startup. The check is non-blocking and never runs package-manager or installer commands silently.

Manual check:

```text
/update
```

The update panel shows install-method-aware guidance:

- source checkout: pull the repository, then refresh dependencies/build as needed
- Bun global install: run `bun update --global @kitsunekode/kunai`
- npm global install: run `npm install -g @kitsunekode/kunai`
- packaged binary: download the latest release manually

You can snooze automatic checks for seven days or disable them from the update panel. Manual `/update` remains available.

## Release Notes

Every published package should include:

- a Changesets-generated version bump in `apps/cli/package.json`
- a human-readable entry in `apps/cli/CHANGELOG.md`
- `bun run typecheck`, `bun run lint`, `bun run fmt:check`, and `bun run test` passing locally
- `bun run pkg:check` passing before publish
- `bun run release:dry-run` passing before the final `bun run release`
- one opt-in live provider smoke pass for the provider paths the release depends on, using the isolated `test/live` profile output as evidence

For support reports after an update, run `/report-issue` from Kunai. For developer reproduction, launch with `--debug-session`, reproduce the issue, then run `/export-diagnostics`.

More flag details live in [`../../.docs/cli-reference.md`](../../.docs/cli-reference.md).
