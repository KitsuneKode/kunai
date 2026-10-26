# Integration and test safety qualification — 2026-10-25

Candidate: `fix/watching-release-readiness-20261022`, based on `0ad153866`.
This records local evidence, not a release approval or proof of every live provider.

## Analytics boundaries

The old opt-in analytics smoke defaulted to the deployed ingest. A fixed fixture
UUID is still a countable install; the ingest fixture verifies one new/lifetime
install from that identity. Historical production-count pollution was not
investigated, and no production analytics request or data change was made here.

The test preload, shadow storage helper, agent launcher, manual sandbox, native
Docker smoke and installer fixture roots now suppress analytics. All nine hosted
workflows set `DO_NOT_TRACK=1`, and Turbo explicitly retains it in strict tasks.
A real Turbo task with `CI=0` failed before that passthrough and passes after it.
The new smoke requires a numeric-loopback fixture URL with an explicit port,
refuses redirects and awaits acceptance. Actual user consent behavior is unchanged.
Arbitrary manual runs outside these helpers still need DNT and isolated roots.

Evidence: `/tmp/kunai-privacy-final-tests.log` (197 focused passes),
`/tmp/kunai-turbo-dnt-red.log`, `/tmp/kunai-turbo-dnt-green.log`, and
`/tmp/kunai-integration-agent-privacy.log` (2 agent privacy passes).

## Review reconciliation

Read the referenced audit thread and all 48 PR668 review threads against the real
callers. The latest two actionable findings were reproduced: empty palette results
needed a status outside the listbox, and both library viewport calculations needed
to reserve command-input space. Options retain virtual focus at the query input.
The rendered library regression verifies four fewer episode rows and protected
Escape input. Existing demo behavior and mobile input sizing survive reconciliation.

The proposed segment MIME fix was rebuilt around the existing bounded reader;
accepting three TS sync boundaries must not restore full-segment buffering.
Twenty-seven shared reachability tests pass, including cancellation when Range is
ignored and rejection of one/two sync-byte false positives. HTTP and SSRF gates
remain in place. This does not prove decoded playback of a live Movy stream.

Diagnostic key redaction now normalizes case/separators and covers password,
client-secret and private-key fields. Invalid TTLs expire. Skeleton motion reuses
the existing shared clock and schedules no animation under reduced motion.
Metadata-only ffprobe repair now has process ownership, shutdown admission fencing
and scrubbed child environment; its regression preserves the published artifact
and saved job status. Container disposal stops presence/download work before DBs.

The old PR's wall-clock-aged history captures were restored to the fixture's
pinned clock; all 26 live-render capture checks pass. Resurrected obsolete audit
plans were removed from active routing. The invalid global TMDB v3-to-v4 proposal
is preserved as superseded history in the reconciled PR. A broad rejection of any
SQLite path segment named `undefined` was dropped: valid user paths are not a
substitute for fixing test-root isolation.

PR668 reconciliation is a normal merge of main, preserving its existing history;
no history rewrite or remote main merge is part of this work.

## Upstream parity

Local ani-cli advanced from `21ed4a0` (5.1.5) to `0301d67` (5.1.6). Its one script
delta attaches separate HLS audio to the selected video. Kunai already retains
those masters through the shared HLS inventory reader. A HiAnime caller fixture
confirms Auto keeps the master, and the dossier records why copying upstream
player arguments would be inappropriate. The reference pin now matches the
reviewed checkout. Physical mobile playback remains a separate gate.

## Checkout and space recovery

The root checkout is clean `main` at `16bf2e705`, exactly equal to fetched main.
Its old audit branch was two commits ahead and 217 behind its own upstream;
compared to main it was two ahead and 372 behind. Unique commits and dirty files
survive on the original branch and stash `343c9c1b983d0467d1a4e52a49d2322cab73f97a`.
Exact files and binary patches are under `/tmp/kunai-root-preserve-20261025`.
No old dirty files were restored onto main.

Nineteen clean, integrated, inactive worktrees were removed with normal Git
removal, retaining branches and refusing dirty/unmerged trees. Four nonexistent
records were pruned only after retaining their HEADs under
`refs/kunai-recovery/worktrees-20261025/`. The manifest is
`/tmp/kunai-worktree-removal-20261025.json`. Physical free-space improvement
measured around removal was 1,195,962,368 bytes (about 1.11 GiB); apparent tree sizes
are larger because of hard links. Fifty-two worktrees remain registered.

