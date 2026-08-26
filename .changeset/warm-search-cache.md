---
"@kitsunekode/kunai": minor
---

Warm the top anime result's episode cache during search.

### Features

- After an anime search, Kunai warms the persistent episode cache for the single
  top anime result in the background, so the Cloudflare-gated catalog fetch
  (~6s) is already paid by the time you pick it. It is fire-and-forget — it never
  blocks, delays, or fails the search — deduped so a title is warmed once per
  session, and limited to one gated call per search to stay gentle on the WAF.
