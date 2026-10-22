# R07 — Build inputs, honest gates and privacy-consistent metrics

Status: BUILD/CI READY; METRICS WAITING FOR PRODUCT/PRIVACY CHOICE; no runtime implementation is claimed.
Baseline: `e5fd018af3d673d9dc10e866dabbf4428486ddb1`, 2026-10-01. Refresh before execution.
Execution policy, isolation, integration ownership and evidence: [runbook](./2026-10-01-execution-runbook.md).
Use the executing-plans workflow for implementation; delegate only when the assignment explicitly authorizes it.

**Global constraints:** Preserve unrelated changes. Use isolated HOME/USERPROFILE/XDG/APPDATA/LOCALAPPDATA roots, never KUNAI_CONFIG_DIR. No real-profile writes. Episode presentation is 1-based. Keep enforced package/layer directions. Analytics requires explicit consent; relay remains metadata-only with no bundled shared endpoint. Run fresh checks; record skips and native/external limits. No commit/publication/deployment is authorized by this plan.

**Goal:** Produce fresh docs from declared inputs, make local/hosted checks agree, and stop claiming exact deduplication after identities retire.
**Architecture:** Package-specific Turbo contracts encode artifact dependencies; one CI gate contract routes local/affected/hosted checks; ingest stores implement an explicitly chosen metric definition.
**Tech stack:** Bun 1.4.2, installed Turbo 2.11.5, Next/Fumadocs, GitHub Actions, memory/Postgres stores.
**Spec:** Audit A14/A15/A17; [infrastructure](../.docs/repo-infrastructure.md), [privacy contract](../.docs/analytics-privacy-contract.md), [dependency owner 063](./063-docs-dev-dep-advisories.md).
**Dependencies:** Build/CI independent. R07.3 requires a product/privacy metric choice before runtime/API changes.

## Review focus

1. External docs/provider/CLI inputs and output-affecting env change the correct hashes and reach strict-mode tasks.
2. Cold/warm/restored docs artifacts have correct canonicals and fresh generated metadata/provenance.
3. Local CI includes intended root/doc gates and catches actual active-file conflict markers.
4. Post-retirement returns and historical recomputation obey the published metric definition in both stores.
5. Dependency evidence names lockfile/tool/exit status; no silent retention expansion or opportunistic mass upgrade.

## R07.1 — Declare docs build truth (A14)

Allowed edits: `apps/docs/turbo.json`, `apps/docs/scripts/check-codegen-freshness.ts`, generator tests; coordinator-reviewed `turbo.json` only where necessary. Create `apps/cli/test/unit/scripts/docs-turbo-contract.test.ts` for isolated task-contract regressions.

- [ ] Read installed `node_modules/turbo/docs/README.md`, configuration, task/caching/env pages. Keep current noncached generate/provenance behavior.
- [ ] Run two dry builds with differing DOCS_SITE_URL and SOURCE_COMMIT; record hashes and env lists. In an isolated fixture/worktree change root docs, provider manifest, CLI flags/keys/commands and release material separately. Correct dependent tasks must be selected/hash differently.
- [ ] Add precise root-relative inputs to generate and build, preserving defaults. Contract outline:

```json
{
  "inputs": [
    "$TURBO_DEFAULT$",
    "$TURBO_ROOT$/docs/**",
    "$TURBO_ROOT$/.release/**",
    "$TURBO_ROOT$/.reference/design/brand/kunai-mascot-og.png",
    "$TURBO_ROOT$/apps/cli/src/**",
    "$TURBO_ROOT$/apps/cli/package.json",
    "$TURBO_ROOT$/packages/providers/src/**"
  ],
  "env": [
    "DOCS_SITE_URL",
    "SOURCE_COMMIT",
    "VERCEL_GIT_COMMIT_SHA",
    "VERCEL_PROJECT_PRODUCTION_URL",
    "VERCEL_URL"
  ]
}
```

Refine broad CLI/provider globs from actual fingerprint/generator readers without omitting their transitive inputs. Apply relevant env/inputs to each output-affecting task, not solely generate. Runtime-only env belongs in passThroughEnv; secrets never enter outputs.

- [ ] Keep declared deterministic generated outputs and current volatile provenance semantics coherent. A noncached generate task alone does not fix downstream hashes; include external inputs or verified installed-version deferred hashing of generated inputs.
- [ ] Expand freshness checking to repo-content outputs, not only CLI metadata. Mutate a source fixture and require a behavioral stale-content failure.
- [ ] Cold build, warm build, remove only isolated .next output and restore from cache. Inspect canonical URLs, command/provider tables, release notes and provenance. Qualify the actual Vercel build route separately; checked-in direct build bypasses Turbo and was not proven stale.

## R07.2 — Gate parity, conflicts and warning policy (A17)