## Verification and limits

Fresh forced candidate test graph: 9,585 passed, 62 skipped, zero failed; 26 tasks,
zero cached. The final combined CI graph after the HiAnime parity regression and
strict preflight cleanup passes 9,586 tests with 62 skips and zero failures: 58
tasks, zero cached (see `/tmp/kunai-integration-ci.log`). Fresh types, lint, formatting, doc paths, coverage routing and CLI
build pass. Lint retains existing warnings. Bundle budget remains 3120 KiB.
A subsequent HiAnime caller parity test also passes; owning package checks cover
the final reference/manifest update. Full web production build passes as well.

Logs: `/tmp/kunai-integration-{tests,types,lint,build,docpaths,doccoverage,parity}.log`,
`/tmp/kunai-integration-docs-build.log`, `/tmp/kunai-hianime-audio-parity.log`.
The reconciled PR separately passes its full graph (9,317 passed, 61 skipped)
and fresh types/lint/build, plus privacy and capture regressions.

Browser DOM checks establish no-results semantics and focus restoration from an
Escape event. The preview keyboard tool did not deliver native key events; this
is not trusted-keyboard or assistive-technology qualification. Native macOS,
Windows, physical mobile/terminal behavior, current live-provider decoding and
hosted CI remain separate gates. No release was published and main was not
remotely merged. Manga reading, YouTube discovery/channel UX and live-TV expansion
remain product roadmap work, not claims of this safety/review pass.

The normal push gate caught new custom-lint debt in the first reconciliation.
It was fixed with concrete environment contracts, explicit test-entrypoint setup,
shared JSON boundary guards, owner-derived fixture types and justified partial
fixture assertions. Both branch baselines were ratcheted down; no lint rule or
budget was raised and no freshness/verification gate was skipped.

PR668 is published at `6062c4752` after the normal pre-push gate passed 9,318
tests with 61 skips and zero failures. Its merge commit is `a7618bef5`; the next
commit tightens test contracts and ratchets down lint debt. The PR checkout is
clean and synchronized with its existing remote branch. This is a normal push,
not a remote main merge. Hosted checks/reviews remain pending and will be watched.

## Follow-up review qualification

The next review round reproduced the library slash-event leak, installer-smoke
root inheritance, and missing `.yaml` workflow coverage. Focused regressions
failed before the fixes. New PR-only live smokes now preserve structured resolve
failures and use the existing tri-state reachability helper.

Bounded fMP4 recognition now requires complete `moof` structure, timed track/run
metadata and a following nonempty `mdat` prefix; only the media payload may extend
beyond the captured prefix. All 34 reachability tests pass. A locally generated
ffmpeg HLS fixture passes the HTML-MIME probe and separately decodes one frame;
this is not live-provider proof. Evidence: `/tmp/kunai-fmp4-prefix-validation/`.

The combined forced candidate graph passes 9,593 tests, with 62 skips and zero
failures across 58 tasks, none cached (`/tmp/kunai-integration-review-ci.log`).
Two later extended-size cases pass in the final complete provider suite: 1,036
passed, one skipped, zero failed (`/tmp/kunai-integration-providers-review-final.log`).
Fresh bundle and host-binary builds pass. The candidate bundle is 3,177,474 bytes,
17,406 below its unchanged 3120 KiB cap.

The separate PR checkout retains its stricter 3096 KiB cap. Projecting only the
CLI version from its package manifest brings its bundle to 3,164,544 bytes,
5,760 below that cap, with 13 build-contract tests passing. Other manifests and
runtime environment reads are preserved.

Hosted checks at published head `6062c4752` passed except GitGuardian, which
flags a historical synthetic password literal in a pure redaction unit test.
Current fixtures are neutral. Clearing the historical false positive requires
the authenticated GitGuardian/GitHub review action; the preview is signed out
and the user login request remains pending. No history rewrite or secret-scan
suppression was used. The follow-up normal push passed at `1203b7fa2`: 9,328 tests passed,
61 skipped, zero failed. The 26-task test graph reused two tasks (unchanged docs
tests and the mobile dependency build). Typecheck reused one unchanged docs task;
CLI typecheck and build-contract checks were fresh. Both commits were pushed
without bypassing hooks. The PR checkout is clean and synchronized. Hosted
checks are running and GitGuardian still fails; CodeRabbit is reviewing.

