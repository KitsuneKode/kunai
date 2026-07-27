# Platform Parity Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the confirmed platform runtime and CI coverage gaps for Kunai's supported Linux, macOS, and Windows targets.

**Architecture:** Centralize platform command selection behind injectable helpers, then make CI execute the native dependencies and package entry points that production uses. Reuse existing atomic persistence and release-target abstractions rather than adding parallel implementations.

**Tech Stack:** Bun, TypeScript, Bun test, GitHub Actions, Bash/PowerShell.

## Global Constraints

- Preserve all unrelated and pre-existing WIP.
- Use `bun run --cwd apps/cli test:file -- <test>` rather than root `bun test`.
- Keep clipboard failures best-effort and OAuth URLs manually usable.
- Do not route user or provider URLs through a command interpreter.
- Stage only files belonging to this plan.

---

### Task 1: Shared host command contracts

**Files:**

- Modify: `apps/cli/test/integration/helpers/readme-command-harness.ts`
- Modify: `apps/cli/src/infra/clipboard.ts`
- Modify: `apps/cli/src/infra/os/external-open.ts`
- Modify: `apps/cli/src/services/sync/AniListAdapter.ts`
- Modify: `apps/cli/src/services/sync/TmdbAdapter.ts`
- Test: `apps/cli/test/unit/helpers/pty-command.test.ts`
- Create: `apps/cli/test/unit/infra/clipboard.test.ts`
- Modify: `apps/cli/test/unit/infra/os/external-open.test.ts`

**Interfaces:**

- Consumes: `buildPtyCommand(command, transcript, platform)` and `openExternalUrl(url)`.
- Produces: injectable clipboard command/runtime contracts and direct Windows URL opening.

- [ ] Write failing tests proving Windows clipboard commands and a metacharacter-rich URL remain one opaque argument to a direct opener.
- [ ] Run each test and confirm it fails because the platform branch is missing.
- [ ] Implement explicit Windows clipboard commands, reuse `buildPtyCommand`, switch Windows browser launch away from `cmd.exe`, and route both sync adapters through the shared opener.
- [ ] Run the focused unit and integration tests to green.

### Task 2: Native CI and release execution

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `apps/cli/test/integration/npm-launcher.test.ts`

**Interfaces:**

- Consumes: the existing host binary build and `apps/cli/scripts/npm-launcher.mjs` vendor fallback.
- Produces: mandatory native mpv IPC, Windows launcher execution, Windows ARM64 release smoke, and correct path routing.

- [ ] Add a Windows-compatible launcher fixture test that fails before the CI entry-point gap is closed.
- [ ] Add native mpv provisioning/assertions to Windows and macOS parity jobs.
- [ ] Gate parity jobs on both CLI and installer changes, including the shared setup action.
- [ ] Stage the built Windows executable into the launcher vendor layout and execute the launcher with Node in Windows CI.
- [ ] Add `windows-11-arm` to the native release smoke matrix.
- [ ] Validate workflow syntax/contracts and run the launcher tests.

### Task 3: Secret persistence and macOS verifier portability

**Files:**

- Modify: `apps/cli/src/infra/storage/FileStorage.ts`
- Modify: `apps/cli/test/unit/infra/storage/FileStorage.test.ts`
- Modify: `apps/cli/scripts/verify-host-binary.sh`
- Modify: `apps/cli/scripts/verify-release-binaries.sh`

**Interfaces:**

- Consumes: `writeAtomicSecretJson(targetPath, value)`.
- Produces: owner-only POSIX config files and stock-macOS-compatible verification commands.

- [ ] Write a POSIX mode regression test and confirm ordinary JSON persistence fails it.
- [ ] Persist config through the existing restricted atomic writer while leaving Windows ACL handling unchanged.
- [ ] Replace unconditional GNU checksum use with a `sha256sum`/`shasum` selector and replace `mapfile` with a Bash-3-compatible read loop.
- [ ] Run storage tests and shell syntax checks.

### Task 4: Whole-change verification and commit

**Files:**

- Review every file changed by Tasks 1-3 and the previously approved shutdown PTY fix.

- [ ] Run targeted regression tests and the full CLI/storage suites.
- [ ] Run `bun run typecheck`, `bun run lint`, `bun run fmt`, and `bun run build`.
- [ ] Inspect `git diff --check`, final diff, and status for unrelated WIP.
- [ ] Stage only platform-hardening files and create one scoped commit.
