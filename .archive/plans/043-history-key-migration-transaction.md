# Plan 043: Transact legacy history-key migration

> **Drift check:** `git diff --stat 207ef937..HEAD -- packages/storage/src/repositories/history.ts packages/storage/test/history-youtube-key.test.ts packages/storage/src/repositories/history-title-aliases.ts`

**Goal:** Make legacy movie-to-video history-key migration all-or-nothing so a
failed canonical upsert cannot erase resume history.

## Status

- **Priority:** P1
- **Effort:** S
- **Risk:** LOW
- **Planned at:** `207ef937`, 2026-08-14

## Current defect

`HistoryRepository.upsertProgress` deletes a YouTube row under its legacy `movie`
key before inserting/updating the canonical `video` key. Those writes and the alias
update are not transactional.

## Tasks

- [ ] Extend `history-youtube-key.test.ts` with failure injection at canonical
      insert; assert the legacy row remains and no canonical row or alias commits.
- [ ] Add a success assertion for exactly one canonical row with accumulated fields
      and aliases preserved.
- [ ] Run the read, legacy delete, canonical UPSERT, and alias update inside one
      `this.db.transaction` callback invoked by `upsertProgress`.
- [ ] Do not add a schema migration; this is write-path atomicity only.

## Verification

```sh
bun run --cwd packages/storage test test/history-youtube-key.test.ts test/history-title-aliases.test.ts
bun run typecheck
bun run lint
bun run fmt
bun run test
```