## Hosted macOS manifest follow-up

The hosted macOS job at `1203b7fa2` failed the new manifest-projection regression:
its temporary root and Bun's canonical loaded path differed through a symlink.
A symlinked Linux fixture reproduced the exact marker leak before the fix. The
plugin now compares canonical paths inside build setup; both direct and linked
roots preserve version-only projection, other manifests and runtime environment
reads. Fourteen build-contract tests pass in each checkout.

The PR's fresh forced build passes all ten tasks with no cache replay, producing
a 3,164,544-byte bundle under the unchanged 3096 KiB cap and a Linux host binary.
Evidence: `/tmp/kunai-pr668-canonical-manifest-{red,green}.log` and
`/tmp/kunai-pr668-canonical-build.log`. Native macOS/Windows qualification remains
the hosted rerun. GitGuardian check `121195716708` still names incident
`38941662` in the same historical redaction fixture; browser login remains pending.

The fix is published normally at `18399a533`. Its push gate passes 9,329 tests
with 61 skips and zero failures; three test-graph tasks use cache (docs tests,
mobile dependency build, CLI build). The CLI bundle and Linux host binary were
separately forced before publication, with ten successful tasks and none cached.
The PR checkout is clean and synchronized. New hosted qualification is pending;
the thread's PR watcher remains active.

## Larger fragment and fixture-containment review

CodeRabbit review `5643692264` identified two reproduced gaps. A valid fMP4
fragment with a movie-fragment box beyond 1 KiB failed the MIME override; the
Windows containment assertion accepted another drive while rejecting valid
dotted child names. Both targeted regressions failed before the fixes.

The segment request is bounded to 64 KiB. Normal reads stop at 1 KiB; HTML-labeled
reads can stop early after sufficient TS/fMP4 evidence and otherwise cancel at
64 KiB. Structural rechecks are spaced by at least 1 KiB. The minimum media body,
HTTP/target gates, deadlines and complete-fragment validation remain unchanged.
The 37 reachability tests prove larger-fragment recognition, ignored-Range caps
and early TS cancellation. Installer privacy tests pass 18 cases, including
Windows other-drive/UNC, parent/sibling rejection and valid root/dotted children.

A real ffmpeg HLS fixture has a 1,544-byte `moof`, passes the HTML-MIME probe and
separately decodes a frame. Its evidence is in
`/tmp/kunai-large-fragment-6_vk30zr/`; this is local media proof, not remote
provider playback. The PR provider suite passes 1,016 tests with one expected
skip. Fresh forced bundle and Linux host-binary builds pass all ten tasks, none
cached. The bundle is 3,164,647 bytes, below the unchanged 3096 KiB cap.

Both Vercel project previews reported Ready. GitGuardian check `121198018259`
still reports only incident `38941662` in the historical redaction test. The
authenticated classification request remains pending; no scan bypass was added.

Both review fixes are published at `a94620073`. Normal push qualification passed
9,345 tests, 61 skips, zero failures. Its test graph reused three tasks: docs
tests, the mobile dependency build and the separately forced CLI build. The
existing branch is clean and synchronized; no remote main merge or release was
performed. Hosted checks and subsequent review remain watched.

At the next watcher notification, both Vercel previews were Ready. The updated
CodeRabbit comment contained no new finding: automatic reviews are paused at
`1203b7fa2`, and final head `a94620073` remains unreviewed by that bot. A user
request to authorize a public re-review command is pending; no public comment
was posted. Hosted tests/platform legs remain running, and GitGuardian remains
the known failure. No code or test changes were needed for these status updates.

## Windows alias and workflow-path follow-up

Hosted Windows at `a94620073` reported two unit failures: the junction-backed
manifest fixture still retained development metadata, and workflow discovery
expected POSIX separators. `CI ready` correctly failed only because its required
Windows dependency failed; the macOS job and other listed dependencies passed.
No gate or timeout change is needed. Logs: `/tmp/kunai-pr668-windows-a946.log`
and `/tmp/kunai-pr668-ci-ready-a946.log`.

