---
status: current
lastReviewed: "2026-09-12"
---

# Lint policy (beta)

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

- **Gate:** `bun run lint` (oxlint) must exit **zero** in CI — **errors are blocking**; warnings may exist during beta burn-down.
- **Budget:** no per-warning budget file — fix new warnings in the same PR that introduces them; burn down existing warnings in focused batches when touching a file anyway.
- **Rationale:** keeps signal high for agents and humans without blocking unrelated refactors on legacy debt.

## Root tooling coverage

`bun run lint` runs package lint tasks and the explicitly registered Turbo root
task `//#lint:root`. That nonrecursive, uncached task runs `oxlint scripts tools`
with the same base correctness rules as package lint. It does not scan unrelated
root files, application/package trees, or worktrees. Existing warnings remain
nonblocking; this adds coverage without changing rule severity.

The full and affected local CI commands, `bun run check`, and both hosted lint lanes name the root
task explicitly. It therefore runs even when `--affected` selects no packages;
package selection remains affected-only on PRs. Arguments such as `--force` and
`--summarize` still reach Turbo. The changed-file anti-slop advisory remains a
separate PR step, not a substitute for this blocking correctness gate.

`apps/cli/test/unit/scripts/root-tooling-lint.test.ts` exercises the real Turbo
task graphs (including an empty affected range) and runs the configured oxlint
command against clean and failing temporary tooling fixtures.

## anti-slop (ratcheted, plus a changed-file advisory)

`bun run lint:anti-slop` runs the vendored plugin in
`tools/oxlint/anti-slop/` via `.oxlintrc.anti-slop.json`. All fifteen generic
rules are set to **error** in that config — the severity is not weakened.

### The ratcheted rules

No `anti-slop/*` rule lives in `.oxlintrc.json` — `bun run lint`, the
lint-staged pre-commit hook, and CI's Lint job cannot even resolve those rule
names. Every rule is enforced **only** through the count baseline below; the
four nearest zero are the promotion candidates:

- `anti-slop/no-chained-type-assertions`
- `anti-slop/no-object-parameters`
- `anti-slop/no-reflect-apply`
- `anti-slop/no-reflect-get`

There is no test-path exemption — findings in `test/` and `*.test.*` count
against the same baseline like everything else.

**Ratcheting a rule into a hard gate means driving its baseline count to zero
first**, then adding it to `.oxlintrc.json` where `bun run lint` becomes
blocking. Do not wire a rule into the blocking gate with a non-zero baseline;
that is how a gate gets disabled.

### The advisory

All fifteen rules run as a **separate** command on purpose. The rules still
report thousands of
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

### The count baseline

The changed-file advisory only sees files a PR touches — a type change in one
file can create a finding in a file the PR never opens (widening a return type
widens every call site). `tools/oxlint/anti-slop/baseline.json` closes that gap
with a checked-in per-rule count of the full scan. `bun run
lint:anti-slop:baseline` fails when any rule's count rises above the baseline,
reports decreases as ratchet invitations, and flags zeroed rules as promotable.
After burning a count down, commit the new numbers with `bun run
lint:anti-slop:baseline:update` — the baseline only moves down through that
explicit act. The updater refuses to write a baseline with rule-count
increases; raising a count means editing `baseline.json` by hand, where the
bump is a visible diff a reviewer can question.

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
