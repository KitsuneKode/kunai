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
  folded into `other`. This is per-dimension small-cell suppression, not a
  joint k-anonymity guarantee.

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

4. Deploy and run a live smoke. Then explicitly set `KUNAI_ANALYTICS_URL` and
   `KUNAI_ANALYTICS_METRICS_URL`; neither has a production default.

5. Treat `ANALYTICS_HASH_SECRET` as stable. Do not rotate it in place: plan a
   versioned migration and reconciliation first, or exact lifetime counts will
   double-count. Configure Vercel firewall/request-rate limits and platform /
   database budget alerts without adding application IP collection.

**Fail closed:** `/api/ping` returns **503** when `DATABASE_URL` or
`ANALYTICS_HASH_SECRET` is missing. It never falls back to storing raw ids or
to an in-memory store — a missing hash secret must not silently degrade into
recording install UUIDs.

## Tests

```sh
bun run --cwd apps/analytics-ingest test      # offline, in-memory store
bun run --cwd apps/analytics-ingest test:pg   # real Postgres, needs Docker
```

`test` runs everything that does not need a database. The two Postgres suites
skip, and a skip reads as a pass — which is why `test:pg` exists.

`test:pg` brings up the throwaway Postgres in `docker-compose.yml`, applies the
schema, runs `postgres-store` and `postgres-ingest-lifecycle` against it, and
tears it down. `test:pg -- --keep` leaves the containers up for iteration;
`db:down` cleans up afterwards.

The container credentials are `kunai:kunai`. That protects nothing — loopback
only, tmpfs-backed, destroyed when the run ends — and secret scanners flag it,
so the exception is recorded in `.gitguardian.yaml` rather than dismissed
silently. Generating a password per run instead looks tidier and is not:
Postgres reads `POSTGRES_PASSWORD` only when it initialises, so a container
Compose considers up to date rejects the new value on the second run. `trust`
auth makes the Neon proxy answer 502.

The store speaks Neon's **HTTP** protocol rather than the Postgres wire
protocol, so the compose file pairs `postgres` with a local proxy that
terminates the `/sql` endpoint. `src/neon-fetch-endpoint.ts` redirects the
driver there via `NEON_FETCH_ENDPOINT`; it is a no-op when that is unset, so
the deployed path is untouched.

These suites gate on **`ANALYTICS_TEST_DATABASE_URL`**, deliberately not
`DATABASE_URL` — they write and prune, and a stray `DATABASE_URL` must never
let a plain `bun run test` mutate a real database. Point it only at a scratch
database.

What the Postgres suites prove that the in-memory store cannot: the
data-modifying CTE's two independent conflict targets, `jsonb` round-tripping
through `by_*`, `date`/`timestamptz` casts surviving the HTTP driver, what
`prune` actually deletes, and that a rejected payload writes nothing.
