# Kunai — Tracker Sync (AniList, TMDB)

Canonical reference for watch-progress and list sync with third-party trackers.
Read this before changing anything under `apps/cli/src/services/sync/`.

## Current State

| Capability              | Location                                              | Status                 |
| ----------------------- | ----------------------------------------------------- | ---------------------- |
| Adapter contract        | `apps/cli/src/services/sync/SyncAdapter.ts`           | Implemented            |
| Shared types / outcomes | `apps/cli/src/services/sync/types.ts`                 | Implemented            |
| Tracker id resolution   | `apps/cli/src/services/sync/sync-identity.ts`         | Implemented            |
| OAuth loopback server   | `apps/cli/src/services/sync/oauth-loopback.ts`        | Implemented            |
| AniList adapter         | `apps/cli/src/services/sync/AniListAdapter.ts`        | Implemented            |
| TMDB adapter            | `apps/cli/src/services/sync/TmdbAdapter.ts`           | Implemented            |
| Orchestration + gating  | `apps/cli/src/services/sync/SyncService.ts`           | Implemented            |
| Durable outbox          | `packages/storage/src/repositories/sync-queue.ts`     | Implemented            |
| Credentials             | `apps/cli/src/services/persistence/SyncTokenStore.ts` | Implemented            |
| Auto-scrobble hook      | `apps/cli/src/app/playback/PlaybackPhase.ts`          | Implemented            |
| `/sync` workflow        | `apps/cli/src/app-shell/workflows/shell-workflows.ts` | Implemented            |
| Settings page           | `apps/cli/src/app-shell/settings/registry/sync.ts`    | Implemented            |
| AniList application id  | —                                                     | **Not yet registered** |
| Pull reconciliation     | `SyncService.pull()`                                  | Adapters only          |

## What Each Tracker Can Actually Do

This distinction drives the whole design. Presenting both trackers as
interchangeable "sync" is what previously made TMDB look broken.

| Capability       | AniList | TMDB                 |
| ---------------- | ------- | -------------------- |
| Episode progress | Yes     | **No — no such API** |
| Watchlist        | Yes     | Yes                  |
| Favourites       | Yes     | Yes                  |
| Read list back   | Yes     | Yes                  |
| Catalog          | Anime   | Movies and TV        |

TMDB v3 exposes exactly three writable account surfaces: watchlist membership,
favourite membership, and ratings. There is no endpoint that records "I watched
S02E04". `TmdbAdapter.pushProgress` therefore returns `skipped`, and the UI says
so. If real movie/TV scrobbling is wanted later, Trakt is the service that
supports it — that is a new adapter, not a change to this one.

## Identity Rules (non-negotiable)

`sync-identity.ts` is the only place tracker ids are derived. The rule: **an id
is valid for a tracker only when it came from that tracker's namespace.** There
is no numeric fallback.

- `anilistId` / `anilist:<n>` → AniList. A bare numeric id counts only for
  `kind === "anime"`, matching the anime lane convention.
- `tmdbId` / `tmdb:<n>` → TMDB. Never accepted for anime.
- A MAL id is **not** an AniList id, and a TMDB id is **not** an AniList id.
  These catalogs number independently, so coercing between them writes progress
  onto an unrelated title on a real user account. Cross them through the ARM
  crosswalk (`CatalogIdentityService`) instead.

Missing ids produce a `mapping` failure, which is diagnosable, rather than a
silent guess.

## Progress Semantics

`AniListAdapter.pushProgress` reads the remote entry before writing:

- **Progress never decreases.** `max(remote, watched)` — re-watching episode 3 of
  a show sitting at 12 never rewrites it to 3.
- **Completion is derived from the episode count**, not the media kind. A series
  whose final episode is watched is marked `COMPLETED`.
- **A partially watched episode counts the previous one**, so status leaves
  `PLANNING` without over-reporting.
- **Completed entries are left alone.** AniList models a rewatch by resetting
  progress to 0 with `REPEATING`, which destroys the completion record if the
  rewatch is abandoned. That trade belongs to the user, so automatic scrobbling
  never makes it. Explicit rewatch tracking is not implemented.
