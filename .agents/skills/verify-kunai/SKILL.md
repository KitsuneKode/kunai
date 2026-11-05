---
name: verify-kunai
description: Verify Kunai through real user actions and captured evidence. Use for terminal UX bugs, missing clicks/previews, search or playback regressions, visual inspection, companion security contracts, and end-to-end qualification. Drive AppRoot replay, a held PTY, or isolated Kitty; inspect PNGs as well as text and SQLite/config. For live providers require explicit opt-in, pin each provider, and witness decoded mpv video through IPC and a frame capture. Never equate a probe, screenshot file, accepted key, or green fixture with successful live playback.
---

# Verify Kunai

**A claim is verified only when it cites captured evidence.** Every verification drive records rendered frames, user inputs, and backend SQLite/config state. You must cite the literal frame text, image file, or database row that proves the claim.

- AppRoot replay supports `--verify-citation` for mechanical verification against captured evidence.
- Kitty runs require direct image inspection of `decoded-frame.png` in addition to text/backend logs.
- If evidence is absent or a prerequisite fails, report **"not verified"** with the exact blocker — never "should work".

## The Loop

1. **Route**: Find owning code via `.docs/feature-map.md`. Inspect the real handler, then choose test cases from [references/scenarios.md](references/scenarios.md) — both the happy path **and** the reverse or failure case. One path alone never verifies a feature.
2. **Select Tier**: Choose the lowest tier capable of answering the question (see tier matrix below).
3. **Drive Transitions**: Drive one transition at a time; wait for the targeted surface before acting.
4. **Witness Twice**: Require dual confirmation: the UI frame reflects the change, and the backend (SQLite, `config.json`, or player IPC) commits it.
5. **Report**: Use the standard report template, recording the exact candidate git SHA, dirty tree state, and any unverified gates.

## Tier Selection Matrix

| Tier                       | Command                                          | Proves                                                | Does not prove                                |
| :------------------------- | :----------------------------------------------- | :---------------------------------------------------- | :-------------------------------------------- |
| **L1 unit/integration**    | `bun run test:file <path>`                       | Logic, contracts, and schema invariants               | That an interactive user can reach it         |
| **L2 in-process replay**   | `bun run agent:drive`                            | Shell wiring: real `AppRoot` + `SessionController`    | OS signals, TTY alt-screen, restart lifecycle |
| **L3 held PTY session**    | `bun run agent:session`                          | Real `main.ts` in a held tmux PTY; signals, restart   | Provider reachability, real video decode      |
| **L4 loopback mpv**        | `KUNAI_REAL_MPV=1` + `test/agent/real-mpv*`      | mpv decodes loopback media and Kunai records progress | External live provider reliability            |
| **L5 live & Kitty visual** | `bun run agent:kitty` (`--live --provider <id>`) | Real terminal graphics, font rendering, decoded video | Native OS click delivery, physical phones     |

L2 and L3 execute against fixture providers and mock media with zero network dependency.
L3 requires `tmux` (Linux/macOS). A missing tool is an explicit skip, and **a skip is not a pass**.

## Deep References

Run driver commands from `apps/cli` (or use `bun run --cwd apps/cli`).
Read only the references needed for the selected tier:

- **Driver commands**: [references/driver-commands.md](references/driver-commands.md) — exact replay/PTY flags, settings/queue recipes and failure capture.
- **CLI Wiring & Scenarios**: [references/scenarios.md](references/scenarios.md) — Audio intent (startup vs explicit choice, same-URL reconnect, prefetch isolation, previous-episode reuse), relative download path containment, revoked in-flight transfers, queue operations, and debounced config persistence.
- **Companion Contracts**: [references/companion-contract.md](references/companion-contract.md) — Host validation, port 80 normalization, foreign Origin rejection, loopback cookie isolation, explicit session authentication, stale page/media session release, 1000+ episode catalogs, and WebVTT browser tracks.
- **Kitty Visual & Desktop Driving**: [references/kitty-visual.md](references/kitty-visual.md) — Multi-monitor Hyprland safety rules (placing test windows on laptop `eDP-1` workspace 9 while keeping user focused on `DP-3`), Lua rule handles in `_G`, decoded video verification, and cleanup.
- **Release Candidate Integrity**: [references/release-candidates.md](references/release-candidates.md) — Pinned candidate HEAD, dirty tree tracking, provider declaration → production loader → registry verification pipeline, and unintegrated branch isolation.
- **Physical Phone Qualification**: [references/mobile-phone.md](references/mobile-phone.md) — Physical Android (Termux) and iOS qualification checklists, version/commit pinning, VLC/mpv-android/chooser handoffs, and rollback.

## Core Verification Rules

1. **Isolate Storage Roots**: Always execute with `DO_NOT_TRACK=1` and `storageRootEnv`. Never touch `~/.config/kunai` or live SQLite databases. The credential backend must remain `file`.
2. **Never Enable Analytics**: Seeded profiles decline analytics; dispose checks verify `installId` remains empty. Any test minting an `installId` fails as a contract violation.
3. **Persist Evidence Outside `/tmp`**: Write all verification bundles, frames, and transcripts to a durable path (e.g. `/home/kitsunekode/.t3/scratch/kunai-agy-verification-<date>-<tag>/`).
4. **Cite or Retract**: Every verified claim must quote verbatim text or values from captured frames, IPC responses, or database rows.
5. **Delegate with one desktop owner**: A small-model worker may inspect a bounded feature and propose or execute isolated replay tests. Supply exact file ownership, commands, acceptance evidence and current provider/model settings. Only the coordinator drives graphical windows and reviews PNGs; dependent rechecks use the integrated candidate.
6. **No Synthetic Regex Substitutes**: Test against real rendered output and actual backend rows; never write tests that merely regex-match source code or assert solely on file counts.

## Report Template

```markdown
**Verified** — <behaviour>, <tier>, candidate <sha> (dirty: <true|false>)

- Drive: `<exact command or key plan>`
- Frame: "<quoted line>" (`--verify-citation` ✓)
- Backend: `<table/config row that agrees>`
- Reverse case: `<how action was undone and observed>`
- Failure case: `<how boundary or error case was handled>`

**Not verified** — <what was out of reach and why: tier missing, live-only, device-only>
```
