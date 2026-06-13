---
title: Install And Update
description: Install Kunai across platforms and keep source, global, and packaged installs current.
---

Kunai supports global package installs and source checkouts. During beta you need **Bun** and **mpv** on your PATH. Packaged binaries may be available from GitHub Releases depending on your platform; the install script detects what is available.

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

## Release notes

Published versions are listed on [GitHub Releases](https://github.com/KitsuneKode/kunai/releases). After updating, run `/update` inside Kunai to confirm the active version and install method.

For support reports after an update, run `/report-issue` from Kunai. For verbose traces, launch with `--debug-session`, reproduce the issue, then run `/export-diagnostics`.

Contributor release steps live in [Docs maintenance](/docs/developer/docs-maintenance).

More flag details live in the [CLI reference](/docs/users/cli-reference).
