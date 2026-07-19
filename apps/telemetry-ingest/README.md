# Kunai telemetry ingest

Minimal **user-owned** Vercel function that accepts Kunai's opt-in anonymous
usage ping.

## Privacy contract

- **POST only** to `/api/ping`
- Body must be exactly `{ installId, version, os, arch, ts }`
- Rate-limits per client IP in **process memory only** — IP addresses are never
  written to durable storage by this app
- Distinct counting: for the current UTC day the process may keep an in-memory
  **Set of install ids** (plus the derived distinct count). That Set is not a
  durable user database; it exists only so the day’s count does not double-count
  the same install id on the same warm instance. Across cold starts / instances
  the count can under-count; it never stores titles, queries, or watch history
- Titles, queries, provider results, URLs, and file paths are rejected (extra
  fields invalidate the payload)

### Platform logs

Vercel (or any reverse proxy) **access logs can correlate client IP with the
request body** unless you scrub or disable those logs. This app does not store
IPs itself, but operators who retain platform logs could reconstruct
IP↔installId pairs for the retention window of those logs.

### Abuse model

A hostile client can mint many install ids and **inflate the daily counter**.
They cannot expose another user’s watch history — titles, queries, providers,
URLs, and paths are never accepted. The worst case (with retained access logs)
is counter inflation and possible IP↔installId correlation, not content leak.

## Deploy

```sh
cd apps/telemetry-ingest
vercel deploy
```

Point the CLI with `KUNAI_TELEMETRY_URL=https://<your-deployment>/api/ping`, or
rely on the built-in default once this app is live at the documented host.

## Local test

```sh
bun run --cwd apps/telemetry-ingest test
```