Allowed edits: coordinator-owned `package.json`, `scripts/ci-affected-run.ts`, `scripts/ci-bootstrap-contract.ts`, `.github/workflows/ci.yml`; `.docs/repo-infrastructure.md` and script unit tests. Create `scripts/verify-active-conflicts.ts` and `apps/cli/test/unit/scripts/verify-active-conflicts.test.ts`.

- [ ] Add a gate-contract regression proving local ci/ci:affected execute fmt:root:check and required standalone docs checks. Define docs checks for root-only changes explicitly; do not pretend package selection covers them.
- [ ] Add an active tracked-file conflict scanner for beginning-of-line merge markers. Fixture cases: lone <<<<<<< marker fails, normal heading passes, archived historical patch is excluded. Restrict to active source/docs/config and explain intended literals with an explicit exception.
- [ ] Remove the real stray marker at repo-infrastructure line 154 after understanding intended prose. Reconcile pre-push/cache claims and the duplicate cache:false key; the duplicate is cosmetic.
- [ ] Record current lint warning identities, decide advisory versus release-blocking policy, then ratchet “no new warnings” with a reviewed baseline. Do not call 20 warnings zero or weaken errors to pass.
- [ ] Keep tests forced/noncached and hosted doc-coverage explicit. Preserve failure when a required check is missing; print skipped platform/tool gates clearly.
- [ ] Review actual workflow permissions, third-party action pins, pull_request_target/untrusted input handling and release secrets against GitHub's guidance. Existing SHA pins are a strength; only change proven gaps. [GitHub Actions security reference](https://docs.github.com/en/actions/reference/security/secure-use).

## R07.3 — Fix metric semantics (A15; gated choice)

Allowed edits after decision: `apps/analytics-ingest/src/store.ts`, `memory-store.ts`, `postgres-store.ts`, `sql-statements.ts`, `public-metrics.ts` in that directory; ingest/series/public tests; docs analytics types/copy; owning privacy docs. Coordinator reviews API/schema/migration.

- [ ] Reproduce one hash ping→retire→return and two retire/return cycles; current cumulative retained+retired count overcounts unique installations. Add historical-day recomputation cases after later retirements.
- [ ] Present a concrete choice: recommended preserve current retention and publish a clearly defined estimate/cumulative observations metric with its return-overcount limitation; alternative exact lifetime unique count needs durable deduplication identity and an explicit retention/disclosure decision.
- [ ] Implement only the selected definition. Do not keep “exact lifetime installs” on an estimated counter, and do not extend identity retention automatically.
- [ ] Version public schema/labels where meaning changes; update all docs charts/readers and operator retention settings. Preserve small-cell suppression, rate/body limits, endpoint pinning and the five-field client payload.
- [ ] Run the same contract fixtures against memory and disposable Postgres, including repeated cron/idempotence, returning hashes and chronological historical rollups. Never run migrate against a production database from this plan.

## R07.4 — Reconcile dependency owner 063

- [ ] Treat its September 19 advisory table as historical. User reported September 30 output {}, without exit status; no vulnerability count is inferred.
- [ ] On an authorized registry-capable runner capture bun --version, lockfile SHA-256, bun audit --json output and exit status. Confirm current reachability/workspace ownership before upgrades.
- [ ] Inspect current Bun help/official documentation before using an audit remediation command or minimumReleaseAge option; do not assume the older plan's audit fix syntax is supported.
- [ ] Fix only verified current advisories in owning workspaces with focused lockfile changes and docs build qualification. Reconcile scheduled monitoring already present before adding another workflow.
- [ ] Verify any installation age policy with installed Bun and a local fixture. Fresh frozen-lockfile install and release provenance remain distinct checks.

## Verification and closure

```sh
bun run --cwd apps/cli test:file -- test/unit/scripts/ci-affected-run.test.ts test/unit/scripts/ci-bootstrap-contract.test.ts
bun run --cwd apps/docs generate
bun run --cwd apps/docs test
bun run --cwd apps/docs typecheck:app
bun run build:docs -- --force
bun run --cwd apps/analytics-ingest test
bun run --cwd apps/analytics-ingest typecheck
ANALYTICS_TEST_DATABASE_URL= bun run --cwd apps/analytics-ingest test:pg
bun run fmt:root:check
bun run verify:doc-paths
```

The blank ANALYTICS_TEST_DATABASE_URL selects the package's disposable Docker
database rather than an inherited target; confirm this behavior before running.
Use a dedicated checkout/Compose project so teardown cannot remove another
agent's scratch volume. An explicit external URL must be a verified scratch
database. Run newly created script tests and runbook gates. Disposable
Postgres/socket/build restrictions are reported separately. Return task hash
matrix, restored artifact inspection, gate selection matrix, chosen metric
definition and current dependency evidence. R10 may consume only qualified
build/metric claims.
