---
"@kitsunekode/kunai": patch
---

Stop history consolidation from moving a resume position backwards. When two history rows turn out to be the same episode — usually an opaque row and its catalog row for the same title — the surviving row is chosen by which was touched most recently, and its watch state used to be kept wholesale. A row opened briefly a minute ago therefore beat one watched most of the way through yesterday, and a completion earned under the other id was dropped. The identity still comes from the newer row; the progress now keeps the furthest position, a sticky completion, the longer known duration, and the earlier first-watched date.
