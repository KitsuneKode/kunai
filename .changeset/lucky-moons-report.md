---
"@kitsunekode/kunai": patch
---

Make `kunai diagnostics recent` readable in a terminal.

### Features

- Add a `pretty` format that lays each event out as a timestamped header, its
  message, and its context as `key=value` pairs. Events group under a date
  heading and a session id heads its run rather than repeating on every line.
- `pretty` is the default only when stdout is a terminal. A pipe or redirect
  still receives `jsonl`, so `kunai diagnostics recent > report.jsonl` and
  `| jq` are unchanged. `--format` always overrides.
- Colour follows the same terminal signal and is disabled by `NO_COLOR` or
  `--no-color`; `--color` forces it on for a pipe that wants escapes. Only
  16-colour SGR is used, which terminals reporting no `COLORTERM` still render.

### Behavior

- Every context key is printed, but the ones that repeat with the same value on
  nearly every event (`status`, `severity`, `recommendedAction`, `spanFamily`)
  sort last so the fields that differ lead the line.
- Oversized values are sampled with an explicit count — one real
  `skippedReasons` array runs to 82 entries and roughly two thousand characters.
  `jsonl` and `markdown` remain lossless.
