---
status: current
lastReviewed: "2026-11-25T14:00:00Z"
---

# Analytics Privacy Contract

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Read this before touching `apps/cli/src/services/analytics/`,
`apps/cli/src/domain/analytics/`, or `apps/analytics-ingest/`.

## Consent and identifier

- Usage analytics is **user-controlled and keystroke-gated**. A fresh install is
  `unset`. The setup consent screen is **neutral**: neither "Share anonymous
  usage" nor "Don't share" is pre-selected or marked recommended, and each needs
  its own keystroke. The cursor starts on no row and Enter does nothing until an
  arrow has chosen one. Only an explicit choice made on that screen may persist
  `enabled` or create an identifier.
- The screen's payload preview is `describePayload()` itself, passed in by the
  setup workflow, so the copy cannot drift from the wire.
- **No skip path may enable it.** `s` on the consent screen is its labelled
  "don't share" key, and `S` (accept all remaining defaults) stays on that
  screen and chooses nothing. `unchanged` — the state when the screen was never
  reached — must never collapse into `disabled` either, or rerunning setup and
  pressing accept-all would silently opt OUT someone who had opted in.
- This generalizes: **no skip, accept-all, or non-interactive path may perform an
  outward-facing action** — analytics, tracker OAuth, or presence IPC. A
  recommendation the user pressed a key on is consent; a default they never saw
  is not.
- Existing installs may see a one-time, non-blocking recommendation. It lists
  the payload and points to Settings, but does not grant consent, enable
  analytics, create an id, or send a request.
- An `enabled` value written before this opt-in contract is migrated to `unset`
  and its legacy id is cleared before startup; it is not treated as consent.
- `/settings` exposes the enable/disable option. Disabling clears `installId`,
  `analyticsCohort` and the local ping log. The id exists on disk only while
  analytics is enabled. A ping already in flight
  may finish, but its result must not restore an id cleared by disable, undo a
  rotation, or apply the old identity's cadence/retry bookkeeping. The completion
  compares both local and persisted consent and the pre-send stored identity
  under the same cross-process lock and save chain as settings writes. It updates
  cadence/retry fields only, never the identity. A rejected completion refreshes
  non-dirty local analytics fields from disk so a stale session stops sending.
- The send itself is gated on disk too. Immediately before a request,
  `maybePing` re-reads `config.json` (`readPersistedAnalyticsConsent`, no memory
  change; it uses the normal store load, so a corrupt file is quarantined as at
  startup and reads as the default `unset`) and sends only if the file still says `enabled` with the
  exact install id this process holds, and memory still agrees after the read.
  The file is read with the same rule startup uses (an `enabled` with no notice
  marker reads as `unset`). A sibling's disable or rotation since startup, an
  unsaved local enable, or a file that cannot be read or parsed sends nothing.
- Passive Settings saves preserve the current analytics preference and identity
  unless the user explicitly changes the consent option. Connecting presence
  applies only presence fields, so a stale pane cannot restore withdrawn consent
  or overwrite unrelated preferences.
- A missing or invalid persisted identity suppresses sends and payload previews.
  Only an explicit consent choice creates or repairs an identity; passive ping
  completion cannot silently mint one.
- No analytics request is made before consent, in a non-TTY session, or while
  `DO_NOT_TRACK` or `CI` is truthy (`1`, `true`, or `yes`).
- A default endpoint ships: `analytics.kunai.kitsunekode.in`. It is where a ping
  goes, never permission to send one — every gate above still applies, and an
  install that has not explicitly opted in sends nothing to it. The default
  exists because requiring a consenting user to find and paste a URL meant
  consent produced no data at all.
- `KUNAI_ANALYTICS_URL` and `analyticsEndpoint` override the default, so a
  self-hoster can point their installs at their own ingest. An empty
  `analyticsEndpoint` (the shipped default) means “use the built-in URL”, not
  “disable sending”. Disable in Settings, or with `DO_NOT_TRACK` / `CI` / a
  non-TTY session.
- **An override must be https.** `http://localhost`, `127.0.0.1`, and `[::1]`
  are the only cleartext exceptions, so `apps/analytics-ingest` can be developed
  against locally. Anything else — an `http://` host, a non-URL — is refused and
  **stops sending entirely**; it is never redirected to the built-in default,
  because someone who pointed their installs at their own ingest did not consent
  to sending here instead. The wire carries a monthly HMAC of the install id
  with cohort, day, version, OS, and architecture: over http that is readable on
  the path and one install is followable through a month, which is exactly what
  the HMAC exists to prevent.
  Same rule and same loopback exception as `normalizeRelayBaseUrl` in
  `packages/relay`.
