---
"@kitsunekode/kunai": patch
---

Preserve the local resume point when quitting in the credits. Automatic completion requires a clean natural EOF and trusted progress past the completion threshold; explicit mark-watched remains available. Preserve the actual quit position and stop resume/continuation readers from overriding unfinished history using near-end ratios.
