---
"@kitsunekode/kunai": patch
---

Remove a stray NUL byte from `offline-title-identity.ts`.

The dedupe key separator was a literal NUL byte in source, which made the
whole file classify as binary — `rg`/`grep` skipped it and lint passes treated
it as an asset. The separator is now the `\x00` escape, producing the same
runtime string.
