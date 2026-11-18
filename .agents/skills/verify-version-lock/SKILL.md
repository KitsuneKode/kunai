---
name: verify-version-lock
description: Model-check the native installer's per-version lock (tryAcquireVersionLock in apps/cli/src/services/update/native-installer/version-lock.ts) with TLA+/TLC. Use whenever a change touches that function, its stale/grace judgement, the `.claim` reclaim protocol, or release — or when a CI flake suggests two processes held one lock. One command; it also proves the check can still fail.
---

# Verify the version lock

**The promise.** At most one live process believes it holds a version lock,
and while it does, the lock file names it.

**The harm if broken.** Two installers or updaters write the same version
directory at once: a torn binary, or a `version.json` that describes bytes it
does not have. It has broken before — a torn read of a freshly created, still
empty lock let a second process reclaim it (#697), and it surfaced as a flaky
CI race.

Tests reach this rarely because the bad interleavings are a few syscalls wide.
The model checks every interleaving of three processes, with a crash allowed
between any two steps.

## Run it

```sh
.agents/skills/verify-version-lock/scripts/check.sh
```

About 5 seconds. It needs `TLA2TOOLS` + `JAVA`, or `mise` (it installs the
pinned TLC 1.7.4 and Temurin 25 once, with network). Exit 0 means all of:

- `PASS  model` — TLC found no violation (about 650k distinct states);
- three `PASS  break caught` lines — each deliberately broken variant still
  violates the invariant, so the model has not lost the ability to fail:
  the pre-#697 "empty lock is corrupt at once" judgement, the identity
  recheck removed, and an empty `.claim` treated as abandoned;
- the committed PlusCal translation is current.

## Does my change touch it?

Covered code (sync commit `02eaba543`, the head of #697):

| Model step(s)                    | Code in `version-lock.ts`                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| `Exists`, `CreateWx`, `FillWx`   | `tryAcquireVersionLock`: `existsSync(path)`, then `writeFile(path, …, { flag: "wx" })` |
| `StatJudged`, `ReadJudged`       | `statOrNull(path)`, `readLockContent(path)`                                            |
| `StaleRead`, `StaleStat`         | `isLockStale` → `readLockContent`, `isProcessAlive`, `isPastCorruptGrace`              |
| `ClaimCreate` … `NextAttempt`    | the two-attempt `.claim` loop: `wx` create, read, grace, re-read, `rm`                 |
| `RecheckStat`, `RecheckRead`     | the `sameFile` / `sameContent` recheck (both stats must be non-null)                   |
| `Truncate`, `Rewrite`, `RmClaim` | in-place `writeFile(path, content)`, `finally { rm(claimPath) }`                       |
| `ReleaseRead`, `ReleaseRm`       | `release`: read, `rm` only if the file still names us                                  |

If your diff changes any of those lines — adds an await, moves a check,
changes what counts as stale or past grace, changes the order of create and
write — the model must change with it. Each filesystem syscall is one model
step; never merge two into one atomic step, because other processes run
between them.

## When it fails

1. **Real model fails.** TLC prints the shortest trace. Replay it against the
   code one step at a time. If a step cannot happen in the code, the model is
   wrong — fix the model and say what was wrong. (The first draft of this
   model failed exactly that way: it compared two null stats as "same file",
   which the code's `sameFile` rejects.) If every step can happen, it is a bug:
   describe the trace in the code's words and write a regression test.
2. **A break is not caught.** The model no longer describes the protection
   that break removes. Fix the model before trusting any pass.
3. **Translation stale.** Run
   `java -cp tla2tools.jar pcal.trans -nocfg model/VersionLock.tla` and commit.

Never weaken an invariant or remove a break to get a pass. For a readable
chart of a trace, use pstack's `/statechart` on the model.

## Assumptions and what is not covered

- **Time** is one assumption, `GraceHonored`: a live writer finishes a file it
  created within `LIFECYCLE_CORRUPT_GRACE_MS` (250 ms). A writer stalled longer
  than that (suspended, swapping) is outside the model.
- **PID reuse** is not modelled: a dead holder's pid is never reassigned.
- **Not covered:** `cleanupStaleLocks`, the lifecycle-guard checks before and
  after acquisition, `inspectVersionLock`, Windows delete-while-open
  semantics, and the PowerShell/Bash installer implementations of the same
  protocol.
- **Bounds:** three processes, one acquire-and-release each.

When you confirm the model describes the code at a newer commit, move the
sync commit above to it — only then.
