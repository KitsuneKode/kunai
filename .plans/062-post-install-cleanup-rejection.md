# Plan 062: Make "fire-and-forget" a verifiable property, not a hope

> **Drift check (run first):** `git diff --stat 51f19b633..HEAD -- apps/cli/src/services/update/native-installer/install-latest.ts apps/cli/src/services/update/native-installer/cleanup-versions.ts apps/cli/src/services/update/native-installer/version-lock.ts`
> Mismatch → re-trace the `cleanupOldVersions` call tree; the finding is about a rejection path, not a line number.

Found during the audit-2 S6 distribution sweep (which the ledger never closed).

## Status

- **Priority:** P2
- **Effort:** S (062.1–062.2 are XS; 062.3 is a mechanical sweep)
- **Risk:** LOW — adds failure containment to paths that already promise it
- **Depends on:** none
- **Category:** correctness
- **Planned at:** `51f19b633`, 2026-09-19

## Why this matters

`cleanupOldVersions` is documented as safe to drop on the floor:

```ts
// cleanup-versions.ts:63-66
/**
 * Retain VERSION_RETENTION_COUNT newest eligible versions; delete older ones.
 * Fire-and-forget safe — errors are swallowed.
 */
```

The claim is almost true. Every I/O call in the tree is guarded except one hop:
`isVersionProtected` calls `tryAcquireVersionLock` (`cleanup-versions.ts:48`),
which opens with an unguarded `await mkdir(layout.locksDir, { recursive: true })`
(`version-lock.ts:167`). If `locksDir` is uncreatable — EACCES, read-only
mount, or a concurrent uninstall/purge that removed the directory between the
install's version lock and this cleanup pass — the function rejects.

Two callers disagree about whether that can happen:

```ts
// main.ts:743 — startup path
void cleanupOldVersions().catch(() => {});

// install-latest.ts:340 — post-install path
void cleanupOldVersions(layout);
```

A rejected fire-and-forget promise is an `unhandledRejection`, which
`main.ts:1222-1229` escalates to `getShutdownCoordinator().request({ fatal: true })`.
The failure lands *after a successful upgrade*: the new version is installed
and activated, then the process dies.

**The class, not the instance.** `main.ts` makes every unhandled rejection
fatal, and `void f()` is the codebase's fire-and-forget idiom — there are
~107 `void` callsites in `apps/cli/src` + `packages/*/src`. Most are safe by
construction (`MpvIpcSession.send` is resolve-only — `mpv-ipc.ts:246-288`
funnels every failure through `finish({ok:false})`); some are
self-contained handlers. But nothing *distinguishes* a resolve-only `void`
from a can-reject `void` — a reader has to trace every callee to know, and a
new one can regress silently. `typescript/no-floating-promises` exists in the
installed oxlint but `void` is its sanctioned escape hatch, so no lint rule
catches this. The fix is a written convention plus one classified pass.

## Current state

Rejection path: `installLatest` → `cleanupOldVersions` → per-version
`isVersionProtected` → `tryAcquireVersionLock` → `mkdir(locksDir)` throws →
propagates through `cleanupOldVersions` → rejected `void` promise.

All other nodes in the tree were checked and are guarded; `normalizedHostname`
and `processStartId` cannot realistically throw (every platform branch wraps
its probe in try/catch — `lock-owner-identity.ts:59-99`).

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Find all `void` sites | `grep -rnE '^\s*void [a-zA-Z_]' apps/cli/src packages/*/src` | the sweep's working list (~107) |
| Focused tests | `bun run --cwd apps/cli test:file test/unit/services/update/native-installer/install-latest.test.ts` | all pass |
| Full gates | `bun run typecheck --force && bun run test --force` | exit 0 |

## Scope

**In scope:**
- `apps/cli/src/services/update/native-installer/cleanup-versions.ts`
- `apps/cli/src/services/update/native-installer/install-latest.ts`
- The `void` callsite sweep + convention write-up (engineering-guide.md)
- Matching unit tests

**Out of scope:**
- Lock semantics in `version-lock.ts` — `tryAcquireVersionLock` throwing on
  `mkdir` is correct for its *named* callers; the fix belongs at the cleanup
  boundary.
- Retention policy itself.
- Enabling `typescript/no-floating-promises` — evaluated and rejected: `void`
  is its approved bypass, so it flags nothing here.

## Steps

### Step 1: Make the docstring true

In `cleanup-versions.ts` `isVersionProtected`, wrap the lock probe:

```ts
let lock: LockAcquireResult;
try {
  lock = await tryAcquireVersionLock(layout, version);
} catch {
  return true; // a version that cannot be inspected is a version we do not delete
}
if (!lock.acquired) return true;
await lock.release();
```

The direction matters: on probe failure, treat the version as *protected*.
That makes "errors are swallowed" a true statement for every caller, present
and future — not just these two.

### Step 2: Symmetric catch at the call site

Add `.catch(() => {})` at `install-latest.ts:340` so it matches `main.ts:743`
exactly. Belt-and-suspenders is the codebase's own pattern here (the docstring
claims the property *and* main.ts still catches).

**Verify:** `bun run --cwd apps/cli typecheck` → exit 0.

### Step 3: Classify the `void` inventory

One pass over `grep -rnE '^\s*void [a-zA-Z_]' apps/cli/src packages/*/src`
(~107 sites). For each, classify into one of three buckets and record it in the
PR body:

- **resolve-only** — callee never rejects (e.g. `MpvIpcSession.send`,
  resolve-only `new Promise` without a reject path). Leave as-is.
- **catch-terminated** — already carries `.catch`. Leave as-is.
- **can-reject, unguarded** — like the 062.1 case. Add `.catch` with the same
  deliberate-silence comment style this codebase uses.

The expected output is a short list of can-reject sites fixed, plus confidence
that the rest were checked — not a rewrite of the idiom.

### Step 4: Write the convention down

One paragraph in `.docs/engineering-guide.md` (the conventions section):

> `void f()` is fire-and-forget, and `main.ts` escalates every unhandled
> rejection to a fatal shutdown — so `void` is only legal on a promise that
> cannot reject (resolve-only construction) or that terminates in `.catch`.
> When in doubt, `void f().catch(() => {})` and say why in a comment.

This is the deliverable that prevents the next one.

## Test plan

- New: `cleanupOldVersions` resolves when `locksDir` is uncreatable (layout
  whose parent path is a regular file → mkdir ENOTDIR → assert the promise
  *resolves*; deterministic repro of the race, no `unhandledRejection`
  machinery needed).
- Regression: retention still deletes beyond `VERSION_RETENTION_COUNT` on the
  happy path (existing tests should cover this — check before writing a
  duplicate).

## Done criteria

- [ ] `isVersionProtected` treats a throwing lock probe as "protected"
- [ ] `install-latest.ts:340` carries `.catch(() => {})`
- [ ] Every `void` callsite is classified; can-reject ones have catches
- [ ] The convention paragraph lands in `engineering-guide.md`
- [ ] `bun run test --force` exits 0

## STOP conditions

- `cleanupOldVersions` grew a `try` around its whole body — reconcile; the
  fix may already have landed differently.
- `tryAcquireVersionLock` signature changed (e.g. returns a result type
  instead of throwing) — adapt Step 1 to the new contract.
- The sweep finds a *large* number of can-reject sites (say >10) — stop and
  reassess scope; that would be a different-sized problem than this plan
  assumes.

## Maintenance notes

- The classification list from Step 3 belongs in the PR body, not a tracked
  file — it rots immediately.