Manifest selection now follows links and compares bigint device/inode identity.
A hard-linked manifest fixture fails the prior path-string comparison and passes
the new selection; unrelated manifests and runtime environment reads remain
intact. The native junction case stays enabled, with disposable fixture file IDs
and build-input paths included on failure to distinguish identity mismatches
from bundler-hook behavior. The exact Windows junction result remains a hosted
qualification gate, not a locally established success.

Workflow expectations now use the host path API and retain both YAML suffixes.
All 18 focused build/CI tests pass in both checkouts. The PR's forced build passes
ten tasks, zero cached, and the 3,164,647-byte bundle remains below its unchanged
3096 KiB cap. The normal push gate is still running. GitGuardian classification
and authorization to request CodeRabbit re-review remain pending user input.

Published at `3291745db` after the normal gate passed 9,346 tests, 61 skips and
zero failures. The test graph reused two tasks: unchanged docs tests and the
mobile dependency build. The CLI build was uncached in that graph and separately
forced before publication. Fifteen manifest/build tests plus three CI-privacy
tests pass locally. The branch is clean and synchronized. Windows junction
qualification awaits the new hosted run; no Windows or aggregate gate was
weakened or skipped.

## October 26 dependency, resource and Kanna qualification

The prior `3291745db` hosted run passed Linux/macOS/Windows parity, installers,
CodeQL and CI ready. GitGuardian alone remained failed; the user owns its
historical fixture classification. The authorized CodeRabbit re-review was
posted at https://github.com/KitsuneKode/kunai/pull/668#issuecomment-6400238932.
Its new review reproduced a finite-`mdat` offset omission and unclear path-rule
wording; both are now fixed, with three malformed-fragment cases failing before
the code fix. The provider suite passes 1,019 tests and one expected skip in the
PR checkout.

Updater regressions reproduce 33 retained abort listeners after a 32-chunk
transfer, locked readers, uncancelled refused responses and ready-response abort
races. The fix removes per-read listeners, releases readers, cancels unused
bodies and clears bounded-cleanup timers. IPC regressions cover oversized
terminated/unterminated frames, fragmented UTF-8 and large batches of small
frames. Each receive frame is capped at 1 MiB before decode/parse. These are
resource ownership fixes, not a claim of universal exploit resistance.

The release version check's hostile fixture executed a marker command before
the fix. Input now flows through a step environment variable, with valid-version
and hostile-version executions proving acceptance/refusal. The complete locked
dependency audit is part of PR/release gates. Stable dependencies were refreshed;
Bun 1.4.4 and TypeScript 7.0.2 are current, and the docs app now uses the same TS7
compiler with Next 16.4.3. Changesets 3 uses its matching commit-pinned v2 action,
renamed inputs, explicit private-package versioning and Bun-locked scripts. A
real release-plan read succeeds without version/tag creation. Publication remains
separate from push-to-main version-PR generation.

Ink 8 passed 6,638 CLI unit tests but exceeded the unchanged PR bundle budget:
3,189,750 bytes versus 3,170,304. It remains at 7.1.1. Oxlint/plugins 1.89 surfaced
existing shell render-ref/effect migration errors and remains at 1.74.0; no lint
rule, custom baseline, build budget or verification gate was disabled. Oxfmt is
0.74.0. The patch verifier now checks the surviving shadcn braces consumer and
proves Changesets config/git declare picomatch, avoiding stale-hoist false passes.
Registry audits in both checkouts report no vulnerabilities in 815 packages;
this is current dependency evidence, not proof of an exposed application exploit
or proof that no flaw exists.

Kanna retains a jointed SVG and pure distance-driven gait. Cream markings,
offset far paws and eye highlights improve the small silhouette; the stride is
0.65 of her displayed width, torso bob is six viewBox units and footer travel is
40px/second. Footer Pause/Resume and live reduced-motion changes stop the loop.
Observers/listeners/frames remain owned and cleaned up. All 444 docs tests pass;
rendered SVG stride frames were inspected. Scoped React diagnostics report no
findings (score 88). No physical browser/device motion proof is claimed.

PR checkout: 9,363 tests pass / 61 skip / zero fail in a fresh forced 58-task run
with zero cached tasks. Later locked-Bun script changes pass their 15 focused
contracts. Docs production build with TS7, Linux native compile/host version
check, package budget, audit/patch/doc/parity checks pass. Normal final push gate
and hosted final-head qualification are recorded separately below.

