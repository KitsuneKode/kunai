# Kunai telemetry ingest

Minimal **user-owned** Vercel function that accepts Kunai's opt-in anonymous
usage ping.

## Privacy contract

- **POST only** to `/api/ping`
- Body must be exactly `{ installId, version, os, arch, ts }`
- Rate-limits per client IP in **process memory only** — IP addresses are never
  written to durable storage
- Keeps only an aggregate **daily distinct install-id count**
- Titles, queries, provider results, URLs, and file paths are rejected (extra
  fields invalidate the payload)

### Abuse model

A hostile client can mint many install ids and **inflate the daily counter**.
They cannot expose another user's identity or viewing history — that data is
never accepted or retained.

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