- **Multi-season numbering**: for `season > 1`, the absolute episode number is
  preferred when known, because AniList entries are per-cour.

## Delivery: the Durable Outbox

Scrobbles fire at episode boundaries — exactly when a lid closes or a VPN flaps.
Every push is written to `sync_queue` (data DB, migration `027_data_sync_queue`)
before it is attempted, so a failure is retried rather than lost.

- Dedupe key is `adapter + title + season + episode`; re-watching replaces the
  queued row instead of stacking duplicates.
- Backoff: 1m → 5m → 30m → 2h → 12h → 24h, capped; `SYNC_QUEUE_MAX_ATTEMPTS`
  attempts before a row is considered dead.
- `skipped` outcomes are dropped immediately — a structural limitation must
  never be retried forever, or the health indicator sticks amber.
- Rows for a disconnected adapter are dropped on the next drain.
- Drains are **serialized, not dropped**. A caller always observes a real pass,
  so "Sync now" can never report "up to date" for work it did not look at.
- The queue is drained on launch, after each scrobble, and from `/sync`.

## Config Gating

`config.sync.{anilist,tmdb}.{enabled,trackWatched,syncList}` is read by
`SyncService` on every push. Connecting a tracker from `/sync` turns its flags
on; disconnecting turns them off and clears its queued work.

- `enabled` — may Kunai write to this account at all
- `trackWatched` — scrobble episode progress automatically
- `syncList` — mirror watchlist/favourites, and allow pulls

## Auth

**AniList** uses the OAuth **implicit grant** (`response_type=token`). The
authorization-code grant requires a `client_secret`, which a publicly
distributed CLI cannot hold secretly — this is why the previous code could never
complete a token exchange. The token arrives in the URL _fragment_, which
browsers never send to a server, so the loopback callback serves a small bridge
page that posts `location.hash` back to Kunai. Tokens last about a year and
`expiresAt` is stored so expiry is detected locally.

> **Shipping requirement:** `KUNAI_ANILIST_CLIENT_ID` in `AniListAdapter.ts` is
> intentionally empty. A maintainer must register the application at
> <https://anilist.co/settings/developer> with an `http://localhost` redirect URI
> and paste the real client id into `KUNAI_ANILIST_CLIENT_ID`. Do not invent a
> number — an arbitrary id belongs to somebody else's application. Until then
> `connect()` fails with an actionable message, and users can set the
> `KUNAI_ANILIST_CLIENT_ID` env var to their own app.

**TMDB** uses the v3 request-token flow with a loopback `redirect_to`. The API
key is public and already compiled in (`KUNAI_TMDB_API_KEY` overrides it).

Credentials live in `~/.config/kunai/sync-tokens.json`, written 0600 via
`writeAtomicSecretJson` — never in `config.json`.

Adapters must never write to stdout or read stdin: the Ink shell owns the
terminal. Instructions go through the `onPrompt` callback.

## Failure Classification

`SyncErrorKind` decides retry behavior, so classify carefully:

| Kind      | Meaning                          | Retried |
| --------- | -------------------------------- | ------- |
| `network` | transport failure                | Yes     |
| `remote`  | tracker 5xx / rate limit         | Yes     |
| `auth`    | token expired or rejected        | Yes\*   |
| `mapping` | no confident id for this tracker | Yes\*   |
| —         | `skipped` (structural)           | No      |

\* Retried by the queue, but the adapter moves to `needs-reauth` on `auth`,
which surfaces as an error in the header and on the settings page. A transient
network failure never clears credentials — an offline launch must not look like
a logout.

## Not Implemented

- Pull reconciliation into Kunai lists. `SyncService.pull()` returns what each
  adapter reports; nothing writes those results into `ListService` yet.
- Rewatch tracking (see Progress Semantics).
- Ratings/score push, though `SyncCapabilities.rating` is declared.
- MAL, Trakt, Simkl adapters.
