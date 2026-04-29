# Kunai Experiments

This workspace is the private provider research lab.

It is intentionally separate from `apps/cli` and future `packages/*` code:

- scripts here may be noisy, interactive, provider-specific, or tied to one title
- captured HTML, JS chunks, WASM, logs, and notes are allowed here when useful for reverse engineering
- production code must not import from this workspace
- stable findings should be promoted through a provider dossier and implementation handoff before they enter production code

## Layout

```text
apps/experiments/
  package.json       private lab scripts and research-only dependencies
  README.md          this guide
  scratchpads/       raw provider probes, captures, notes, and one-off scripts
```

The `scratchpads/` name is deliberate. It marks the contents as raw research, not production-ready provider packages.

If a provider experiment becomes stable, promote it through this path:

```text
scratchpads/provider-name
  -> provider dossier / docs
  -> Provider SDK handoff
  -> apps/cli provider implementation or hardening while adapters remain
  -> @kunai/providers module after SDK contracts exist
```

Do not move scratchpad code directly into a shared package.

Research naming:

- keep raw labs under `scratchpads/provider-name`
- keep durable findings in report or dossier files with explicit provider names
- use `source`, `mirror`, and `variant` language in new notes so findings map cleanly to the Provider SDK model
- note subtitle, audio, hard-sub, quality, header, expiry, and browser-runtime evidence separately when observed

## Commands

List available research folders:

```sh
bun run --cwd apps/experiments list
```

Run a provider probe:

```sh
bun run --cwd apps/experiments vidking:0ram -- "breaking bad"
bun run --cwd apps/experiments rivestream:headless -- "the matrix"
bun run --cwd apps/experiments anikai:headless -- "one piece" 1 1159
bun run --cwd apps/experiments miruro:headless -- "one piece" 1 1159
```

These scripts are not part of normal root `typecheck`, `lint`, `test`, or `build`.
