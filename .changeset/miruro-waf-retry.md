---
"@kitsunekode/kunai": patch
---

Miruro's intermittent Cloudflare challenge now earns one jittered refetch
(400–800ms) before Kunai pays for a curl-impersonate subprocess — the same
request that 403s during a challenged window often answers cleanly seconds
later. A sibling mirror already seeing a challenge still suppresses the retry,
so a region-wide block is never re-polled, and an abort landing inside the
retry wait short-circuits the whole leg instead of falling through to a curl
subprocess whose deadline outlives the caller.
