---
status: current
lastReviewed: "2026-08-17"
---

# Analytics Privacy Contract

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Read this before touching `apps/cli/src/services/analytics/`,
`apps/cli/src/domain/analytics/`, or `apps/analytics-ingest/`.

## Consent and identifier

- Usage analytics is **explicit opt-in**. A fresh install is `unset`; setup
  defaults to off and only an explicit enable may persist `enabled` or create an
  identifier.
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
  self-hoster can point their installs at their own ingest, and setting either
  to an empty value disables sending entirely.
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

The ingest body is capped at 512 bytes and a real install is limited by the
`(day, install_hash)` primary key. Before production enablement, configure a
Vercel firewall/request-rate rule that does not use application IP collection,
and database/platform budget alerts. Review their thresholds after a live smoke.

Any payload, retention, suppression, secret, or cost-control change must update
this contract and `docs/users/reliability-and-privacy.mdx` together.
