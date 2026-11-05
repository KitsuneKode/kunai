# Kunai verification map

Maintained source for user-path verification. Read this index before driving;
pick feature files that match the change under test. Cross-check
[references/scenarios.md](../references/scenarios.md) for journey-wide reverse cases.

## Baseline preconditions

- Never point drivers at the live profile (`~/.config/kunai`, `KUNAI_CONFIG_DIR`).
- Isolation uses disposable HOME/XDG/APPDATA plus the file credential backend.
- Analytics stays off; seeded profiles decline consent and must not mint `installId`.
- Name the tier in every report: L2 replay, L3 tmux, L4 real mpv, L5 live, Kitty visual.

## Driving conventions

- One transition at a time — capture, act, capture, inspect backend.
- Double-witness: quoted frame line **and** matching SQLite/config row before claiming persistence.
- Kitty mouse steps are PTY SGR injection, not native desktop pointer proof.
- Live Kitty requires `--live --provider <production-id>` (or `--matrix --live`); other providers stay disabled.
- After teardown, run `bun run agent:verify -- evidence --evidence DIR` — proof must survive profile disposal.

## Proof and skip reporting

- UI proof includes PNG **and** text export; inspect artwork and layout in the image viewer.
- Playback proof requires observed clock advancement **and** manual frame inspection (`decoded-frame.png`).
- A green fixture probe or provider reachability check is not live playback.
- Record unreachable prerequisites honestly; a skip is not a pass.

## Feature entry contract

Each feature file uses four H2 sections: `Sub-features`, `How to get to it (user POV)`,
`Driving it with <harness>`, and `Gotchas`.

## Features

- [Search and browse](./search-and-browse.md) — query, catalog lane, footer navigation, artwork.
- [Command palette and settings](./command-palette-settings.md) — palette entry, settings toggles with config witness.
- [Playback and post-play](./playback.md) — resolve, mpv IPC, history progress, post-play actions.
- [Stream faceted filters](./stream-faceted-filters.md) — stream picker facet model and UI transitions.
- [Up Next and queue](./up-next-queue.md) — enqueue, relaunch retention, explicit restore.

## Maintenance

Run Cursor's `/maintain-verification-skill` periodically to reconcile this map with source
and one serial live pass per feature. Harness fixes ship only after a re-drive proves them.
