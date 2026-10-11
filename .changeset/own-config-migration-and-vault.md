---
"@kitsunekode/kunai": patch
---

Keep startup config migration and explicit native credential changes under the shared config lock. Avoid replacing another window's rotated token during unrelated saves, retain failed replacements, and reject unverified native clears.
