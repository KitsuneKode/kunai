---
"@kitsunekode/kunai": patch
---

Make the cross-process config lock survive slow Windows machines. Lock tickets are now published atomically without fsync or per-record ACL rewrites (roughly 30x cheaper per transition), the acquire and release budgets rise from 1s to 5s, and delete-pending ticket files on Windows are treated as still present instead of failing the save with "Config is busy".
