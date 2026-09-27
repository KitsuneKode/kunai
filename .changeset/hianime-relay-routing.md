---
"@kitsunekode/kunai": patch
---

Fix two holes in hianime's relay routing.

- Relayed responses now carry an `X-Kunai-Relayed` marker, and the hianime
  client treats a marked response as final. Previously a relayed 403 or
  Cloudflare challenge fell through to a direct upstream request — silently
  bypassing the relay a geo-gated user deployed, and re-fetching definitive
  statuses for nothing. Unmarked responses (relay off, authorized direct
  fallback) still fall through to local curl/impersonate.
- HiAnime is added to the per-provider relay settings list. It declared
  `relayProfile` but was omitted, leaving it permanently relay-routed with no
  way to disable it and making the "all relay-capable" summary wrong. A
  contract test now pins the list against the production roster ×
  `relayProfile`.
