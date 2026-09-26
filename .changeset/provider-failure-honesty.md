---
"@kitsunekode/kunai": patch
---

Report a blocked provider as blocked, and stop advising a fix that was already applied.

Three failure-classification fixes, all of which were spending retry budget or
misleading the person reading the error.

**A Cloudflare challenge is not retryable.** AniDB reported every failure as
`retryable: true`, including a Cloudflare block. The engine reads that flag to
decide whether to buy a provider a second full attempt — 12 seconds each under
the `balanced` default — so a block that no retry can clear was costing up to
half the resolve budget before any fallback was considered. AniDB now mirrors
the policy AllManga already uses for its captcha gate: a typed `blocked` failure
is not retryable, anything else is. Related: on the no-curl path a challenge
arriving with a 4xx status was never recognised as a challenge, because the
status was read before the body. The body is now read first.

**The `dns` substring no longer means "offline".** Network classification
matched any error message containing the three letters `dns`. A title echoed
into an error, or a path containing `dns`, was enough — and two such failures
across two providers halt every remaining live candidate, including working
ones. The resolver's actual phrasings (`Could not resolve host`, `Name or
service not known`, `no such host`, `dns lookup`) are enumerated instead.

**Errors name the request they failed on.** A hianime resolve is four network
hops; `hianime fetch HTTP 503` did not say which one died. Both providers also
suggested installing curl-impersonate to users already running
curl-impersonate — advice the reader has already followed, which makes a blocked
upstream look like a local misconfiguration.
