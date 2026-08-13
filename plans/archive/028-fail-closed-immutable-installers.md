# Plan 028: Make bootstrap and in-CLI installers fail closed and version-immutable

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` and `superpowers:verification-before-completion`.
>
> **Drift check (run first):** `git diff --stat a6214d30..HEAD -- install.sh install.ps1 apps/cli/src/services/update/run-install.ts apps/cli/test/integration apps/cli/test/unit/services/update`

**Goal:** Every installer installs the version it records, downloads immutable release URLs, and stops immediately when a native command fails.

**Architecture:** Resolve `latest` once at the boundary, then pass the concrete version through download, package-manager command, manifest, and output. Shell and PowerShell retain separate syntax but share the same behavioral contract through table-driven harness scenarios.

**Tech stack:** POSIX shell, PowerShell, Bun tests, native installer service.

## Status

- **Priority:** P0
- **Effort:** M
- **Risk:** MED
- **Depends on:** plan 026
- **Category:** bug, reliability
- **Planned at:** commit `a6214d30`, 2026-07-22

## Current state

- `install.sh` and `install.ps1` resolve a concrete latest version but binary mode still downloads from mutable `latest/download` URLs.
- PowerShell `Invoke-Step` invokes native commands without checking `$LASTEXITCODE`, so it can print success and write metadata after failure.
- PowerShell npm mode calls `Install-Bun`, although the npm route executes a Node launcher around a Bun-compiled binary.
- `run-install.ts` accepts a requested version for npm/Bun methods but always executes an unversioned global install while recording the request.

## Scope

- `install.sh`, `install.ps1`
- `apps/cli/src/services/update/run-install.ts`
- `apps/cli/test/integration/helpers/installer-script-harness.ts`
- `apps/cli/test/integration/native-installer-docker.test.ts`
- `apps/cli/test/unit/services/update/run-install-ownership.test.ts`
- Add focused PowerShell harness tests in `apps/cli/test/integration/installer-powershell.test.ts` when `pwsh` is available; otherwise make the CI Windows job in plan 029 the blocking executor.
- Do not redesign the versioned native layout or add signing.

## Required behavior table

| Route  | Request | Command/download                          | Recorded version           |
| ------ | ------- | ----------------------------------------- | -------------------------- |
| binary | latest  | `/releases/download/vX.Y.Z/<asset>`       | X.Y.Z                      |
| binary | X.Y.Z   | `/releases/download/vX.Y.Z/<asset>`       | X.Y.Z                      |
| npm    | latest  | `npm install -g @kitsunekode/kunai`       | resolved installed version |
| npm    | X.Y.Z   | `npm install -g @kitsunekode/kunai@X.Y.Z` | X.Y.Z                      |
| bun    | latest  | `bun install -g @kitsunekode/kunai`       | resolved installed version |
| bun    | X.Y.Z   | `bun install -g @kitsunekode/kunai@X.Y.Z` | X.Y.Z                      |

## Tasks

### Task 1: Add failing installer-contract scenarios

- [ ] Extend the shell harness to assert latest binary URLs contain `/download/v<resolved>/` and never `/latest/download` after resolution.
- [ ] Add unit cases proving explicit npm/Bun versions appear in the command argv and that recorded versions come from the installed candidate, not unchecked input.
- [ ] Add a PowerShell fixture command that exits 17 and assert `Invoke-Step` throws/exits nonzero, does not print `Done`, and does not write an install manifest.
- [ ] Run the focused tests; expect failures matching all three current defects.

### Task 2: Pin binary downloads to the resolved release

- [ ] In both scripts, compute the asset base only as `"$DlBase/download/v$resolved"` after latest resolution.
- [ ] Keep checksum retrieval on the same concrete release path as the binary.
- [ ] Assert logs and saved `sourceUrl` contain the concrete version.
- [ ] Run installer harness tests; expect all URL cases to pass.
- [ ] Commit: `fix(installer): pin latest downloads to resolved release`.

### Task 3: Make PowerShell native failures fatal

- [ ] Implement `Invoke-Step` so it resets `$global:LASTEXITCODE`, invokes the action, captures both thrown exceptions and nonzero native exit status, and throws before printing completion.
- [ ] Use a target form equivalent to:

```powershell
& $Action
$code = $LASTEXITCODE
if ($null -ne $code -and $code -ne 0) {
  throw "$Description failed with exit code $code"
}
Write-Host 'Done'
```

- [ ] Ensure multi-command source installation checks each native command separately rather than hiding failures in one scriptblock.
- [ ] Run PowerShell tests on Windows/pwsh; expect failure fixture exit 17 and no manifest.
- [ ] Commit: `fix(installer): fail closed on PowerShell command errors`.

### Task 4: Honor package-manager version requests and prerequisites

- [ ] Change `run-install.ts` command construction so an explicit version produces `@kitsunekode/kunai@<version>` for npm and Bun.
- [ ] After a successful latest install, query the installed CLI/package metadata and record the observed concrete version; fail rather than writing `latest` or an unverified request.
- [ ] Remove `Install-Bun` from PowerShell npm mode. Require Node/npm for npm mode, Bun for Bun/source modes, and neither for binary mode.
- [ ] Add tests for explicit, latest, invalid version, command failure, and manifest-write ordering.
- [ ] Run focused unit/integration tests; expect all pass.
- [ ] Commit: `fix(update): install and record the same requested version`.

### Task 5: Full verification

- [ ] Run `bun run test`, `bun run typecheck`, `bun run lint`, `bun run fmt`, and `bun run build`; expect exit 0.
- [ ] Run the Docker native-installer smoke and Windows CI smoke from plan 029 before calling cross-platform work complete.
- [ ] Run `git diff --check`; expect no output.

## STOP conditions

- Latest resolution cannot produce a strict `X.Y.Z` before download.
- A package-manager route cannot observe the concrete installed version after success.
- Correct PowerShell failure handling would require suppressing a command's exit status.
- Tests attempt to modify the user's real global npm/Bun prefix or native install directory.

## Maintenance notes

Treat resolution and installation as one transaction: the concrete version is immutable after resolution. Future installer routes must be added to the behavior table and both script harnesses before implementation.
