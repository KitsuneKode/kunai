# Plan 029: Replace declared release gates with evidence and native platform smokes

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` and `superpowers:verification-before-completion`.
>
> **Drift check (run first):** `git diff --stat a6214d30..HEAD -- .github/workflows/release.yml scripts/release-confirmation-gate.ts scripts/verify-release-artifact-directory.ts apps/cli/test/unit/scripts`

**Goal:** Release confirmation consumes tamper-evident outputs from every required gate, and host-native smoke jobs execute the Windows, macOS, and Linux candidates before publication.

**Architecture:** Each gate emits a small JSON evidence document bound to version, commit SHA, workflow run, artifact name, and digest. Confirmation validates and aggregates those documents; it never manufactures `passed` values. A platform matrix downloads the preserved candidate and executes only the binary native to that runner.

**Tech stack:** GitHub Actions matrices/artifacts, Bun verification scripts, SHA-256 evidence.

## Status

- **Priority:** P1
- **Effort:** L
- **Risk:** MED
- **Depends on:** plans 026, 027, 028
- **Category:** CI, tests, security
- **Planned at:** commit `a6214d30`, 2026-07-22

## Current state and constraints

- `scripts/release-confirmation-gate.ts:290-300` returns `"passed"` for every gate and passes it into evaluation at approximately line 412.
- `scripts/verify-release-artifact-directory.ts` validates checksums for all assets but executes only Linux x64.
- `release.yml` builds all targets on Ubuntu; it does not execute Windows or macOS binaries.
- The approved release design explicitly defers code signing and complete ARM/musl execution parity. Do not turn those into a 0.3.0 blocker.

## Scope

- Modify `.github/workflows/release.yml`, `scripts/release-confirmation-gate.ts`, `scripts/verify-release-artifact-directory.ts`.
- Create `scripts/release-gate-evidence.ts` and focused tests under `apps/cli/test/unit/scripts/`.
- Pin third-party actions used in `release.yml` to immutable commit SHAs, retaining the human-readable major tag in comments.
- Do not add signing/notarization, public relay checks, or emulation for every cross target.

## Evidence contract

```ts
export interface ReleaseGateEvidenceDocument {
  schemaVersion: 1;
  gate:
    | "repository"
    | "package"
    | "installer"
    | "npmGlobalInstall"
    | "compiledPlayback"
    | "readmeCommands"
    | "liveProviders"
    | "releaseAssets"
    | "nativePlatforms";
  status: "passed";
  version: string;
  commitSha: string;
  runId: string;
  artifactName: string;
  artifactSha256: string;
  generatedAt: string;
}
```

Reject unknown gates, duplicate gates, non-passed status, stale/wrong SHA or version, malformed digest, and missing required gates.

## Tasks

### Task 1: Test evidence validation before changing workflow YAML

- [ ] Add tests for one complete evidence set and for missing, duplicate, wrong-version, wrong-SHA, failed, and malformed-digest documents.
- [ ] Delete the test helper assumption that callers may simply supply an object of `gate: "passed"` declarations.
- [ ] Run `bun run --cwd apps/cli test test/unit/scripts/release-confirmation-gate.test.ts`; expect new tests to fail.

### Task 2: Implement evidence documents and remove manufactured success

- [ ] Implement parse/validate/aggregate functions in `release-gate-evidence.ts` with the exact interface above.
- [ ] Change the confirmation CLI to accept evidence file paths/directories, hash the referenced artifacts, and pass only validated aggregate results to `evaluateReleaseConfirmation`.
- [ ] Remove `allPassedGates()` completely; add a source-contract test that rejects its return or any equivalent hardcoded map.
- [ ] Run confirmation-gate tests; expect all pass.
- [ ] Commit: `fix(release): require evidence for confirmation gates`.

### Task 3: Add blocking native runner smokes

- [ ] Add a matrix job with `ubuntu-latest`, `windows-latest`, and `macos-13` (x64) plus an available GitHub-hosted macOS arm64 runner if the repository plan supports it.
- [ ] Download the preserved binary artifact, verify `SHA256SUMS`, mark Unix files executable, and run the host binary with an isolated temporary config: `kunai --version` and `kunai --help` must both exit 0.
- [ ] On Ubuntu, additionally run the musl binary in the existing Alpine/Docker lane if Docker is available; otherwise record musl as non-blocking checksum/build evidence per the approved scope.
- [ ] Emit the `nativePlatforms` evidence only after every required matrix leg passes; confirmation must depend on it.
- [ ] Add workflow-contract tests proving the three OS runners, both commands, checksum verification, and confirmation dependency.
- [ ] Commit: `ci(release): execute native candidates on host platforms`.

### Task 4: Wire every existing gate to real evidence

- [ ] Make all eight existing gates (`repository`, `package`, `installer`, `npmGlobalInstall`, `compiledPlayback`, `readmeCommands`, `liveProviders`, `releaseAssets`) upload JSON evidence and the artifact/log it hashes. Use immutable artifact names containing version and commit SHA.
- [ ] Keep native script coverage in `installer`; keep the hermetic local-tarball execution from plan 026 in the distinct `npmGlobalInstall` gate.
- [ ] Preserve provider signoff freshness/lane validation and bind its run ID to the confirmation input.
- [ ] Download all evidence in the confirmation job and pass explicit paths to `release:confirmation:check`.
- [ ] Test that removing any one upload/dependency makes the workflow contract fail.

### Task 5: Pin release workflow actions

- [ ] Resolve the commit behind each approved action major (`changesets/action@v1`, `actions/upload-artifact@v4`, `actions/download-artifact@v4`, `softprops/action-gh-release@v2`) using the GitHub API.
- [ ] Replace tags with full 40-character SHAs and comments such as `# actions/upload-artifact@v4`.
- [ ] Add a contract assertion that every non-local `uses:` entry in `release.yml` matches `owner/repo@<40 hex>`.
- [ ] Do not upgrade action majors in the same change.
- [ ] Commit: `ci(release): pin third-party actions by commit`.

### Task 6: Full verification

- [ ] Run focused script tests, then `bun run test`, `bun run typecheck`, `bun run lint`, `bun run fmt`, and `bun run build`; expect exit 0.
- [ ] Dispatch a candidate-only dry run from current `main`; expect all evidence artifacts and no npm publish/tag/release mutation.
- [ ] Run `git diff --check`; expect no output.

## STOP conditions

- A gate cannot identify the exact commit and version it tested.
- Evidence can be edited after the producing job without invalidating its digest.
- Windows or macOS `--version` fails for the preserved candidate.
- Adding a platform runner would require signing/notarization or paid infrastructure not already authorized.
- An action tag cannot be resolved to an upstream commit through an authoritative repository reference.

## Maintenance notes

Gate names are a schema: adding one requires a producer, validator test, workflow dependency, and confirmation requirement. Checksums prove artifact identity, not publisher identity; signing remains an explicitly deferred follow-up.
