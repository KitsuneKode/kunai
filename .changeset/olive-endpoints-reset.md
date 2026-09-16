---
"@kitsunekode/kunai": patch
---

Make `/reset-provider-health` actually clear endpoint quarantines.

Quarantined provider endpoints (1h server-error, 24h dead-route) lived in
`provider_endpoint_health`, which no reset scope touched - so the reset
confirmation said "retry" while the cycle kept skipping the same mirrors.
Every reset scope now clears the endpoint rows it owns (provider, lane, all,
or per-show rows the title contributed to), and the confirmation names how
many quarantined endpoints were lifted.
