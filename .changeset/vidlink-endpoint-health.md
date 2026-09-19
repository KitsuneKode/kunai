---
"@kitsunekode/kunai": patch
---

fix(vidlink): classify HTTP failures and honor endpoint quarantines on both legs

VidLink's `enc-dec.app → vidlink.pro` chain collapsed every non-OK status into
a retryable network error — a persistent 429/403 retry-stormed on every resolve
and wrote misleading health. Failures now classify through `ProviderHttpError`
(rate-limited/blocked/not-found/provider-unavailable), and both legs consult
`endpointHealth`: quarantined endpoints are skipped without spending a request,
and 404s — the service not carrying the title — never record health evidence.
