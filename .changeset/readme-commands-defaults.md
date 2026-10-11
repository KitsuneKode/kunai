---
"@kitsunekode/kunai": patch
---

Make `bun run verify:readme:commands` work with no arguments.

The root script passed no arguments, so the only invocation a developer ever
made printed usage and exited 2 while CI — which passes the full flag form —
looked covered. Bare now resolves fixture mode, the CLI package's own version,
and the host binary `bun run build:binary:host` produces, and says exactly that
when the binary is absent. The explicit `--mode/--version/--binary` form CI
uses is unchanged.
