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
- The endpoint is empty by default. Sending requires an explicitly configured,
  verified `KUNAI_ANALYTICS_URL` or `analyticsEndpoint`.

## Payload and ingest

The exact payload is `{ installId, version, os, arch, ts }`. A sixth key is
rejected. Titles, queries, providers, provider results, URLs, file paths, raw
UUIDs, and client IPs are never accepted or stored.
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
