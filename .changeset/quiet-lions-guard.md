---
"@kitsunekode/kunai": patch
---

Harden the installer's cleanup of abandoned install transactions. A stale transaction record naming a staging directory outside the cache — either by traversing out of it, or by being a sibling that merely shared its name prefix — is no longer removed. The TypeScript installer already refused these; the shell path now matches it.