Shared watching candidate: narrow patches preserve all earlier dirty changes.
Fresh forced graph: 9,630 pass / 62 skip / zero fail; 58 tasks, zero cached.
Logs: `/tmp/kunai-primary-20261026-forced.log`,
`/tmp/kunai-pr668-final-forced.log`, `/tmp/kunai-pr668-final-native-build.log`,
`/tmp/kunai-pr668-final-docs-build.log`, and
`/tmp/kunai-pr668-20261026-push.log`. Tests/profile fixtures use DNT and isolated
storage; no production analytics request or live-profile migration was made.

Final push is `fb41e7bf6e80713ebe580752608cb350546ab820`, normal hooks intact:
9,365 passes / 61 skips / zero failures; 26 test tasks and zero cached.
The PR checkout is clean and exactly synchronized with its remote branch.
Hosted formatting, types and lint are green on that head; other checks/review
remain pending. The final review request URL is recorded in
`/tmp/kunai-pr668-final-head-review-request.log`. GitGuardian remains user-owned.

Hosted formatting caught root-doc drift from Oxfmt 0.74. Local preflight now
runs root formatting too. Doc freshness compares committed versions through the
installed formatter before accepting a purely mechanical edit with an unchanged
review date; missing/failed formatting cannot grant an exemption. Seven focused
tests pass, including a failing-first indentation case and a content-plus-format
refusal. The same narrow fix, CLI typecheck and complete preflight pass in the
shared watching candidate. No fabricated review date or freshness bypass was used.

The shared candidate's forced build passes ten tasks, zero cached, and host
verification prints the expected binary version. Its bundle is 3,178,596 bytes
under its existing 3,194,880-byte cap; the PR's stricter cap remains unchanged at
3,170,304 bytes. Neither cap was raised. Root main is clean and fast-forwarded
to fetched `b54019c66` (a status-only bot commit); no remote main merge, tag or
release was made.

## Subsequent stale-alert and sample-extent review

The wake named old commit `1203b7f`. Its Windows failure was the workflow-discovery
fixture pinning POSIX separators; `3291745db` already replaced those expectations
with the native path API. The old `CI ready` log correctly lists both Windows
and macOS as failed required jobs. No obsolete job was retried or weakened.

A new CodeRabbit review on `9ddad4df9` found that an in-range sample start could
still claim bytes beyond the declared `mdat` end. Commit `ba7d86274` fixes the
whole run: explicit per-sample sizes or a `tfhd` default must fit; explicit sizes
override defaults; box order cannot bypass the check. Field-free large counts
use constant-time exact arithmetic, and unsafe box-end sums are rejected.
Unknown initialization-segment sizes and open-ended boxes retain the documented
structural-prefix contract; this is not complete media decoding or live health
qualification.

Thirteen additional cases cover cumulative overruns, defaults, optional fields,
exact boundaries, initialization-only sizes, open-ended boxes and safe-integer
bounds. Five invalid fragments failed before the extent fix; the integer-end
case separately failed before its fix. PR provider suite: 1,032 pass, one
expected skip; owning package types, scoped lint and complete preflight pass.
Fresh forced build: ten successful tasks, zero cached; host binary and pack
verification pass. PR bundle is 3,166,202 bytes under its unchanged cap.
A local ffmpeg-generated fMP4 prefix still reports reachable when HTML-labeled,
and ffmpeg separately decodes a frame. Evidence:
`/tmp/kunai-pr668-sample-extents-real-prefix.log` and
`/tmp/kunai-pr668-sample-extents-full-provider.log`.

The narrow three-file patch also applied cleanly to the dirty watching candidate,
without replacing other work. Its provider suite passes 1,055 tests and one
expected skip; package typecheck, complete preflight and diff checks pass.
The normal PR push and final hosted results are recorded in
`/tmp/kunai-pr668-sample-extents-push.log` and the linked PR.

Pushed `ba7d86274e346cb91b288dd10aee811c5f1a2803` normally. The push gate passes
9,378 tests / 61 skips / zero failures; three unchanged docs/mobile tasks were
cached. Provider tests and the ten-task build were separately fresh, as recorded
above. The PR checkout is clean and synchronized. Review of this exact follow-up
was requested at
https://github.com/KitsuneKode/kunai/pull/668#issuecomment-6402519861.
Hosted checks/review remain separate; GitGuardian is still user-owned.

