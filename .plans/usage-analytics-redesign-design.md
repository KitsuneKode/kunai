# Usage Analytics Design

Status: implemented pending verified deployment

Kunai usage analytics is optional. A fresh install stays `unset`; setup presents
an explicit **Turn on analytics** choice with **Keep analytics off** selected by
default. The one-time notice for an existing install is only a recommendation:
it names the five fields and points to Settings, but neither enables analytics
nor creates an install identifier.

A legacy `enabled` setting without the new notice marker is pre-opt-in state:
load migrates it to `unset` and clears the old identifier before the notice.

Only `UsageAnalyticsService.setConsent("enabled")` enables collection and mints
the local random id. Disabling clears it. `DO_NOT_TRACK` and `CI` hard-block
enabling and sends; non-interactive sessions remain silent. An empty endpoint is
the production default, so even an opted-in client fails closed until an operator
configures `KUNAI_ANALYTICS_URL` or `analyticsEndpoint` after deployment review.

The ingest accepts exactly `{ installId, version, os, arch, ts }`, HMACs the id,
and stores one row per install per UTC day. `ping_day` and `install_lifetime`
write in one data-modifying SQL statement. Raw rows expire after 35 days;
rollups and the exact-lifetime HMAC record remain subject to the privacy contract.

Public dimension buckets smaller than five are folded into `other`. This is
small-cell suppression, not a claim that the separately published dimensions
provide joint k-anonymity. `daily_rollup.computed_at`, never request time,
drives public `updatedAt` so a stale cron is observable.

Deployment requires a stable `ANALYTICS_HASH_SECRET`, Neon migration, Vercel
secrets, a bounded platform firewall rule, cost alerts, and a live smoke before
an endpoint is configured for users.
