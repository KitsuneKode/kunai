---
"@kitsunekode/kunai": patch
---

Stop a lost activation-lock reclaim race from crashing the updater: restoring a
quarantined lock now tolerates the quarantine vanishing mid-race, and Windows
pending-delete/antivirus responses (EPERM, EACCES, EBUSY) retry as contention
instead of failing the acquire.
