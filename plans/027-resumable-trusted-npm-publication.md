# Plan 027: Make nine-package npm publication synchronized, resumable, and trusted

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` and `superpowers:verification-before-completion`. Do not publish a real version while implementing this plan.
>
> **Drift check (run first):** `git diff --stat a6214d30..HEAD -- .github/workflows/release.yml package.json apps/cli/package.json scripts/publish-npm-release.ts scripts/release-guard.ts`

**Goal:** Versioning always synchronizes the launcher and its eight exact pins, and the protected release job can safely resume partial publication using npm trusted publishing.

**Architecture:** Add one version-sync utility used after Changesets and guarded in CI. Treat publication as reconciliation: inspect each local tarball, compare it with the registry, skip byte-identical existing versions, fail on conflicts, publish missing platform packages first, and publish the launcher last with npm provenance.

**Tech stack:** Bun orchestration scripts, npm CLI 11.5.1+, Node 22.14+, GitHub Actions OIDC.

## Status

- **Priority:** P0
- **Effort:** L
- **Risk:** HIGH
- **Depends on:** plan 026
- **Category:** release, security, reliability
- **Planned at:** commit `a6214d30`, 2026-07-22

## Current state and constraints

- `scripts/publish-npm-release.ts` publishes eight platform directories sequentially and then the launcher. A rerun fails when an immutable version already exists.
- Root `version:packages` runs Changesets but does not synchronize `apps/cli/package.json.optionalDependencies`.
- `.github/workflows/release.yml` grants `id-token: write` but publishes through Bun with `NODE_AUTH_TOKEN`; npm trusted publishing requires the npm CLI and OIDC-compatible Node/npm versions.
- `workflow_dispatch` is not restricted to `refs/heads/main`.
- npm packages must exist once before trusted-publisher configuration can be attached. That bootstrap is an operator action, not something CI should fake.
- The publication set is exactly `@kitsunekode/kunai` plus `@kitsunekode/kunai-darwin-arm64`, `@kitsunekode/kunai-darwin-x64`, `@kitsunekode/kunai-linux-arm64`, `@kitsunekode/kunai-linux-arm64-musl`, `@kitsunekode/kunai-linux-x64`, `@kitsunekode/kunai-linux-x64-musl`, `@kitsunekode/kunai-windows-arm64`, and `@kitsunekode/kunai-windows-x64`.

## Scope

- Create `scripts/sync-npm-platform-versions.ts` and `scripts/npm-publication-plan.ts`.
- Modify `scripts/publish-npm-release.ts`, `scripts/release-guard.ts`, root `package.json`, `.github/workflows/release.yml`.
- Create/update unit tests under `apps/cli/test/unit/scripts/`.
- Update `RELEASING.md` only for the one-time trusted-publisher bootstrap and recovery procedure; broader docs belong to plan 030.
- Do not tag, publish, create a GitHub release, or configure npm.org during implementation.

## Target interfaces

```ts
export interface LocalPackageCandidate {
  name: string;
  version: string;
  tarballPath: string;
  integrity: string;
  role: "platform" | "launcher";
}
export type PublicationDecision =
  | { action: "publish"; candidate: LocalPackageCandidate }
  | { action: "skip"; candidate: LocalPackageCandidate; registryIntegrity: string };
export function reconcileCandidate(
  candidate: LocalPackageCandidate,
  registryIntegrity: string | null,
): PublicationDecision;
```

If the registry version exists with different integrity, throw and stop. Never overwrite, unpublish, or increment a version automatically.

## Tasks

### Task 1: Synchronize and guard exact platform versions

- [ ] Write failing tests proving all eight optional dependency values must exactly equal the launcher version and reject ranges such as `^0.3.0`.
- [ ] Implement `sync-npm-platform-versions.ts` to read `apps/cli/package.json`, rewrite only the eight platform pins to its `version`, preserve stable formatting, and support `--check` without writes.
- [ ] Change `version:packages` to run Changesets, then the sync script, then metadata codegen.
- [ ] Call the sync script's check mode from `release-guard.ts`.
- [ ] Run the focused tests and `bun run release:guard`; expect exit 0.
- [ ] Commit: `fix(release): synchronize npm platform package versions`.

### Task 2: Make publication a tested reconciliation operation

- [ ] Unit-test these cases: missing version -> publish; same integrity -> skip; different integrity -> throw; launcher decision occurs after all platforms.
- [ ] Build candidates from `npm pack --json` output so each has npm's own `integrity` value.
- [ ] Query `npm view <name>@<version> dist.integrity --json`; treat only npm's documented 404/not-found response as missing and propagate auth/network errors.
- [ ] Publish each missing tarball with `npm publish <tarball> --access public --provenance`; never invoke `bun publish`.
- [ ] After each publish/skip, query the registry again and require matching name, version, and integrity. Publish the launcher only after all platform checks pass.
- [ ] Run unit tests with injected command/query functions; they must make no network requests.
- [ ] Commit: `fix(release): reconcile resumable npm publication`.

### Task 3: Enforce the protected main-branch OIDC route

- [ ] In `release.yml`, guard every dispatch-only candidate/confirmation/publish job with `github.ref == 'refs/heads/main'`.
- [ ] Before candidate creation, fetch `origin/main` and fail unless `git rev-parse HEAD` equals `git rev-parse origin/main`.
- [ ] Reorder the candidate job so `build:npm-platform` and launcher packing finish before `test:npm-global-install`; make that test consume the preserved local tarballs created by plan 026, never public npm.
- [ ] Pin setup to Node `22.14` or newer and npm `11.5.1` or newer; print both versions before publishing.
- [ ] Remove `NODE_AUTH_TOKEN` from the publish step and retain `permissions: id-token: write` plus the minimum contents permission needed for tags/releases.
- [ ] Add workflow-contract tests asserting main/SHA guards, npm publish/provenance, no `bun publish`, and no npm token environment variable.
- [ ] Run `bun run --cwd apps/cli test test/unit/scripts/distribution-contract.test.ts`; expect all pass.
- [ ] Commit: `ci(release): publish npm packages through trusted OIDC`.

### Task 4: Record the one-time external prerequisite and recovery path

- [ ] In `RELEASING.md`, list all nine package names, state that an owner must bootstrap any absent package once, and require a trusted publisher bound to this repository and `.github/workflows/release.yml` for each package.
- [ ] Document recovery: rerun the same workflow/version; matching packages are skipped, conflicts halt, launcher remains last.
- [ ] Add a preflight command: `npm view <package>@<version> name version dist.integrity --json` for every package.
- [ ] STOP before a real release if any package is absent and its trusted publisher has not been configured by an npm owner.

### Task 5: Verify without publication

- [ ] Run `bun run typecheck`, `bun run lint`, `bun run fmt`, `bun run build`, `bun run release:guard`, and all script contract tests; expect exit 0.
- [ ] Run the publication script only in its explicit `--dry-run` mode and assert it prints nine ordered decisions without publishing.
- [ ] Run `git diff --check`; expect no output.

## STOP conditions

- The npm CLI version available in the protected job is below 11.5.1 or Node is below 22.14.
- An existing registry package has different integrity from the preserved candidate.
- Any of the nine package names lacks an npm owner able to configure trusted publishing.
- The workflow can reach publication from a non-main ref or a SHA other than current `origin/main`.

## Maintenance notes

OIDC configuration lives partly on npm.org; reviewers must verify that external state before the first real run. Resumability is based on integrity equality, not merely version existence. Keep the launcher-last invariant even if publication becomes parallelized later.
