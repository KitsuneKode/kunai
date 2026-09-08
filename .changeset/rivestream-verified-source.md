---
"@kitsunekode/kunai": patch
---

Stop Rivestream selecting a source that cannot play.

Rivestream reported success for a playlist whose segments were refused by a
third-party CDN, so cycling stopped at the first server that merely responded
and never reached one that plays. It now proves a source before accepting it,
walking that source's qualities and moving to the next server only when every
distinct host has refused.

A refusal is also recorded against that server, so a mirror proven dead is
skipped on later plays instead of being re-walked every time.
