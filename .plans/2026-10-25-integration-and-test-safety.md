# Integration, test privacy and checkout recovery

Status: ACTIVE. Existing watching candidate based on `f3e893ce7`; fetched main
`16bf2e705`. User authorizes concrete review/privacy/CI fixes and checkout cleanup,
while all original dirty work and unmerged commits must survive.

## Goal and ownership

Prove test installs and automated checks cannot add production analytics identities;
reconcile the other audit thread and actual CodeRabbit findings; restore a clean,
current main in the root checkout; reclaim only disposable, integrated worktrees.
One analytics worker owns the analytics contract/runtime/tests and test helper
privacy seams. Parent owns integration/reviews, CI workflows, Git safety and space.
No remote merge or release publication. No rewriting other threads or live profiles.

## Tasks

1. Pin fetched refs, root/candidate dirty state, all 75 worktrees, active T3 work,
   PR668 head and full review threads. Measure each checkout and classify ancestry,
   ignored evidence and unique changes before deletion. Archive root dirty binary
   patch and exact files under a private task directory before moving root to main.
2. Analytics: trace installer/test entrypoints through profile isolation, consent,
   identity generation and sender. Reproduce defects without production requests.
   Gate live smoke to safe test endpoints; preserve real explicit opt-in. Add
   failing-first regression coverage and owning docs. Parent checks CI discovery,
   cache/required checks and fixture truth without weakening gates.
3. Review PR668 `f20c74a20` against both its base and the tested candidate. Classify
   already-fixed, valid or obsolete comments. Integrate only independent changes
   that survive current contracts; no wholesale old-branch import. Address missing
   empty-state announcements, picker sizing and any verified security/provider
   regressions with focused behavior tests. Preserve modern consent/header scopes.
4. Restore root main by preserving dirty work, retaining the original audit branch
   and fast-forwarding the existing main. Existing candidate absorbs only the two
   missing main status commits after preserving its patch. Remove only clean,
   integrated, inactive checkouts with disposable ignored content; retain branches
   and archive unique ignored evidence. Never force-remove unmerged or dirty work.
5. Run meaningful focused tests per fix, fresh forced types/lint/tests/build and
   docs/format checks for the final candidate. Record disk reclaimed, exact refs,
   CodeRabbit disposition and remaining platform/live gates. Publish no completion
   claim from old cached runs, a review summary or fixture-only playback.

## Local outcome

Latest inventory, safe cleanup, merge order and qualification are recorded in
[the October 26 readiness record](../.release/repository-readiness-2026-10-26.md).

Checkout recovery and safe pruning are complete; analytics/CI and review fixes
are implemented and locally verified. See
[qualification](../.release/integration-and-test-safety-2026-10-25.md) for evidence
and remaining hosted/native gates. Keep this owner active until the reconciled
PR has passed hosted checks and its integration decision is recorded; do not
turn this into a second implementation checklist.

PR668 at `fb41e7bf6` was pushed normally after 9,365 tests passed, with 61 skips
and zero failures (26 test tasks, zero cached). Hosted formatting, types and lint
have passed on this head; remaining checks and review are pending.

Its October 26 follow-up adds updater reader/listener cleanup, bounded IPC
frames, dispatch-input quoting, finite media-box offsets, stable dependency
refreshes and Kanna SVG/motion controls. All apps share TypeScript 7.0.2 and
Bun 1.4.4 declarations. The actual Changesets 3 release-plan reader passes;
private versioning and version-PR-only push behavior are retained.

The reconciled source changes are also integrated narrowly into this dirty
watching candidate; earlier work is preserved. Fresh combined verification is
9,630 passes / 62 skips / zero failures, 58 tasks and zero cached. PR668 has its
own separate 9,363-pass forced qualification. Both audits are clean. See the
qualification record for final heads, push/build results and evidence limits.

Remaining: final-head hosted checks and CodeRabbit review; the user handles
GitGuardian's historical fixture classification. The complete watching candidate
still needs review/integration and real provider, terminal and physical mobile
qualification. Manga/comic reading, YouTube discovery/channels and the remaining
live-TV product work are not completed by this safety pass. Ink 8 needs a
runtime-preserving bundle optimization; Oxlint/plugins 1.89 needs a qualified
React lifecycle migration. No budget, rule or baseline was weakened to accept
those versions. No release or remote main merge was performed.

The next review follow-up, `ba7d86274`, validates complete known fMP4 sample
extents, defaults and safe box-end arithmetic. It was pushed after 9,378 tests
passed with 61 skips and no failures; three unchanged docs/mobile tasks were
cached. Fresh provider/build checks and a decoded local fMP4 fixture pass.
The old `1203b7f` platform alert is historical. Current-head hosted qualification
and review remain active; do not merge based on an earlier head's checks.

Hosted Test on `ba7d86274` subsequently exposed an updater stall timer spanning
local file IO. Follow-up `22d9df51c` limits that timer to response reads; both
open/write regressions fail before the fix. Stall/retry tests now deliver
callbacks explicitly and run on Windows as well. The PR parallel CLI unit suite
passes 6,642 tests / one skip; native-installer tests, CLI types, complete
preflight and fresh ten-task build pass. Its 3,166,217-byte bundle remains under
the unchanged cap. This candidate has the same narrow fix and passes native
installer tests and CLI types. Await final-head hosted CI and review rather than
using earlier-head results.

`22d9df51c` is now pushed with a clean synchronized PR checkout. Its normal push
gate passes 9,380 tests / 61 skips / zero failures, with two unchanged tasks
cached. Final-head hosted checks and CodeRabbit review remain pending.

A later current-head Windows failure occurs before tests in a restored Bun
global-store dependency link. `f0f83ef86` keeps Windows dependency links local,
rotates/partitions the install cache and requires an installed formatter probe.
Patch verification remains mandatory. New setup tests, analytics contracts,
CLI types/preflight, actual patched consumers and an isolated corrupted-store
mechanism check pass. Native Windows recovery still needs the new hosted run;
CodeRabbit remains rate-limited and GitGuardian remains user-owned.

`f0f83ef86` is pushed; its normal gate passes 9,383 tests / 61 skips / zero
failures, with two unchanged tasks cached. Await the new Windows/platform run
and final-head review.
