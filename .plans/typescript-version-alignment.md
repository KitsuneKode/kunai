# TypeScript version alignment — one compiler, one version

Status: TODO — written for audit-4 follow-up.

## Why this matters

The workspace declares three TypeScript versions and all but one resolve to
the same hoisted install — the pins are dead config, which is worse than no
pin because readers believe a guarantee the install does not keep:

| Workspace           | Declared            | Actually resolves      |
| ------------------- | ------------------- | ---------------------- |
| root catalog        | `typescript ^7.0.2` | `typescript@7.0.2`     |
| `catalog:web`       | `typescript 5.9.3`  | — (not nested)         |
| `apps/relay-server` | `typescript 5.9.3`  | `7.0.2` (hoisted root) |
| `apps/docs`         | `catalog:web`       | `7.0.2` (hoisted root) |
| everything else     | `catalog:`          | `7.0.2` (hoisted root) |

Verified 2026-09 audit-4 pass: no package has a nested
`node_modules/typescript`; `bun tsc --version` reports `7.0.2` in
`apps/relay-server` and `apps/docs` despite their `5.9.3` pins. The lockfile
(`bun.lock:121,292`) still records the declared pins.

Risk if left: a change to bun's hoisting (or an isolated install) silently
puts `apps/docs` and `apps/relay-server` on a different compiler than the one
CI typechecks with — different diagnostics, different `lib` defaults, and a
`5.9.3` pin that may even predate syntax the code uses.

## Scope

1. Pick one version (root catalog `7.0.2` — already what everything resolves
   to; TS 7 is the native compiler, so verify the docs app's Next/fumadocs
   toolchain tolerates it rather than assuming).
2. Move `apps/relay-server` and `catalog:web` onto `catalog:`; delete the
   `5.9.3` entries.
3. If `apps/docs` genuinely needs 5.9.x, make the pin _real_: isolated linker
   or a nested install, plus a comment saying why it diverges — a pin that
   hoists away is worse than deleting it.
4. `bun install` + `bun run typecheck --force` to prove every workspace still
   checks on the one compiler.
