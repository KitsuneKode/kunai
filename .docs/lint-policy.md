---
status: current
lastReviewed: "2026-08-24"
---

# Lint policy (beta)

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

- **Gate:** `bun run lint` (oxlint) must exit **zero** in CI — **errors are blocking**; warnings may exist during beta burn-down.
- **Budget:** no per-warning budget file — fix new warnings in the same PR that introduces them; burn down existing warnings in focused batches when touching a file anyway.
- **Rationale:** keeps signal high for agents and humans without blocking unrelated refactors on legacy debt.

## anti-slop (ratcheted, plus a changed-file advisory)

`bun run lint:anti-slop` runs the vendored plugin in
`tools/oxlint/anti-slop/` via `.oxlintrc.anti-slop.json`. All fifteen generic
rules are set to **error** in that config — the severity is not weakened.

### The ratcheted rules

Four rules are clean in `src/` and are therefore **blocking** in
`.oxlintrc.json`, so `bun run lint` and the pre-commit hook enforce them:

- `anti-slop/no-chained-type-assertions`
- `anti-slop/no-object-parameters`
- `anti-slop/no-reflect-apply`
- `anti-slop/no-reflect-get`

They are turned **off** for test paths (`**/*.test.*`, `**/test/**`,
`**/__mocks__/**`), which still carry a legacy baseline — roughly 300 chained
assertions in tests alone. Production code holds the line; tests are not held to
it yet.

**Ratcheting a fifth rule means driving its `src/` count to zero first**, then
moving it into `.oxlintrc.json` alongside these. Do not add a rule to the
blocking gate with a non-zero baseline; that is how a gate gets disabled.

### The advisory

The remaining eleven rules stay a **separate** command on purpose. The rules still report thousands of
historical findings, so wiring them into `.oxlintrc.json` would turn
`bun run lint` and the lint-staged pre-commit hook red on the first run and
block every unrelated commit. Severity is not the thing to compromise there;
scope is.

On pull requests, CI runs `bun run lint:anti-slop:changed` against only the
added, copied, modified, or renamed JavaScript and TypeScript files in the PR.
Findings appear as source annotations but do not fail the job. Tooling failures
still fail: an advisory that silently stopped running would be worse than no
advisory. This avoids a large legacy baseline and gives new work useful feedback
without turning opinionated design prompts into release blockers.

Locally, the command compares against `origin/main` by default. Pass a commit or
branch as its first argument to inspect a different stack boundary.

The findings are real, not false positives — mostly unjustified type
assertions, `typeof` narrowing at non-boundaries, and `Record<string, unknown>`
dictionaries. Burn them down the way warnings are handled above: in focused
batches, when touching a file anyway. Promote the plugin into `.oxlintrc.json`
once the count reaches zero, then make the full command blocking and delete this
section.

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
