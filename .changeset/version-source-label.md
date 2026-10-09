---
"@kitsunekode/kunai": patch
---

Print a clean `--version` channel.

`kunai --version` from a source checkout no longer wraps the channel in nested
`(detected)` parens, and running `bun run src/main.ts --version` from `apps/cli`
no longer reports `unknown`. Source runs print `(source)`, packaged binaries
print `(binary)` (or the `install.json` / managed-package method when present),
and leftover undetermined script runs print `(dev)`.
