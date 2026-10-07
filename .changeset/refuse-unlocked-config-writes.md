---
"@kitsunekode/kunai": patch
---

Reject configuration saves after lock contention instead of writing unlocked.
Guard acquisition, stale recovery and release with generation-specific ownership;
retain live or foreign owners and allow a later retry after contention clears.
