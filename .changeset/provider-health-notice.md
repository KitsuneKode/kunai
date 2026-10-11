---
"@kitsunekode/kunai": patch
---

When a lane's configured default provider is persistently `down`, Kunai now
drops a one-row inbox notice naming it and suggesting a healthier alternative
— the difference between a user debugging their network and a user switching
provider.

The suggestion is lane-aware: an anime default that dies recommends an anime
provider, never rivestream. Priority order comes from `providerPriorityForLane`
and candidates are filtered to providers actually loaded for that lane.
