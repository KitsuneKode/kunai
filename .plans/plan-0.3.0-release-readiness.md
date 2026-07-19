# Plan — 0.3.0 release readiness

Written 2026-07-20. Every claim below was checked against `main` that day and
carries a file reference so the next session can re-verify rather than trust.

Ordering is by risk, not by effort. Installer first: it is the only subsystem
where a bug is unrecoverable by the tool itself — a user with a broken `kunai`
cannot run `kunai upgrade` to fix it.

---

## A. Installer and distribution (P0)

### A1. `install.sh` / `install.ps1` have zero test coverage

399 + 237 lines of shell that own PATH, on-disk layout, checksum verification
and manifest writing. Nothing under `test/` executes them. Every existing update
test (9 files under `apps/cli/test/unit/services/update/`) mocks the filesystem
and network, so none of them prove an install works.

**Do:** a containerized scenario harness. Not on the dev machine — `install.sh`
writes to `~/.local/bin` and `~/.local/share`, so local runs either pollute the
real install or force trusting env overrides.

Hermetic testing is possible because the installer takes overrides:
`KUNAI_DL_BASE`, `KUNAI_RELEASES_API`, `KUNAI_BIN_DIR`, `KUNAI_DATA_DIR`
(`install.sh:17-24`). A fake release server satisfies all of them.
Started already at `test/install/fake-release-server.ts` (serves the tag_name
JSON, the `kunai-<os>-<arch>[-musl]` assets, and a matching `SHA256SUMS`).

Scenarios, in priority order:

1. **npm → native contamination.** Install via npm, then natively. This is where
   `cleanupNpmInstallations` (`native-installer/cleanup-npm.ts`) either works or
   leaves two `kunai` on PATH shadowing each other. It is best-effort and
   swallows errors by design, so it can fail silently today with nothing to
   catch it. Highest real-world likelihood.
2. **Fresh install** — version, launcher path, manifest `channel: binary` /
   `layout: versioned`.
3. **Upgrade N-1 → N** — version advances, old version pruned per
   `VERSION_RETENTION_COUNT` (`install-layout.ts:7`).
4. **Flat → versioned migration** — `native-installer/migrate-flat-install.ts`.
5. **Uninstall** — `run-uninstall.ts` leaves nothing behind.
6. **Interrupted upgrade** — kill mid-download, re-run. Must never leave a
   half-written binary on PATH. `version-lock.ts` + the staging root are meant
   to cover this; nothing proves it.

**Scope limit to state honestly in the harness:** the served asset is a stub
script, not a real build. These scenarios prove install _mechanics_; they do not
prove the shipped binary runs. That is #30's job.

### A2. "Only one binary" — the invariants to assert

After every scenario, not just at the end:

- `which -a kunai | wc -l` is exactly 1
- the resolved path is the launcher, and it points into `versionsDir`
- `ls versionsDir` count ≤ `VERSION_RETENTION_COUNT` plus anything locked
- `detectInstallMethod()` reports `binary`, not `npm-global` / `unknown`
  (`services/update/install-method.ts:17`)
- no `node_modules/@kitsunekode/kunai` remains anywhere on PATH

### A3. Release checksums can be generated locally — DONE (verified 2026-07-20)

Was: `.release/kunai-v0.2.6.json` absorbed local build checksums whenever
`build-binaries.ts` ran, so a release could ship sums matching a laptop build
rather than the published artifact — making user-side verification theater.

Fixed by `shouldWriteReleaseChecksums` (`scripts/release-binary-checksums.ts`):
the merge only runs under `CI` or an explicit `KUNAI_WRITE_RELEASE_CHECKSUMS=1`,
and `build-binaries.ts:147` honors it with a skip message. Verified false for
local / `CI=""` / `CI="   "`, true for `CI=true` and the opt-in. Covered by
`apps/cli/test/unit/scripts/distribution-contract.test.ts:46-62`.

### A6. `install.sh` does not prune old versions

