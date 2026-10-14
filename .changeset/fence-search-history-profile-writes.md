---
"@kitsunekode/kunai": patch
---

Capture the destination profile for search history writes, preserve concurrent
session appends under a file transition lock, and flush pending history on exit.
Keep corrupt history intact and isolate history tests on every platform.
