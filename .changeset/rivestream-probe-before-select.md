---
"@kitsunekode/kunai": patch
---

Rivestream no longer hands mpv a dead URL when a service answers JSON but its segments refuse playback. Candidates are now probe-verified before selection: a proven refusal (HTTP error status, HTML body, truncated body) fails that service with `candidate-blocked` so the cycle falls through to the next mirror, while timeouts stay lenient. Flowcast proxy answers also forward their baked-in headers instead of the static site referer.
