# Plan: Make "share this moment" discoverable (and decide on saved moments)

> **Drift check (run first):** `git grep -n "copy-share\|kunai-copy-share" -- apps/cli` — if the in-player key or its legend entry has moved, update the evidence below.

## Status

- **Status:** PROPOSED — small, ready to build.
- **Priority:** P3
- **Effort:** S (discoverability) / M (saved moments, only if wanted)
- **Risk:** LOW
- **Depends on:** none
- **Category:** product / UX

## Correction to an earlier suggestion

An earlier audit note proposed a "bookmark this moment" key and said the share link already declared `startSeconds`. The reader side is further along than that: **sharing a timestamped link already works end to end.**

- In mpv, `Ctrl+Shift+S` signals `copy-share` (`apps/cli/assets/mpv/kunai-bridge.lua:1099-1104`).
- `PersistentMpvSession.handleCopyShareFromMpv` builds the link with the current position as `startSeconds` (`PersistentMpvSession.ts:1275-1287`).
- The codec encodes it as `t=` / a compact field (`packages/types/src/share.ts:177, 246-247`), and opening the link primes the start position (`resolve-share-target.ts`, `apply-resolved-share-target.ts`, `SessionController.ts`), with tests for each hop.

So the declaration-to-reader seam is satisfied. What is missing is discovery.

## The gap

- The playing screen's key legend (`q stop · n next · p prev · a autoplay · u autoskip`) does not list the share key.
- The README and the playback docs do not mention `Ctrl+Shift+S`. Users cannot find the single most shareable thing the player does.

## Work

1. Add "share moment" to the playing key legend and to `keybindings.ts` so the help overlay's no-drift test covers it.
2. Mention it in the README Playback section and the share-links user doc.
3. Check the chord on every platform. `Ctrl+Shift+S` collides with "save screenshot" in some mpv configs and with terminal shortcuts in others; decide whether to add a second binding.

## Decision for later: saved moments

Saving timestamps locally (a list of bookmarks per title) would need new storage, UI, and a vocabulary decision: "bookmark" is currently the watchlist alias (`commands.ts`), and `.docs/adr/0001-personal-media-vocabulary.md` locks product nouns. Do not start this without an ADR naming the new noun. Share-a-moment covers the viral use; saved moments are a personal-library feature and should be judged on their own.
