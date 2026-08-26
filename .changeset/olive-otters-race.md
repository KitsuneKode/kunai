---
"@kitsunekode/kunai": patch
---

Retire the dead Videasy seed mirror and cover every production provider in the live matrix.

### Fixes

- Remove `api.wingsdatabase.com` from the Videasy seed rotation. The name is
  NXDOMAIN on both Cloudflare and Google resolvers and the surviving apex does
  not serve `/seed`, so it could never win the seed race — it only spent a
  request slot and then occupied the five-minute host penalty box after every
  cold resolve, which read as a redundant pair while offering no redundancy.
  `api.speedracelight.com` remains the live host and is unaffected.

### Behavior

- The seed transport still races N hosts and now takes an injected host list, so
  a live mirror can be added back to `WINGS_API_BASES` without reintroducing a
  second constant. A preferred-host cache entry can no longer resurrect a host
  that is no longer configured.
- `bun run test:live:matrix` now covers all seven providers that
  `loadProductionProviderModules()` registers. It previously skipped `vidlink`
  and `anidb` — and `anidb` is the default anime lane the release signoff
  depends on, so an outage there would have reported a green matrix.
