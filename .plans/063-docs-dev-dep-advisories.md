# Plan 063: Dependency hygiene follow-ups

## Status

- **Status:** PARTIAL — advisory fixes and blocking PR/release audits are
  implemented in the watching candidate; release-age policy and scheduled
  reporting remain proposed.
- **Priority:** P2
- **Current-code check:** `904e4e121`, 2026-10-27. The fresh
  `DO_NOT_TRACK=1 bun audit --json` run exited zero with `{}`.
- **Scope:** install policy and maintenance reporting. Keep unrelated dependency
  upgrades and framework migrations separate.

## What is already implemented

The original September advisory table is obsolete. The current locked tree
reports no advisories; this is a registry audit result, not proof that the
application has no exploitable defects.

`package.json` declares `audit:dependencies` as `bun audit`.
`.github/workflows/release-guard.yml` invokes it on pull requests, and
`.github/workflows/release.yml` invokes it before release work. These are
blocking checks. Do not replace them with an informational job or describe the
repository as having no dependency monitoring.

The candidate pins Bun 1.4.4 and TypeScript 7.0.2. Existing dependency policy
and audit semantics are documented in
[repo-infrastructure.md](../.docs/repo-infrastructure.md).

These changes are still subject to the release train's integration gates; a
candidate implementation is not evidence that it is on remote main or released.

## Remaining work

### 1. Decide and verify the release-age policy

Root `bunfig.toml` currently configures the isolated linker and shared store;
it does not set `minimumReleaseAge`. A seven-day floor remains a proposal.

Before implementing it:

1. Check the pinned Bun version's official install documentation for the option
   and its treatment of existing lockfiles and explicit version requests.
2. Verify cold frozen installs and dependency refreshes in disposable storage.
   Preserve the existing linker/store settings.
3. Define a narrow, documented urgent-security-patch exception. A freshness
   delay must not silently prevent an approved vulnerability fix.
4. Exercise the Linux, macOS and Windows install paths before claiming parity.

Do not add an unverified setting or blanket package exclusion solely to make
installation pass.

### 2. Add scheduled reporting if needed

PR/release audits do not periodically recheck an unchanged main branch. A
weekly informational report remains useful for that case; no dedicated
dependency-audit workflow currently exists.

Use the repository's pinned toolchain, read-only permissions and
`DO_NOT_TRACK=1`. Retain machine-readable output and show whether an audit was
clean, found advisories, or failed to obtain a valid report. An unavailable
registry or malformed response must never be presented as a clean audit.

Keep existing blocking PR/release audits. The scheduled job must not publish
packages, send analytics or automatically open issues. Validate its summary and
artifact behavior with clean, vulnerable and operational-failure fixtures, then
qualify the hosted workflow separately.

## Verification and completion

- Refresh `bun run audit:dependencies` before touching the lockfile; do not
  reapply the removed September advisory table.
- Change dependencies only for a current, verified advisory or an independently
  approved upgrade, and validate the owning workspace.
- Run fresh package or forced workspace checks when runtime dependencies change.
- Verify doc paths and formatting when updating this plan or its owning docs.
- Archive this plan only after the remaining policy/reporting decisions are
  implemented or explicitly declined; retain one roadmap row for any residue.
