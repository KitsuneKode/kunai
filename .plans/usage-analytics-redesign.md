# Usage Analytics Implementation Plan

Status: implemented and deployed; pending operator-control release signoff

1. Keep consent in `domain/analytics/consent-policy.ts` and writes in
   `services/analytics/usage-analytics-service.ts`.
2. Make setup and Settings explicit opt-in controls; keep the upgrader notice
   informational and record only that it was shown.
3. Preserve the five-field bounded wire format, strict validation, DNT/CI and
   non-TTY blocking, and id deletion on disable.
4. Use the Kunai-owned HTTPS endpoint default only with the fail-closed deployed
   ingest; keep self-hosted overrides explicit and HTTPS-only.
5. Aggregate through Postgres with atomic ping/lifetime storage, retained raw
   rows, persisted cron freshness, small-cell suppression, and documented
   secret/cost operations.
6. Keep tests at the CLI, ingest, docs, and persistence seams; stable-secret,
   firewall, retention, cron, cost, and live opt-in/disable validation remain
   release signoff gates.
