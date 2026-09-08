---
"@kitsunekode/kunai": patch
---

Report an AniDB outage instead of showing no results.

AniDB answers a site-wide outage with a `503` maintenance page on every route.
Scraping that page for result rows finds none, so search reported zero results
for every query alike — an outage wearing the costume of "no such anime", with
nothing thrown and no signal for provider fallback to act on. Every read now
surfaces its HTTP status, and only the statuses a different TLS fingerprint
could change are retried.
