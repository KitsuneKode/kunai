# Kunai telemetry ingest

Minimal **user-owned** Vercel function that accepts Kunai's opt-in anonymous
usage ping and publishes a tiny public aggregate snapshot for the docs site.

## Privacy contract

- **POST only** to `/api/ping` (no CORS)
- Body must be exactly `{ installId, version, os, arch, ts }` (max 512 bytes)
- Client `ts` must be within ±24h of server time
- Rate-limits per **HMAC-hashed** IP key (ephemeral Redis TTL)
- Counts at most **once per HMAC(installId) per UTC day**
- Redis stores **hashed** install ids only (daily SET + lifetime HyperLogLog)
- Response is **204** with empty body (no count leak)
- Titles, queries, provider results, URLs, and file paths are rejected

### Durable aggregates

| Key purpose       | Redis shape                      | Notes                               |
| ----------------- | -------------------------------- | ----------------------------------- |
| Daily distinct    | `SET` of install hashes, 48h TTL | Exact for that day                  |
| Lifetime estimate | HyperLogLog of install hashes    | Approximate (~±1%), non-enumerable  |
| Day count cache   | integer string, 400d TTL         | For snapshots                       |
| Public snapshot   | JSON string                      | Yesterday actives + lifetime approx |

### Platform logs

Vercel access logs **can correlate client IP with the request body** unless you
scrub or disable those logs. This app never writes IPs as durable identity, but
operators who retain platform logs could reconstruct IP↔installId pairs for the
log retention window.

### Abuse model

A hostile client can mint many install ids and **inflate counters** (subject to
rate limits). They cannot expose another user’s watch history. Cron-protected
snapshot writes require `CRON_SECRET`.

## Public metrics

- Cron (`0 5 * * *` UTC via Vercel): `GET|POST /api/cron/snapshot` with
  `Authorization: Bearer $CRON_SECRET`
- Public read: `GET /metrics/daily.json` → aggregates only

Example:

```json
{
  "schemaVersion": 1,
  "day": "2026-07-19",
  "activeInstalls": 1284,
  "lifetimeInstallsApprox": 15200,
  "lifetimeMethod": "hyperloglog",
  "updatedAt": "2026-07-20T00:05:00.000Z"
}
```

## Deploy checklist

1. Create an Upstash Redis database (REST URL + token).
2. Create a Vercel project from `apps/telemetry-ingest` (or link this folder).
3. Set environment variables (Production + Preview as needed):

   | Variable                   | Purpose                                                   |
   | -------------------------- | --------------------------------------------------------- |
   | `UPSTASH_REDIS_REST_URL`   | Upstash REST endpoint                                     |
   | `UPSTASH_REDIS_REST_TOKEN` | Upstash REST token                                        |
   | `TELEMETRY_HASH_SECRET`    | Long random secret for HMAC (install + IP keys)           |
   | `CRON_SECRET`              | Bearer token for cron snapshot (Vercel Cron injects this) |

4. Deploy: `cd apps/telemetry-ingest && vercel deploy --prod`
5. Confirm:
   - `POST /api/ping` without secrets → **503** `misconfigured` (before env set)
   - After env: valid ping → **204**
   - Cron without bearer → **401**
   - Trigger cron once, then `GET /metrics/daily.json` returns schema v1 JSON
6. Point the CLI default (already `https://kunai-telemetry.vercel.app/api/ping`)
   or override with `KUNAI_TELEMETRY_URL`.
7. Docs: set `KUNAI_TELEMETRY_METRICS_URL=https://<host>/metrics/daily.json`
   (defaults to the same host’s `/metrics/daily.json`).
8. Optional: disable request body logging in the Vercel project if available.

**Fail closed:** `/api/ping` returns **503** when Redis URL/token or
`TELEMETRY_HASH_SECRET` is missing. It never falls back to silent in-memory
counting in production.

## Local test

```sh
bun run --cwd apps/telemetry-ingest test
bun run --cwd apps/telemetry-ingest typecheck
```

Redis contract tests are opt-in (require live Upstash env); default CI stays offline.
