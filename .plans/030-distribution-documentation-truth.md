# Plan 030: Reconcile distribution documentation with the shipped routes

> **For agentic workers:** Use `superpowers:verification-before-completion`. Do not begin until plans 026-029 have landed; document live behavior, not the intended intermediate design.
>
> **Drift check (run first):** `git diff --stat a6214d30..HEAD -- README.md RELEASING.md PACKAGING.md docs/users/install-and-update.md .docs/testing-strategy.md .docs/repo-infrastructure.md .docs/release-reliability-gate.md`

**Goal:** Installation, packaging, and release docs accurately describe the Node launcher, embedded Bun binaries, prerequisites, ownership behavior, and evidence-backed release process.

**Architecture:** Establish one short canonical distribution model in `PACKAGING.md`; user docs link to it and focus on commands, while release docs focus on operator gates. Add a grep-based truth test for phrases that encode the retired bundled-JS/postinstall design.

**Tech stack:** Markdown, Bun docs/codegen checks.

## Status

- **Priority:** P1
- **Effort:** M
- **Risk:** LOW
- **Depends on:** plans 026, 027, 028, 029
- **Category:** docs
- **Planned at:** commit `a6214d30`, 2026-07-22

## Canonical product truth to document

- `curl ... | sh` / PowerShell binary route is recommended and installs one Bun-compiled, versioned native binary; Bun and Node are not runtime prerequisites.
- `npm install -g @kitsunekode/kunai` installs a small Node launcher plus one exact-version optional platform package; Node is required, Bun is embedded in the selected binary.
- `bun install -g @kitsunekode/kunai` installs the same Node launcher/package graph and therefore still requires Node at launch. Keep this route documented as compatible but not zero-prerequisite. Do not claim Bun alone is sufficient unless plan 026 deliberately changed the launcher runtime and tests prove it.
- Source checkout requires Bun for install, build, test, and run.
- There is no postinstall binary download and no shared public relay.
- Release order is candidate -> real evidence -> protected confirmation -> platform packages -> launcher -> draft GitHub release verification -> public promotion -> metadata.

## Scope

- `README.md`, `docs/users/install-and-update.md`, `PACKAGING.md`, `RELEASING.md`
- `.docs/testing-strategy.md`, `.docs/repo-infrastructure.md`, `.docs/release-reliability-gate.md`
- `apps/cli/test/unit/scripts/distribution-docs-truth.test.ts` (create)
- Generated docs metadata affected by these sources.
- Do not change installer/runtime code or promise signing, automatic updates, or platform coverage beyond passing CI evidence.

## Tasks

### Task 1: Add a failing documentation truth test

- [ ] Create a table of required claims and forbidden stale phrases. At minimum forbid claims that npm ships a Bun JS bundle, downloads a binary in postinstall, or needs a separately installed Bun runtime.
- [ ] Assert the user install page identifies prerequisites for binary, npm, Bun-global, and source routes.
- [ ] Assert release docs contain launcher-last, trusted-publishing, resumability, and evidence-gate language.
- [ ] Run `bun run --cwd apps/cli test test/unit/scripts/distribution-docs-truth.test.ts`; expect failures against current docs.

### Task 2: Rewrite the canonical packaging explanation

- [ ] In `PACKAGING.md`, add a compact component table for native bundle, npm launcher, platform packages, and source tree: runtime, contents, owner, version coupling, and update/uninstall path.
- [ ] Describe generated publish manifest fields and the exact-version invariant without duplicating all script internals.
- [ ] State why Bun is not separately shipped: `bun build --compile` embeds the runtime in each native artifact.
- [ ] State the Bun-global Node caveat plainly.
- [ ] Commit: `docs(packaging): document the actual distribution model`.

### Task 3: Reconcile user-facing install and update routes

- [ ] Make the native one-click command the recommended route in `README.md` and `docs/users/install-and-update.md`.
- [ ] Present npm as the familiar package-manager route with Node prerequisite; present Bun-global as compatible but Node-dependent; keep source setup in a developer section.
- [ ] Document `kunai upgrade`, `kunai uninstall`, explicit version install, `--dry-run`, and how ownership is detected through the managed launcher contract.
- [ ] Include a short troubleshooting table for wrong architecture, launcher cannot find platform package, PATH shadowing, and missing Node.
- [ ] Commit: `docs(install): clarify one-click and package-manager routes`.

### Task 4: Reconcile release and infrastructure docs

- [ ] Update `RELEASING.md` with the nine-package trusted-publisher prerequisite, dry-run/preflight, safe rerun behavior, launcher-last rule, and immutable release URLs.
- [ ] Update the three `.docs` files so tests are described as local candidate installation plus host-native smokes and confirmation is described as consuming evidence, not declarations.
- [ ] Remove all references to postinstall downloads and published `dist/kunai.js`/`dist/kunai.mjs` runtime entrypoints.
- [ ] Run `bun run --cwd apps/cli test test/unit/scripts/distribution-docs-truth.test.ts`; expect all pass.

### Task 5: Regenerate and verify

- [ ] Run `bun run --cwd apps/docs generate` if documentation metadata changes.
- [ ] Run `bun run typecheck`, `bun run lint`, `bun run fmt`, and the docs truth test; expect exit 0.
- [ ] Run `rg -n 'postinstall|Bun JS bundle|dist/kunai\.(js|mjs)' README.md PACKAGING.md RELEASING.md docs/users/install-and-update.md .docs`; every remaining match must explicitly deny the retired design or refer only to source builds.
- [ ] Run `git diff --check`; expect no output.

## STOP conditions

- Any prerequisite or route behavior differs between the completed implementation and the Canonical product truth above.
- A claimed platform has no blocking release smoke evidence.
- Generated metadata changes unrelated product vocabulary or files outside documentation metadata.

## Maintenance notes

`PACKAGING.md` owns architecture truth; user docs should link rather than repeat implementation detail. Whenever launcher/runtime ownership changes, update the truth test in the same commit so stale distribution claims become a CI failure.
