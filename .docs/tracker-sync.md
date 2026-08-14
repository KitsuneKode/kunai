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

## Which tracker gets a list change

`resolveMirrorTargets` in `apps/cli/src/services/sync/mirror-targets.ts` is the
one place that answers this, and every list surface routes through it.

- **AniList wins when it resolves.** Anime reaches the shell as a TMDB row typed
  `series` — the anime-ness rides on a separate flag — so both resolvers can
  succeed for the same show. Writing to both would file one title in two
  accounts from a single keypress, and AniList is where anime progress,
  favourites and lists actually live.
- **TMDB covers what AniList does not catalogue**: films and non-anime series.
- **Lane is never a precondition for AniList.** An `anilist:` title id or an
  explicit `externalIds.anilistId` is unambiguous on its own, and what it
  resolves to is anime by definition.
- **Enrichment is a fallback, not a step.** A row that already carries the right
  id resolves with no cache read and no network. Only a title that would
  otherwise mirror nowhere pays for `CatalogIdentityService.enrich`, which
  degrades to "no ids" rather than throwing.
- **Zero targets is a reportable outcome.** "Saved locally, addressable by no
  tracker" is recorded to diagnostics and said in the surface's own message —
  it is the one result the user cannot infer from the list itself.

Callers pass resolved identities to `enqueueListMembership` /
`enqueueFavoriteMembership`. Those methods deliberately do **not** accept a
title: resolution is async and belongs to whoever owns the keypress.

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

**AniList** needs no configuration. Kunai ships an application id and the
loopback callback registered against it, so connecting is one approval in a
browser.

The flow is the **implicit grant**: `authorize?client_id=…&response_type=token`
and nothing else. That exact shape matters — adding `redirect_uri` or `state`
makes AniList answer `unsupported_grant_type`. The token comes back in the
redirect fragment, so there is no token endpoint to authenticate against and
Kunai ships no client secret. A client id is not a secret; it travels in every
authorization URL the user's browser visits.

Because the fragment is never sent to a server, the callback serves a bridge
page that reads `location.hash` and hands it back over same-origin loopback,
then rewrites the address bar so the token never enters browser history.

Two consequences of AniList registering exactly one redirect URL per
application, and the implicit grant ignoring any `redirect_uri` sent with the
request:

- The loopback port is fixed. A busy port is a dead end, reported as one —
  another port cannot match the registration.
- There is no `state` nonce to compare, since sending one breaks the request.
  The listener is single-use, bound for one attempt, and torn down immediately;
  a _wrong_ state is still refused, an absent one is expected.

The refresh token AniList would return on the code grant does not exist here.
Access tokens last a year.

`KUNAI_ANILIST_CLIENT_ID` overrides the shipped application. Doing so means a
different registration, so `KUNAI_ANILIST_REDIRECT_URI` becomes required rather
than inheriting the shipped one — which the other application would reject with
nothing useful to say about why. The redirect URI must be `http`, a loopback
host, an explicit port, and exactly `/callback`.

**TMDB** uses a public application key shipped with Kunai, owned by
`services/catalog/tmdb-proxy.ts`. `KUNAI_TMDB_API_KEY` overrides it; an
explicitly empty or placeholder override fails closed rather than silently
falling back.

Connecting mints a request token, opens the approval page, then **polls**
`authentication/session/new` until TMDB stops answering `401`. There is no
callback for a device-style flow, so session creation is itself the approval
check — and the poll is what makes it work inside the Ink shell, which owns
stdin in raw mode and would never deliver a keypress to a listener.

Two things about the v3 write path are easy to get wrong, and both were:

- **Auth is query-string, not headers.** `api_key` and `session_id` are query
  parameters. Bearer auth belongs to v4 and takes a read access token, not the
  32-character v3 key; there is no `X-Session-Id` header in the API at all.
  Credentials in URLs are the trade-off, so `api_key` and `session_id` are both
  in `SENSITIVE_QUERY_KEYS` and the adapter logs no URLs.
- **`/account/{account_id}/…` takes the numeric id.** The username is stored
  separately, for display only. A stored identity from before that split is
  repaired by `refreshIdentity()` on the next start rather than forcing the user
  to reconnect.

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

## Settings and pause

Settings reads one typed projection — `ctx.sync` — carrying the adapters, the
resolved `SyncAuthAvailability`, and a `SyncStatus` snapshot. It never reads
`process.env`, never imports a credential literal, and never inspects adapter
internals; a unit test pins that. Controls are gated on declared capabilities,
so "Send episode progress" is absent for TMDB rather than present and inert.

There is no "Send watchlist and favourites" row yet. The adapters implement
those writes and the drain honours `syncList`, but nothing in Kunai _produces_
them: `enqueueListMembership` and `enqueueFavoriteMembership` have no callers
and `ListsRepository` is not wired into the app. The row appears when a producer
does. `trackWatched` and `syncList` are both checked in `deliver()` beside
`enabled`, against the same freshly-read config; a write the settings forbid is
released and stays queued rather than being dropped.

**Pause** (`sync.pausedUntil`) is global and separate from `sync.<tracker>.enabled`.
Enabled off means never; paused means not right now. Work keeps queueing while
paused and goes out on resume, so pausing never costs an episode. The drain
checks the pause before claiming, so a paused queue holds no leases. An
unparseable timestamp fails open rather than stopping sync with nothing able to
explain why.

The root status crumb shows `sync✓`, `sync⏸`, `sync⚠`, or `sync✗`. Disconnected
earns no crumb — it is the default for most users and would be permanent noise.

## Rate limiting

AniList publishes `X-RateLimit-Limit` / `X-RateLimit-Remaining` on every
response and answers `429` with `Retry-After` and `X-RateLimit-Reset`;
`TrackerRateLimiter` reads all of it. Below ten remaining it spreads what is
left across the rest of the window; at zero it blocks until reset.

Short waits are absorbed in-flight. Anything longer is handed back to the outbox
via `defer()`, which writes the server's own instant to `next_attempt_at` and
**rolls back the attempt this claim started** — a row must not inherit a longer
backoff for a queue-wide condition it did not cause. Within one drain, the first
`rate-limited` outcome defers every remaining row for that tracker without
asking again: the limit belongs to the connection, not to any one payload.

## GraphQL error fates

AniList reports application-level problems inside the envelope, often with a 200. They are classified by what can be done about them:

| Signal                                    | Fate                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| `validation` map, or status 400/404       | dead-letter — a redelivery cannot change the answer                          |
| status 401/403, or an auth-shaped message | needs-reauth                                                                 |
| status 429                                | rate-limited, using AniList's wait                                           |
| anything else                             | retry — a wrong retry costs one request, a wrong dead-letter loses the write |

Both membership writes read before they write, and the read is classified too.
An unreadable lookup refuses rather than guessing: removing from a watchlist
used to report _success_ when the lookup was rejected, and `ToggleFavourite` is
a flip rather than a set, so firing it blind turns a redelivery into a flip-flop.
