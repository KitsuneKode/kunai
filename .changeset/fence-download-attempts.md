---
"@kitsunekode/kunai": patch
---

Fence download workers by durable claim token and generation, isolate attempt files, and prevent retired workers from launching or completing a successor's download. Preserve asynchronous copy fallback with an exclusive destination reservation and crash-recovery identity checks; incomplete or replaced files are never reported as completed, and replacing a completed file prevents destructive artifact deletion.
