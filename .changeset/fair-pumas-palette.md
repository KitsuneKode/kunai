---
"@kitsunekode/kunai": patch
---

Offer the queue and sync commands the shell already advertised.

### Fixes

- `/playlist-add` and `/queue-season` were implemented and mentioned in the
  details panel and empty Up Next hint, but neither palette offered them, so
  typing the command did nothing. They now appear during playback and
  post-play, where `currentTitle` is the playing title. Browse still uses `q`
  on the highlighted row — wiring the palette there would queue a stale title.
- Setup told you to run `/sync-connect-anilist` after a failed tracker link.
  That nested command is intentionally hidden under `/sync`, so the instruction
  was a dead end. The note now points at Settings → Sync, and `/sync` itself is
  on the overlay palette.
