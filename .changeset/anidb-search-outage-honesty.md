---
"@kitsunekode/kunai": patch
---

AniDB search now surfaces site outages honestly instead of reporting them as zero results. A 503/5xx error page (maintenance, WAF) used to parse as an empty result set, which read as "no such title"; it now throws `AnidbHttpStatusError` so diagnostics and the provider matrix report environment trouble. No config or UX changes.
