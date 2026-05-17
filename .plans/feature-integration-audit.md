# Feature Integration Audit

Status: active audit, updated during the docs/history reconciliation sweep.

## What Is Now Wired

- History reconciliation is used by result enrichment. Completed local history plus
  cached next-release data can show `new SxxExx` instead of a stale `watched`
  badge. The lookup is cache-only and only runs for titles with completed local
  history, so browse/search does not create extra provider calls.
- `/docs` is a first-class command in root, playback, and post-playback command
  contexts. It opens `KUNAI_DOCS_URL` when set, otherwise the repository docs
  path.
- The docs website is a separate `apps/docs` workspace using Next.js, Fumadocs,
  MDX, and Tailwind CSS. User/developer source docs live in repository-level
  `docs/` and are ordered through `meta.json`.
- Root `build` is filtered to the CLI package. `build:docs` is explicit, and CI
  runs it as a separate docs gate. Release/package checks remain CLI-focused.

## Important Partial Or Underhooked Features

### Continue Watching Shelves

The domain pieces now exist: history reconciliation, cached schedule peeks,
offline progress projection, and result enrichment. The remaining gap is a
dedicated Continue Watching shelf that can combine:

- newest unfinished episode,
- newly released next episode,
- exact ready offline copy,
- upcoming next episode label,
- muted/followed notification preference.

Recommended next step: create a `ContinuationShelfService` that accepts history,
offline library projection, and cached schedule peeks. It should be local/cache
only by default and never provider-resolve visible rows until the user acts.

### Attention Refresh / Provider Availability Sync

`AttentionRefreshWorker` and budget policy are present, but provider-backed sync
is still experimental and disabled by default. This is correct. It should not be
promoted until manual smoke proves:

- no startup provider spam,
- visible/followed titles refresh first,
- failures are isolated per title,
- notifications are deduped and dismissible,
- playback is never blocked by background refresh.

### Notifications

The notification engine and action router are present, including queue recovery
and media notification actions. The remaining product gap is richer visible
placement: notification access from playback/post-playback exists, but new
episode notifications should be connected to the future continuation shelf and
follow/mute preferences.

### Playlist / Queue

Queue recovery, durable playlist import/export, and local progress projection
exist. Remaining hardening:

- expose watch percent consistently in playlist rows,
- keep imported playlists unresolved until explicit playback,
- add docs screenshots or VHS coverage for queue restore/import/export,
- keep crash recovery explicit instead of autoplaying recovered queues.

### Sync

AniList/TMDB sync settings and token storage exist. The sync surface should stay
opt-in and should explain whether it is pushing watched state, importing lists,
or only linking an account. Any future background sync should share the same
budget/diagnostic model as attention refresh.

### Docs Website

The docs shell is real, but content should continue to grow around common tasks:

- provider troubleshooting matrix,
- Discord Rich Presence setup and smoke guide,
- playlist sharing/import examples,
- download cleanup and storage retention examples,
- release checklist and live-smoke ladder.

## Guardrails To Preserve

- User data belongs in SQLite/data stores; cache facts stay cache-scoped and can
  expire.
- Visible browse/search enrichment is local/cache-only unless the user explicitly
  asks for refresh/play/download.
- Live provider and Discord smokes are opt-in release checks, not default CI.
- Docs build must not be required for publishing the CLI package.
- Imported or restored queues should never autoplay without an explicit user
  action.
