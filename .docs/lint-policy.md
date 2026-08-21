---
status: current
lastReviewed: "2026-05-04"
---

# Lint policy (beta)

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

- **Gate:** `bun run lint` (oxlint) must exit **zero** in CI — **errors are blocking**; warnings may exist during beta burn-down.
- **Budget:** no per-warning budget file — fix new warnings in the same PR that introduces them; burn down existing warnings in focused batches when touching a file anyway.
- **Rationale:** keeps signal high for agents and humans without blocking unrelated refactors on legacy debt.

## anti-slop (advisory, not yet a gate)

`bun run lint:anti-slop` runs the vendored plugin in
`tools/oxlint/anti-slop/` via `.oxlintrc.anti-slop.json`. All fifteen generic
rules are set to **error** in that config — the severity is not weakened.

It is a **separate** command on purpose. The rules report **4,675 findings**
(≈2.5k in source, ≈2.1k in tests), so wiring them into `.oxlintrc.json` would
turn `bun run lint`, the lint-staged pre-commit hook, and CI red on the first
run and block every unrelated commit. Severity is not the thing to compromise
there; scope is.

The findings are real, not false positives — mostly unjustified type
assertions, `typeof` narrowing at non-boundaries, and `Record<string, unknown>`
dictionaries. Burn them down the way warnings are handled above: in focused
batches, when touching a file anyway. Promote the plugin into `.oxlintrc.json`
once the count reaches zero, and delete this section when that happens.

The Effect rule group is deliberately **not** installed: nothing here declares
`effect` as a direct dependency.

The vendored plugin is **not** added to `ignorePatterns`: it lints clean
under the repo's own rules, and ignoring it while lint-staged still handed
its files to oxlint failed the hook with "No files found to lint".

`oxlint` is pinned to `1.74.0` (not `^`) so it matches `@oxlint/plugins`
exactly — the JS plugin API is version-coupled. 1.79 adds
`react(set-state-in-effect)`, which flags a pre-existing cascading-render bug
in `apps/docs/components/home/terminal-simulator.tsx`; that is worth fixing on
its own branch, not as a side effect of installing a lint plugin.
