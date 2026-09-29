---
"@kitsunekode/kunai": patch
---

Videasy no longer attests `streamReachabilityVerified` from its resolve-gate
probe.

Issue #361 showed the probe's 200 does not survive to the player on this
provider's signed CDN URLs — the next identical request, mpv included, gets 403. Shipping `verified: true` made downstream health checks trust the false
green for five minutes and replayed the dead URL from cache instead of failing
over. The probe still runs as a negative gate (definitive failures still move
to the next flavor), but a green probe now ships the result unattested so
resolve-gate and cache-revalidate re-probe rather than trust it.
