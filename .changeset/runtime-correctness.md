---
"@kitsunekode/kunai": patch
---

Small runtime correctness fixes.

A malformed `kunai-track-changed` value from the mpv bridge used to surface in
the UI as "track switched (id NaN)". The router now accepts only the exact
`<audio|sub>:<id>` shape the bridge emits and drops anything else, still
clearing the property so a bad value cannot stick.

Musl detection no longer probes `/proc/self/exe`, `ldd`, or
`/proc/self/maps` at all — it reads
`process.report.getReport().header.glibcVersionRuntime`, which Bun and Node
populate on glibc builds and omit on musl. It is the one check that does not
depend on filesystem layout, and it is the same predicate Bun's own test
harness uses.

A dead `?? 0` in the HLS variant ranker is removed; `currentBandwidth` was
always a number.