- The default is a domain Kunai controls, never a hosting provider's own URL.
  This string is baked into immutable npm tarballs and compiled binaries, so it
  must outlive whatever serves it today: DNS can be re-pointed, a published
  binary cannot. Changing it strands every install already in the wild.

## Test and development boundaries

Test profiles must never become production install observations. Filesystem
isolation alone does not provide this: an explicit consent keystroke in a local
test TTY can create an id, and a fixed synthetic UUID still adds one new/lifetime
install when first accepted by an ingest.

- Every hosted workflow sets `DO_NOT_TRACK=1` at workflow scope, including
  installed-binary and shell checks. A regression verifies effective job and step
  overrides cannot turn it off. Turbo explicitly passes that variable through
  strict tasks, verified with a real task under `CI=0`. This supplements the test
  preload; it does not
  change explicit user consent in the shipped app.
- The CLI test preload forces `DO_NOT_TRACK=1`, including when the parent has
  `CI=0` or `DO_NOT_TRACK=0`. `storageRootEnv()` supplies the same override with
  the HOME/XDG/APPDATA isolation, and its in-process undo restores the previous
  environment. Installer fixtures, compiled profiles and agent launchers inherit
  it; the standalone native Docker smoke and manual sandbox launcher also force
  it. The existing consent gate refuses enable/id creation and suppresses sends
  even if an isolated fixture starts with analytics enabled.
- Agent launch options cannot override the profile's storage, credential or DNT
  values. Privacy assertion failures report identity presence without printing
  the raw id. An agent's seeded profile remains disposable; it is never copied
  back to a user's real profile.
- Consent and wire-contract fixtures may inject an unblocked environment only
  with isolated in-memory/temporary config and mocked delivery or an isolated
  local ingest. Synthetic ids belong only to those fixtures. A test must not
  opt out of suppression and then call production fetch.
- `bun run test:live:analytics` requires both `KUNAI_LIVE_ANALYTICS=1` and a
  dedicated `KUNAI_ANALYTICS_TEST_URL` of the form
  `http://127.0.0.1:3000/api/ping` or `http://[::1]:3000/api/ping`. An explicit
  port is required; credentials, queries, fragments, DNS hosts and remote URLs
  are refused before any fetch. The normal endpoint override and production
  default are never used. Both requests refuse redirects, and success requires
  an awaited `204` for the valid ping and `400` for the extra-field probe.

The loopback fixture must use a disposable datastore and must not proxy a
production ingest or connect to production storage. A loopback URL proves only
where the client connects; it cannot establish the server's database ownership.
This smoke proves local delivery/validation, not production DNS, deployment,
startup latency or production counts. No production rows are added or deleted
as part of testing.

An arbitrary installed binary cannot infer that a person is testing it. Manual
test installs outside these helpers must explicitly set `DO_NOT_TRACK=1` and
redirect every platform storage root before starting it, including setup and
Settings exercises. Normal user installs retain their explicit opt-in behavior.

## Payload and ingest

The exact payload (v2) is `{ id, cohort, day, version, os, arch }`. Any other
key is rejected. Titles, queries, providers, provider results, URLs, file
paths, raw UUIDs, and client IPs are never accepted or stored.

- `id` is hex `HMAC-SHA256(key = installId, message = "YYYY-MM")`, where the
  month is the month of the ping's own `day` label. The stored UUID never
  leaves the machine that generated it, so no endpoint — ours, a
  self-hoster's, or one that has been compromised — ever holds the raw value.
  The id is stable within a calendar month, so daily and month-aligned counts
  stay exact, and it rotates every month: without the key, one month's id says
  nothing about another's. A test fails if any month's id is derivable from the
  previous month's by the obvious constructions. The ingest still HMACs what
  arrives, so this is a second, client-owned layer, not a replacement for it.
- `cohort` is the `YYYY-MM` analytics was enabled in, stored locally as
  `analyticsCohort`. It is written only where `installId` is minted: the
  explicit enable keystroke (`consentPatch("enabled")`) and the explicit
  rotate action, which starts a new cohort. Disable and the env block clear it,
  and load drops one that has no enabled identity beside it. Affirming an
  enable that already holds keeps it. **The one exception** is an install that
  opted in before cohorts existed: it has a valid id and no cohort, so its
  first v2 ping carries the month of that ping and the completion stores it
  (only if the file still has none, under the same lock as cadence). That is
  the upgrade seam below, not a new consent.
