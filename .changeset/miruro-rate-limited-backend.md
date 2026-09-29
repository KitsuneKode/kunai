---
"@kitsunekode/kunai": patch
---

Skip a Miruro server whose backend is rate-limiting, instead of handing it to the player.

Miruro fronts about a dozen streaming backends, and its first choice was
answering "too many requests" to everyone — so anime resolved successfully and
then failed the moment playback started, with the recovery only kicking in after
the player had opened.

Kunai already skipped a server whose backend was down or gone; a rate-limited
one now counts too. It moves on to the next backend and plays from there.
