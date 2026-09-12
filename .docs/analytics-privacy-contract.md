---
status: current
lastReviewed: "2026-08-17"
---

# Analytics Privacy Contract

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Read this before touching `apps/cli/src/services/analytics/`,
`apps/cli/src/domain/analytics/`, or `apps/analytics-ingest/`.

## Consent and identifier

- Usage analytics is **user-controlled and keystroke-gated**. A fresh install is
  `unset`. Setup **recommends** analytics and pre-selects it, with copy that says
  what is and is not sent — but only an explicit choice made on the consent
  screen may persist `enabled` or create an identifier.
- **No skip path may enable it.** `s` on the consent screen selects off, and `S`
  (accept all remaining defaults) stops on that screen rather than passing
  through it. `unchanged` — the state when the screen was never reached — must
  never collapse into `disabled` either, or rerunning setup and pressing
  accept-all would silently opt OUT someone who had opted in.
- This generalizes: **no skip, accept-all, or non-interactive path may perform an
  outward-facing action** — analytics, tracker OAuth, or presence IPC. A
  recommendation the user pressed a key on is consent; a default they never saw
  is not.
- Existing installs may see a one-time, non-blocking recommendation. It lists
  the payload and points to Settings, but does not grant consent, enable
  analytics, create an id, or send a request.
- An `enabled` value written before this opt-in contract is migrated to `unset`
  and its legacy id is cleared before startup; it is not treated as consent.
- `/settings` exposes the enable/disable option. Disabling clears `installId`.
  The id exists on disk only while analytics is enabled.
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
  to sending here instead. The wire carries `sha256(installId)` with version,
  OS, and architecture: over http that is readable on the path and one install
  is followable day to day, which is exactly what the digest exists to prevent.
  Same rule and same loopback exception as `normalizeRelayBaseUrl` in
  `packages/relay`.
- The default is a domain Kunai controls, never a hosting provider's own URL.
  This string is baked into immutable npm tarballs and compiled binaries, so it
  must outlive whatever serves it today: DNS can be re-pointed, a published
  binary cannot. Changing it strands every install already in the wild.

## Payload and ingest

The exact payload is `{ installId, version, os, arch, ts }`. A sixth key is
rejected. Titles, queries, providers, provider results, URLs, file paths, raw
UUIDs, and client IPs are never accepted or stored.

`installId` on the wire is `sha256` of the locally stored id, not the id
itself. The stored UUID never leaves the machine that generated it, so no
endpoint — ours, a self-hoster's, or one that has been compromised — ever holds
the raw value; the ingest still HMACs what arrives, making this a second,
client-owned layer rather than a replacement for it. The digest is
deterministic, or a daily-active count would degrade into a count of pings.

The ingest accepts a UUID **or** a 64-hex digest, and the order is a deployment
constraint, not a preference: it has to accept digests before any client sends
one, or every ping from an upgraded install answers 400 until the ingest
deploys. The UUID branch is not transitional scaffolding on a deletion
schedule — published binaries are immutable, so pre-0.3.0 installs keep sending
UUIDs for as long as they run.

Because the digest changes the hash input, installs that existed before 0.3.0
are counted again once on upgrade. That was accepted deliberately at a
`lifetimeInstalls` of 2; it is the cheapest this change will ever be.
`lifetimeMethod` was removed from the public schema; the public count is exact,
not an estimate.

`ping_day` stores an HMAC of the id plus version, OS, and architecture for 35
days. `install_lifetime` stores one permanent HMAC and first-seen date per
install; this durable pseudonymous record is the cost of exact lifetime counts.
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

From `2026-09-14T18:30:00.000Z` — 00:00 IST on 15 September 2026 — a day ends at
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

The published JSON is unchanged by all of this — same eight keys, same
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

`lifetimeInstalls` is retention-adjusted and therefore **not monotonic**. It may
fall when `lifetime_retired` absorbs pruned installs; a consumer charting it as
a cumulative line will show a dip that is correct data, not a bug.

The ingest body is capped at 512 bytes and a real install is limited by the
`(day, install_hash)` primary key. Before production enablement, configure a
Vercel firewall/request-rate rule that does not use application IP collection,
and database/platform budget alerts. Review their thresholds after a live smoke.

Any payload, retention, suppression, secret, or cost-control change must update
this contract and `docs/users/reliability-and-privacy.mdx` together.