## Hosted updater stall failure follow-up

The hosted Test job on `ba7d86274` failed the updater stall/retry test (6,639
passes, one skip, one failure). The failure was not hidden with a timeout
increase or rerun. The response inactivity timer also ran during local file
opening and writes. Two deterministic regressions deliver its callback during
each local operation; both reject ready media on the old implementation.

Commit `22d9df51c` arms the stall timer only for body reads and clears it before
disk operations, retaining the existing total deadline, limits and retry policy.
The two stall/retry cases now explicitly fire callbacks after a written partial
file and verify cancellation, lock release, cleanup and retry. Their new stream
fixture contains no parked asynchronous pull, so these tests are enabled on
Windows too; hosted Windows behavior remains a separate gate.

The PR checkout passes 6,642 parallel CLI unit tests with one skip and zero
failures; all 15 native-installer files pass 182 tests with one skip. CLI types,
scoped lint, complete preflight and doc paths pass. The fresh build passes ten
tasks, zero cached, and produces a 3,166,217-byte bundle under the unchanged
3,170,304-byte cap. Linux host binary and package checks pass. The same narrow
patch applies to this dirty watching candidate; its native-installer suite and
CLI typecheck pass. Evidence is in `/tmp/kunai-pr668-download-local-io-red.log`,
`/tmp/kunai-pr668-download-stall-unit.log`,
`/tmp/kunai-pr668-download-stall-build.log`, and
`/tmp/kunai-primary-download-stall-native-suite.log`. The normal push gate and
final-head hosted checks/review still require their own recorded outcomes.

Pushed `22d9df51cfd353b37597d5aec5bc1c543110b4ba` normally; the checkout is
clean and synchronized. The push gate passes 9,380 tests / 61 skips / zero
failures (26 successful test tasks, two cached unchanged tasks). The separate
CLI/native build above is fully fresh. Hosted checks on this head are starting;
GitGuardian remains user-owned. CodeRabbit's latest published review still
targets `9ddad4df9`, so its success status is not final-head review approval.

## Windows Bun store failure on the current head

Hosted Windows parity on `22d9df51c` failed during mandatory dependency-patch
verification, before tests. A restore-prefix cache hit loaded an older v3 store;
frozen installation and the oxfmt probe succeeded, but loading the shadcn glob
chain hit `EPERM` at the global-store `fill-range` to `to-regex-range` link.
The older bot comments were unchanged; the current failure was investigated
separately rather than dismissed as a stale alert.

Follow-up `f0f83ef86` exports `BUN_INSTALL_GLOBAL_STORE=0` for Windows CI before
installation, retaining the isolated linker with project-local dependency links.
The v4 cache excludes old archives and keeps fallback restores inside a
root-manifest/bunfig partition, with lockfile and patch fingerprints in the exact
key. Linux/macOS retain the configured global store. The formatter probe requires
an installed binary with `--no-install`; executable dependency-patch checks
remain unconditional and fail closed before save. No timeouts or security gates
were relaxed.

Two new setup regressions fail on the old action; all three setup contracts and
the three analytics-workflow contracts pass after the fix in both checkouts. CLI
typecheck, preflight, scoped lint and seven actual dependency-patch assertions
pass. In an isolated Linux fixture, corrupting a global-store dependency link
breaks module loading; a frozen project-local install succeeds with that corrupt
global entry still present. That is a mechanism check, not reproduction of
Windows `EPERM` or hosted Windows qualification. Evidence:
`/tmp/kunai-pr668-windows-store-red.log`,
`/tmp/kunai-pr668-windows-store-isolated-proof.log`, and
`/tmp/kunai-pr668-22d9-windows.log`. The normal push gate and new hosted run remain
separate outcomes.

Pushed `f0f83ef86159cac5d14de0658a8cf218d2717a9f` through the normal gate:
9,383 tests pass, 61 skip, zero fail; 26 test tasks succeed, two unchanged tasks
are cached. The PR checkout is clean and synchronized. The fresh targeted
checks and fixture mechanism evidence above do not establish native Windows
recovery. Final-head hosted CI and rate-limited review remain pending;
GitGuardian is still user-owned.
