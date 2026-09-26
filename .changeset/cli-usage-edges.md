---
"@kitsunekode/kunai": patch
---

Stop accepting malformed invocations at the CLI edge.

An unknown flag used to be a warning that launched anyway — `kunai --tpyo` ran a
search nobody asked for, and `--config <path>` turned the path into the query.
Unknown options, value flags with no value, and a value flag followed by another
flag are now usage errors: a message naming the problem, a pointer to
`kunai --help`, and exit code 2 — the same code `kunai completion` already uses,
so wrappers can tell a typo from a real failure.

A bare word that looks like a mistyped maintenance command is rejected with the
suggestion (`kunai doctro` → "did you mean `kunai doctor`?"); ordinary positional
searches still work, and `-S` stays the explicit escape.

`-i/--id` now validates against the ids the lookup path can actually resolve —
a bare TMDB id, `tmdb:<id>`, or `anilist:<id>`, positive integers. `imdb:` is
rejected rather than minting a title that could never resolve.

And on a read-only config directory, the dependency-capability notice warns once
and keeps launching instead of dying on an unhandled rejection with a raw
absolute path in it.