`VERSION_RETENTION_COUNT` is enforced by `native-installer/cleanup-versions.ts`,
which runs on the in-app upgrade path. `install.sh` writes into
`versions/<v>/` and re-points the symlink without pruning, so repeated shell
installs accumulate versions indefinitely. Same split that caused A1's npm
shadowing bug: the in-app installer cleans up, the shell installer does not.
Quantify with the upgrade scenario before deciding whether it needs fixing.

### A4. Auto-update paths without execution coverage

`BinaryAutoUpdater.runOnce` (`services/update/BinaryAutoUpdater.ts:31`) branches
into disabled / snoozed / fresh / up-to-date / installed / pending-restart /
error. The branch worth pinning explicitly is **pending-restart**: if the user
never restarts, does it re-download every 30 minutes? `getPendingRestartVersion`
returns early so probably not, but that is a reading, not a test.

### A5. Update-notification chain has no end-to-end test

The pure mapper (`notification-update-signal.ts`) is tested. The chain is not:
UpdateService check → signal → `NotificationEngine` dedupKey `app-update:<v>` →
overlay render → `update-app` action → `openReleasePage(version)`. Testable with
a fake version resolver, no network. Same bug class as the stranded play-now
intent fixed in `a564abcf`.

---

## B. Release pipeline / the 0.3.0 gate

### B1. #26 — one real `workflow_dispatch` of `release.yml` reaching publish

The composite-checkout fix is committed and `Build all release binaries` now
succeeds (1m3s, previously failed instantly). `Release` still failed, but only
on B2 below. **Only the repo owner can run this.** It is the actual release
blocker.

### B2. #33 — `process-shutdown.test.ts` fails on CI, passes locally

`kill() failed: ESRCH`. Root cause still unknown. The "stdin EOF tears down the
pty" hypothesis was tested and **disproven**. The test now captures the pty
transcript and fails with a real diagnostic plus a liveness check.
**Next step: read the next CI failure output** — it will name the cause.

---

## C. Queue and notification UX

### C1. DONE this session

- Unified queue restore: one path for the overlay `r` key and the queue-recovery
  notification, bounded to the restored session's own window so a title watched
  _after_ that queue stopped is never promoted to its head
  (`domain/queue/restore-queue-session.ts`, `app-shell/queue-restore.ts`).
- Restore now promotes the interrupted episode to the queue head, derived from
  history at restore time (crash-safe: survives a SIGKILL that never reaches the
  shutdown coordinator).
- Placement-driven auto-advance precedence: only `"next"` placement
  (`INTERRUPTING_QUEUE_PRIORITY`, `domain/queue/QueuePlanner.ts`) outranks the
  series' own next episode. Watchlist refills sit at 0 and wait.
- `formatQueueEntryLabel` collapses three drifted "Next: …" formatters.
- Removed dead `enqueueBatch` / `markCurrentPlayed`.

### C2. Notifications cannot start playback — Enter only queues

**Diagnosed, reverted, not shipped.** `play-now` has a label, a detail, full
router support, a confirmation guard for active playback, and
`playback.playNow` wired at `root-overlay-shell.tsx:1069`. It never appears
because `defaultNotificationActionIds` (`NotificationService.ts:142`) omits it,
and the primary action is the first non-dismiss entry in that list.

Two halves are required, and the second is the one that is easy to miss:

1. Add `play-now` to the media action list, first, so Enter plays.
2. Derive the action list at **read** time. Lists are frozen into each row at
   creation (`actionJson`), so an existing inbox stays stuck with whatever
   shipped that day. Constraints found by breaking tests during the attempt:
   - malformed/empty stored actions must still collapse to dismiss-only —
     do not invent actions for a degraded record
   - **unknown** kinds must keep their stored list, or an older build silently
     re-labels a newer build's notification type
   - the closed kind set is the five in `notification-sink.ts:3`

This is a product decision (should Enter play or queue?) plus ~10 tests that
legitimately pin the current behavior. Worth doing deliberately, not in passing.

