# @kunai/analytics-ingest

Minimal maintainer-owned Vercel function that receives Kunai's anonymous usage
ping and publishes aggregate counts. Storage is **Neon Postgres**.

The binding rules live in
[`.docs/analytics-privacy-contract.md`](../../.docs/analytics-privacy-contract.md).
This README is the operator's guide; the contract wins on any disagreement.

## What it does

- Accepts `POST /api/ping` with exactly five keys:
  `{ installId, version, os, arch, ts }`. A sixth key is rejected.
- Validates every dimension: strict semver `version`, closed allowlists for
  `os` and `arch`, so a hostile client cannot invent a bucket.
- Stores an **HMAC-SHA256 hash** of the install id — never the raw UUID.
- **Never reads a client IP.** There is no rate-limit key derived from one.
  Abuse protection is the 512-byte body cap, Vercel's platform DDoS
  mitigation, and the `(day, install_hash)` primary key, which caps a real
  install at one row per day no matter how often it pings.
- Publishes a daily aggregate JSON with dimension buckets under **5 installs**
  folded into `other`.

## Tables

| Table              | Holds                                                       | Retention |
| ------------------ | ----------------------------------------------------------- | --------- |
| `ping_day`         | `(day, HMAC(installId), version, os, arch)`; PK is the gate | 35 days   |
| `install_lifetime` | one hashed row per install + first-seen date                | permanent |
| `daily_rollup`     | counts only, no identity                                    | permanent |

`install_lifetime` is a durable pseudonymous record — the cost of an exact
lifetime count. The contract states this plainly; do not describe it as
equivalent to a probabilistic sketch.

## Endpoints

| Route                     | Auth                    | Purpose                                   |
| ------------------------- | ----------------------- | ----------------------------------------- |
| `POST /api/ping`          | none                    | Ingest. Returns `204` with no body.       |
| `GET /metrics/daily.json` | none                    | Public aggregates, k-anonymised.          |
| `GET /api/cron/snapshot`  | `CRON_SECRET`           | Rolls up yesterday, then prunes raw rows. |
| `GET /api/metrics/admin`  | `ANALYTICS_ADMIN_TOKEN` | Last 30 days, **unsuppressed**.           |

Cron runs at `5 0 * * *` (see `vercel.json`).

## Setup

1. Create a Neon project and copy the **pooled** connection string.
2. Set these environment variables in Vercel:

   | Variable                | Purpose                                     |
   | ----------------------- | ------------------------------------------- |
   | `DATABASE_URL`          | Neon pooled connection string               |
   | `ANALYTICS_HASH_SECRET` | Long random secret for the install-id HMAC  |
   | `CRON_SECRET`           | Bearer token the cron job presents          |
   | `ANALYTICS_ADMIN_TOKEN` | Bearer token for the admin metrics endpoint |

3. Apply the schema (idempotent, safe to re-run):

   ```sh
   DATABASE_URL="postgres://..." bun run --cwd apps/analytics-ingest migrate
   ```

4. Deploy. Point the CLI at it with `KUNAI_ANALYTICS_URL`, or ship the host as
   `DEFAULT_ANALYTICS_ENDPOINT` in
   `apps/cli/src/services/analytics/UsageAnalyticsService.ts`. The docs site
   reads `KUNAI_ANALYTICS_METRICS_URL` / `DEFAULT_ANALYTICS_METRICS_URL`.

**Fail closed:** `/api/ping` returns **503** when `DATABASE_URL` or
`ANALYTICS_HASH_SECRET` is missing. It never falls back to storing raw ids or
to an in-memory store — a missing hash secret must not silently degrade into
recording install UUIDs.

## Tests

```sh
bun run --cwd apps/analytics-ingest test
```

Runs offline against an in-memory store. `test/postgres-store.test.ts` is
skipped unless `DATABASE_URL` is set; point it only at a scratch database,
because it writes and prunes.
