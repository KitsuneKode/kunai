# Tracker Sync

How Kunai delivers watch state to AniList and TMDB, and what it deliberately
does not claim to do.

**Status: experimental, and not reachable from the shell.** The `sync`,
`sync-connect-anilist`, `sync-connect-tmdb`, and `sync-disconnect` commands
exist in `command-registry.ts` but appear in no `COMMAND_CONTEXTS` entry, so no
palette offers them. That is deliberate: no live OAuth run against a real
account has been performed, so the flow is unproven end to end. Do not describe
tracker sync as release-ready until one has.

## Why the machinery exists

Two properties drive the whole design.

**A response can be lost after the remote applied it.** So every operation
records _desired state_ — "progress is 3", "this is on the watchlist" — never a
delta. Replaying desired state converges; replaying "toggle favourite" flips it
back. AniList only exposes `ToggleFavourite`, so the adapter reads membership
first and toggles only when the remote actually differs.

**Catalogue ids are bare integers.** `mal:1535`, `tmdb:1535` and `anilist:1535`
are three different shows. Identity is therefore explicit and tracker-native:
`SyncIdentity` carries `anilistId` or `tmdbId`, never a shared `id`, so a value
cannot reach the wrong tracker. Only complete positive decimals from a typed
external id or a matching namespace prefix resolve — bare numerics and foreign
namespaces do not.

## Capabilities

Declared by each adapter and read by callers; never restated.

|                      | AniList          | TMDB   |
| -------------------- | ---------------- | ------ |
| Episode progress     | yes              | **no** |
| Watchlist membership | yes (`PLANNING`) | yes    |
| Favourite membership | yes              | yes    |
| Pull remote lists    | no               | no     |
| Ratings              | no               | no     |

TMDB v3 has no episode-progress endpoint. A progress operation addressed to it
is dead-lettered before any request, because no retry can make it succeed.

AniList progress is **cour-relative**. Cour 2 episode 3 is absolute 27, and
sending 27 would jump the entry 24 episodes ahead — so an absolute-only number
resolves to nothing rather than being guessed at.

## Delivery

`SyncService` owns a SQLite outbox in the data DB (`sync_outbox`, data migration
`027`). Callers enqueue and return; nothing waits on a remote call.

- **Claim ownership.** Each row has a monotonic `generation` and, while in
  flight, a unique `claim_token`. Every terminal transition is guarded on
  `(id, generation, claim_token, state = 'claimed')`, so a completion arriving
  after the user changed their mind reports `superseded` instead of deleting the
  newer payload.
- **Lease recovery.** `claimDue()` reclaims expired claims and hands out the next
  batch in one transaction. A killed process's claim ages out and the row is
  redelivered with a new token and the same generation. `needs-reauth` and
  `dead-letter` rows are never reclaimed — they are waiting on a person.
- **One drain.** Exactly one drain is active; duplicate callers join it. An
  awaited `syncNow()` arriving mid-drain returns `already-running` rather than
  that batch's summary, because its rows were enqueued after the batch was
  claimed.
- **Live config.** The gate is re-read immediately before every external
  mutation, so disabling a tracker stops the very next write. Queued work is
  released untouched — not delivered, not discarded, and attempts unchanged.
- **Outcomes decide transitions.** `network`/`remote` retry with bounded
  exponential backoff; `mapping`/`invalid` dead-letter; cancellation releases the
  claim with attempts unchanged, so an orderly quit cannot walk a row toward
  dead-letter.

## Auth

Both trackers fail closed. Availability is resolved once in the container and
injected, so adapters and settings read one decision rather than each
interpreting the environment.

**AniList** requires `KUNAI_ANILIST_CLIENT_ID` and `KUNAI_ANILIST_REDIRECT_URI`.
There is no default for either. The redirect URI must be `http`, a loopback host,
an explicit port, and exactly `/callback` — for example
`http://127.0.0.1:43863/callback` — and must match what is registered on your
AniList application character for character. The loopback listener binds that
exact address; a taken port is an error rather than a reason to pick another,
since another port cannot match the registration. A 32-byte CSPRNG `state` is
generated per attempt and compared before the authorization code is read.

**TMDB** uses a public application key shipped with Kunai, owned by
`services/catalog/tmdb-proxy.ts`. `KUNAI_TMDB_API_KEY` overrides it; an
explicitly empty or placeholder override fails closed rather than silently
falling back.

## Privacy

Tokens live only in `configDir/sync-tokens.json`, written atomically with
owner-only permissions — never in SQLite, config, or logs. Token-store mutations
are serialized so concurrent patches cannot erase each other.

Dead-letter diagnostics are bounded (64-char code, 256-char detail) and never
contain payload JSON, since an unparseable row is the likeliest to hold
something that must not be recorded. The OAuth completion page shown in the
browser echoes no code or state. TMDB credentials travel in headers, not the
query string, so they stay out of proxy and crash logs.

## Recovery

- Reconnecting a tracker calls `resumeAfterReauth(trackerId)`, which returns rows
  parked on that tracker's credentials to pending without touching another
  tracker or any generation.
- Disabling sync preserves queued work rather than dropping it.
- Disposal settles sync before storage closes: scheduler drain → sync shutdown →
  token-store idle → diagnostics flush → data DB → cache DB. A drain still
  holding a claim would otherwise fault on a closed handle.

To remove Kunai's access entirely: disconnect in Kunai, then revoke the
application from your AniList account settings and delete the session from your
TMDB account settings. Deleting `configDir/sync-tokens.json` removes the local
credentials but does not revoke anything remotely.

## Not implemented

Pull/import of remote lists, pagination, and ratings. No adapter reader or
writer exists for any of them on this branch, and no capability declares them.
