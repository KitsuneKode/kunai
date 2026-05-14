# Install And Update

Kunai supports source installs, global package installs, and packaged binary-style installs.

## Install

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

More flag details live in [`../../.docs/cli-reference.md`](../../.docs/cli-reference.md).
