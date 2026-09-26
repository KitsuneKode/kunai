---
"@kitsunekode/kunai": patch
---

Small runtime correctness fixes.

A malformed `kunai-track-changed` value from the mpv bridge used to surface in
the UI as "track switched (id NaN)". The router now accepts only the exact
`<audio|sub>:<id>` shape the bridge emits and drops anything else, still
clearing the property so a bad value cannot stick.

Musl detection no longer reads the entire running binary into memory to probe
`/proc/self/exe` — it reads the first 8 KB, where the ELF interpreter name
(`ld-musl` vs `ld-linux`) actually lives, and only uses the probe as a
positive-musl fast path before the existing ldd/maps heuristics.

A dead `?? 0` in the HLS variant ranker is removed; `currentBandwidth` was
always a number.