- `day` is the client's analytics day label, computed by
  `apps/cli/src/domain/analytics/analytics-day.ts`, a deliberate copy of the
  ingest's `analytics-day.ts` (the CLI cannot import the ingest app). A parity
  test compares the two across the cutover and month boundaries. There is no
  `ts`: the ingest checks `day` against its own clock instead.
- `os` is `android` when `isAndroidRuntime()` is true (Termux reports `linux`),
  otherwise `process.platform`: `linux`, `darwin`, `win32`, or `android`.

The ingest accepts v1 (`{ installId, version, os, arch, ts }`, with a UUID or a
64-hex digest) **and** v2, and the order is a deployment constraint, not a
preference: it has to accept v2 before any client sends it, or every ping from
an upgraded install answers 400 and backs off. Published binaries are
immutable, so v1 is accepted for as long as those builds run.

Because the id changes the hash input, installs that existed before v2 are
counted again once, in their upgrade month. That is the same dated seam 0.3.0
accepted when it moved from the UUID to a digest at a `lifetimeInstalls` of 2,
and it is cheap at today's numbers. `lifetimeMethod` was removed from the
public schema; the count published is the real stored figure, not a sketch —
what it means is stated in the series section, where retirement makes it
cumulative observations rather than unique installs.

### The local ping log

`kunai analytics log` prints the last 50 pings exactly as sent, from
`analytics-pings.json` in the OS data dir. Each entry is the request body
byte for byte, with the local send time and endpoint. The file is owner-only
(`0o600`) and exists only while analytics is enabled:

- The send path appends the body after every gate has passed and before the
  request leaves. A ping the log cannot record is not sent, so the log is
  never a sample.
