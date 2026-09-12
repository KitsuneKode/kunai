---
"@kitsunekode/kunai": patch
---

Start anime from Miruro in about a second instead of about four.

Two things were costing every episode. Kunai checked each Miruro backend before
playing it, and for the one that plays most reliably right now that check could
never get an answer — so it waited out its full timeout every time, for nothing.
And a backend that was down got checked again on every single episode.

The check now skips the backend it cannot judge, and a backend that keeps
failing is set aside for an hour instead of being asked again, the same way
Kunai already does for its movie and series sources. While it is set aside the
source list shows it as temporarily unavailable, and it is tried again once the
hour is up.
