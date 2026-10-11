---
"@kitsunekode/kunai": patch
---

Resolved streams whose HLS master host is definitively dead are dropped from
the source inventory instead of offered as playable rows. Only an explicit
HTTP answer (5xx/404/410) marks a host dead — timeouts, DNS failures, and TCP
resets keep the adaptive fallback because they say nothing about the host.

The check applies across every ladder-expanding adapter: miruro, rivestream,
vidlink, hianime, anidb, and allmanga.