### C3. Queue terminal QA

Never run in a real terminal: an interrupting `queue-next` firing mid-series
with its countdown; restore promoting a resume head and seeking to the saved
position; the new `r` status line rendering and clearing on its 2.5s timer.
Run in kitty **and** one plain terminal (#18).

### C4. Doc corrections

`.plans/handoff-queues-and-remaining-work.md` §2 is now wrong in two places:
reorder/remove were already bound (`root-overlay-shell.tsx:1384-1418`), and
notifications already had queue actions. Leaving it stale re-poisons the next
session exactly as the original wrong claim did. Also update
`.plans/plan-implementation-truth.md`.

---

## D. Testing and gates

### D1. #30 — E2E playback harness

30s of real playback (movie / series / anime) against the **compiled binary**,
plus mpv IPC assertions. Highest long-term safety value: this class of test
caught the bundle-budget break on 2026-07-20 that every unit test missed.

### D2. Gate hygiene

Current baseline: typecheck 14/14, lint 0/0, **2795 pass / 0 fail**, build clean.

- Turbo caches test results — always `--force` before trusting green. A cached
  pass previously masked a real boundary violation.
- `bun build --compile` can leave a mode-`----------` `.bun-build` temp file in
  `apps/cli/`; turbo then dies with `Permission denied (os error 13)` and no
  useful message. `rm -f apps/cli/.*.bun-build`.
- npm bundle budget is 2688 KiB (`apps/cli/scripts/build-shared.ts`), raised
  from 2560 for the JPEG decoder. Only move it for a decision of that weight.

### D3. #29 — packaging boundaries

`apps/cli/src` is 679 files (app-shell 220, services 201) against
`packages/core` 17, `types` 2, `schemas` 1. Decide what genuinely belongs in
packages. Continuation/history authority is app-resident today.

### D4. Concurrent writes to `main`

Three commits landed during this session that were not from this workspace, one
of which rewrote an import inside a file created minutes earlier. Confirm nobody
else is mid-flight in `domain/queue` before committing, or expect conflicts in
exactly the touched files.

---

## E. Docs and README

### E1. #32 — README reads as a dev doc, not a product page

Should answer, above the fold: what Kunai is, what it does for a user, how to
install in one line, and what it looks like. Needs a cast or GIF, real usage,
and the supported/unsupported boundary from `.docs/experience-overview.md`.

### E2. Install instructions must match reality

Whatever the README claims about installing has to be the path A1's harness
actually exercises. Today nothing enforces that they agree.

---

## F. Launch assets

Deliberately last: none of this matters if A and B are not solid, and a launch
that drives installs into a broken installer is worse than no launch.

### F1. Terminal recording

`vhs` (charmbracelet) is the right tool for a CLI — scriptable `.tape` files,
reproducible, regenerable per release, and diffable in review. Prefer it over a
screen capture that must be re-shot by hand every time the UI changes. One
canonical tape per surface: search → play, Up Next queue, calendar, discover.

### F2. The demo has to show the loop, not the features

The compelling 30 seconds is: type a title → it plays in mpv → episode ends →
Next Up counts down → next episode starts. That is the product. A feature tour
is not.

### F3. Platform framing

- **Reddit** (r/anime, r/selfhosted, r/commandline): technical honesty wins.
  Lead with architecture and the terminal-first argument, be explicit about what
  it does not do, and expect provider-legality questions — have a straight
  answer ready from `.docs/experience-overview.md`.
- **Twitter/X**: the recording carries it. One loop, no narration, tight.
- Both need the install one-liner to work on a clean machine, which is A1.

---

## Suggested order

1. A1 scenario 1 (npm contamination) — likeliest real breakage
2. A3 (checksum provenance) — correctness, cheap, blocks a trustworthy release
3. B2 → B1 — the actual 0.3.0 gate
4. C2 + C3 — the UX gaps a first user meets immediately
5. E1 — README as a product page
6. D1 — E2E harness
7. F — launch assets, only once 1-5 hold