- Disable, the env block, and rotation remove it. Startup removes one left
  behind while analytics is not enabled (a sibling's disable, a hand edit),
  in the background so it costs first paint nothing. An append that races a
  disable removes its own entry again.
- `kunai analytics preview` prints `describePayload()` for the persisted
  consent. Both commands are read-only with respect to consent: they send
  nothing, mint no id or cohort, and cannot enable analytics.

### Release markers

Every release carries `install.marker` and `update.marker`, fixed version-free
bytes written by `scripts/packaging/release-markers.ts`, uploaded by the
release workflow and required by `verify-github-release-assets.ts`.
`install.sh` and `install.ps1` fetch `install.marker` once after a successful
binary install; the native updater fetches `update.marker` once after a
verified activation (`kunai upgrade` and the background auto-updater, not a
fresh `kunai install`). **GitHub counts the download; Kunai receives
nothing.** The request goes to the release host that just served the binary
and carries nothing that download did not.

Best effort only: one attempt, a 3 second timeout, no retry, every failure
ignored, nothing printed. The updater starts the request after activation and
never awaits it; `kunai upgrade` waits out at most that timeout after printing
success, because its `process.exit` would otherwise cut the request off. It
needs no consent because nothing reaches Kunai, but `DO_NOT_TRACK`, `CI` (both
`1`, `true`, `yes`) and `KUNAI_NO_MARKER` each skip it.

`ping_day` stores an HMAC of the id plus version, OS, and architecture for 35
days. `install_lifetime` stores one HMAC row per install with first-seen and
last-seen dates until long silence retires it into `lifetime_retired`; that
durable pseudonymous record is the cost of any durable lifetime figure at all.
The two writes occur in one SQL statement. `daily_rollup` holds aggregate counts
only and is permanent. The ingest never reads a client IP.

`ANALYTICS_HASH_SECRET` is an operationally stable secret: do not rotate it in
place, because that would count existing installs again. A rotation requires a
planned migration/versioned hash column, a documented cutover window, and a
reset/reconciliation decision before deployment.

## Public metrics and operations

Buckets below five installs are folded into `other`. This is per-dimension
small-cell suppression, not a claim of joint k-anonymity across the separately
published version, OS, and architecture tables. `daily_rollup.computed_at` is
the public `updatedAt`, so a stale value signals cron failure.

That signal is only readable if a failed run means the rollup failed. The rollup
and the two retention sweeps run as separate statements in separate
transactions, so a prune that throws leaves an already-committed rollup behind
it. The cron therefore reports them apart: a rollup failure answers `503` with
the same opaque `upstream_unavailable` every endpoint returns, while a retention
failure keeps the `200` the committed rollup earned and names the skipped sweep
in the operator-only `deferred` array. Both write the failing stage to the
function log, with any connection string reduced to its scheme. So
`computed_at` stays the rollup signal and `deferred` is the retention one;
neither masks the other, and retention that could not run today is retried on
the next run rather than being lost.

### Where a day begins

From `2026-09-14T18:30:00.000Z` (00:00 IST on 15 September 2026) a day ends at
midnight IST. Before that instant it ends at midnight UTC. `analytics-day.ts` is
the only place that turns an instant into a label, and a test fails if a second
one appears, because ingest and the cron disagreeing means the cron rolls up a
day that holds no rows.

The two grids are 5.5 hours apart, so joining them costs exactly one short day:
**`2026-09-14` spans 00:00 to 18:30 UTC, 18.5 hours rather than 24**, and its
active count reads low. That is correct data, not a fault to be patched.

Earlier days keep their UTC labels and are **not** rebuilt. They cannot be: the
`(day, install_hash)` key kept only the first ping of each install per UTC day,
so a ping that fell on the far side of an IST midnight was discarded at write
time and was never available to re-bucket. Rollups older than the raw window
carry no per-ping time at all. A rebuild would write a systematic undercount
into the permanent record, which is worse than a documented seam.

Retention cutoffs are computed from the same labels they compare against, so
around the seam a row may be held at most one extra day. That is the safe
direction and costs storage only.

The published JSON is unchanged by all of this: same eight keys, same
`schemaVersion: 2`, same `YYYY-MM-DD` shape for `day`. The wire cannot announce
a change of meaning, which is why it is stated here and in
`docs/users/reliability-and-privacy.mdx`.

### The day-by-day series

`/metrics/series.json` publishes the same aggregates over a window (90 days by
default, 180 maximum, `?days=` clamped). It reads `daily_rollup`, which
retention never prunes, so it collects nothing new and changes no payload.

**Suppression is applied across the whole window, not per day.** A bucket that
falls below the floor on any day in the window is folded into `other` on every
day of it. Suppressing per day would let a bucket near the floor blink in and
out, and the blink is itself a signal about a small population — the snapshot
discloses "under five" once, a per-day series would disclose it at every
boundary crossing. A day where a bucket is simply absent does not disqualify it:
a version that did not exist yet is not a small cell, and treating absence as
zero would hide every new release.

The elimination guard runs per day on the surviving buckets, exactly as it does
for the snapshot, so a closed dimension is never recoverable by subtraction.

Series points additionally carry `newInstalls`: installs whose `first_seen`
equals the day. It is exact for every day the endpoints can still publish — a
first-seen row survives pruning until its own day is past the retention window,
far beyond the 180-day series maximum. The semantic caveat is deliberate: an
install returning after retirement is indistinguishable from a first-ever
install and counts as new on the day it returns. `daily.json` does not gain the
key — its strict key contract is load-bearing, and the field is per-day data.

`lifetimeInstalls` is retention-adjusted and therefore **not monotonic**. It may
fall when `lifetime_retired` absorbs pruned installs; a consumer charting it as
a cumulative line will show a dip that is correct data, not a bug. The same seam
caps its precision upward: an install that pings again after its row was retired
writes a fresh `install_lifetime` row while the old one still counts inside
`lifetime_retired`, so it is counted twice. Read the figure as installs ever
observed, deduplicated only within the retained window — not as a unique-install
total.

The ingest body is capped at 512 bytes and a real install is limited by the
`(day, install_hash)` primary key. Before production enablement, configure a
Vercel firewall/request-rate rule that does not use application IP collection,
and database/platform budget alerts. Review their thresholds after a live smoke.

Any payload, retention, suppression, secret, or cost-control change must update
this contract and `docs/users/reliability-and-privacy.mdx` together.

Passive settings persistence omits analytics preference, install identity and ping bookkeeping from its dirty patch. Copying an instance’s local values is insufficient: the locked config merge must retain consent withdrawn by a sibling instance.

Settings writes and action refreshes share one queue. Draft diffs retain only
the user's edited fields; refreshes rebase onto pending edits. Failed
withdrawals remain retryable on a later edit or close. Per-field revisions
distinguish a later explicit choice from an equal-valued write already in
flight, so enable → disable → enable cannot discard the final keystroke.
