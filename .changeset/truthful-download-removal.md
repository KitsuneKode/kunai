---
"@kitsunekode/kunai": patch
---

Keep download and offline asset records when file removal fails or another instance has claimed the job. Commit job and asset removal together before notifying listeners, and let Library and Downloads show retained-file results instead of optimistic deletion. Downloads confirmation follows the selected job identity across list refreshes.
