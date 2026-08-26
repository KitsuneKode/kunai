---
"@kitsunekode/kunai": minor
---

Persist expensive provider intermediate data across restarts.

### Features

- Add a general `ProviderCachePort` (namespace + TTL) to the provider runtime
  context, backed by a SQLite `provider_cache` table, so a provider's expensive
  but stable intermediate data survives a restart instead of dying with the
  process.
- Miruro's episode catalog now reads memory → persistent → network, so the cold
  Cloudflare-gated pipe call (~6–13s) is paid once per catalog per TTL rather
  than once per session.

### Behavior

- The persist TTL is derived from the catalog's own air dates: a finished show
  persists for 12h, while an airing show persists until its approximate next air
  date (clamped to 2h–1 week), so a newly-aired episode is never hidden behind a
  stale cache.
- Only a non-empty catalog is persisted; a failed or empty body is never cached.
  The cache degrades to a no-op on any store error — a broken cache slows a
  resolve, never fails it. Stream/source URLs stay in-memory and are never
  persisted.
