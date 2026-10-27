# Watching candidate — October 22, 2026

Initial runtime implementation **cf83c54054007bc0b268026bae2004ad01e7e1cd**, based
on main **8a86bf9dc3d0e8315522624c939df807ea69e028**. This is a qualification
record, not a published release or merge approval. Original dirty root checkout
was preserved. The candidate is on `fix/watching-release-readiness-20261022`.

Earlier source follow-up: `ebb3a8a54`, including the safe manual launcher,
verification-copy correction and upstream status-board refresh. The October 23
qualification and manual test command are recorded below.

## Resulting behavior

- Watching: watchdog reconnect keeps ownership across mpv's replacement
  `end-file(stop)` event, restoring seek/subtitles after file-loaded. Genuine
  errors, quit and retirement still terminate the pending replacement. A
  duration-only EOF cannot manufacture completion or destroy useful resume.
- Recovery: selected-source cache purges preserve different sources for the
  same episode; failed/quarantined cached choices can reach healthy fallback.
  Offline asset lookup remains complete beyond 100 assets. Download workers
  coalesce kicks and handle admission, shutdown, leases, retries and storage
  failures; poster eviction can recover from large backlogs.
- Providers: current Movy/Vidrock contracts, AllManga build181 crypto, YouTube
  playlist/channel fallback and extractor freshness, and explicit enable/disable
  controls reach the live registry, retained catalog handles and playback paths.
  IntroDB uses v4 while preserving the caller's TMDB identity and validating
  TVDB response identity, optional coordinates, segments and cancellation.
- Interaction: Library, Up Next, Tracks and Settings have semantic mouse
  selection/activation and bounded wheel navigation. Keyboard workflows remain
  available. Search and palette submit current text in the same input drain;
  settled shell status says ready and provider loading/failure copy is truthful.
- Release tooling: npm 11 candidate pack/inspection commands now use artifact
  context instead of inheriting the Bun-only repository engine policy. The
  real-npm regression failed with EBADDEVENGINES before this change. Registry
  and publish requests carry the same context; no publish command was run.
- Safety: passive Settings writes preserve sibling withdrawal and unrelated
  preferences; failed consent writes remain retryable and newer equal-valued
  intent survives in-flight saves. Only Enter can enable analytics. Gateway
  sensitive headers follow the media origin through direct requests,
  redirects, subtitles, HLS and DASH resources.

Source PRs integrated locally: 652, 655, 657–665, 667, 634–637, 639, 645,
622, 623, 633 and 644. Git merge history and pinned `refs/kunai-review/<number>`
retain their source heads. All 22 PRs are linked to this T3 thread. Remote PR
states/reviews were not changed. Licensing, Chromecast, cloud expansion and
full torrent/debrid work were excluded.

## Deterministic qualification

On the final source tree, including the review and packaging corrections:

| Check                                                                        | Result                                                      |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `bun run typecheck --force`                                                  | 15 tasks pass, zero cache                                   |
| `bun run lint --force`                                                       | 14 tasks pass, zero cache; warnings remain                  |
| `bun run test --force`                                                       | 26 tasks pass, zero cache; 9421 tests pass, 62 skip, 0 fail |
| CLI unit tests within that run                                               | 6728 pass, 1 skip, 0 fail                                   |
| CLI integration tests within that run                                        | 361 pass, 27 skip, 0 fail                                   |
| Provider package tests within that run                                       | 1010 pass, 1 skip, 0 fail                                   |
| `bun run build --force`                                                      | 10 tasks pass, zero cache; host binary built                |
| `bun run ci:preflight`                                                       | anti-slop baseline, doc paths and frontmatter pass          |
| `bun run verify:doc-coverage`                                                | every covered code area routed                              |
| `bun run fmt` and `bun run fmt:check`                                        | pass                                                        |
| Full cross-compile and archive verification                                  | ten targets; exact 22-file asset contract verified          |
| Opt-in compiled binary smoke, full asset set                                 | 14 pass, 0 fail                                             |
| Preserved npm candidate, offline host install and command-context regression | 5 pass, 0 fail                                              |
| Preserved npm tarball allowlist/size verification                            | pass                                                        |
| Opt-in real mpv tier                                                         | 1 pass; advancing IPC time-pos and SQLite history           |

The default suite's skips include opt-in live/binary/npm/deployment/platform
checks. They are not passes. Linux pwsh installer fixtures did run, but do not
establish behavior on Windows or explain historical contention issue 650.

Meaningful new regressions were seen failing before fixes: watchdog reconnect
replacement stop and equal-valued newer consent intent during an in-flight save.
The independent reviewer also reproduced cancellation being resurrected by
shutdown during a storage probe. That regression failed before removal of the
pre-claim requeue; the focused queue-hardening suite then passed 10 tests.
IntroDB has 23 focused v4 cases. Selected-cache tests isolate all storage roots
and preserve a distinct source/stream key for the same episode.

React Doctor reported 12 warnings and no errors (77/100). Its tracks updater
warning invokes a pure navigation reducer; serialized cache hydration is
intentional. Existing style/complexity warnings are not a clean lint claim.

Development bundle cap is now 3120 KiB after a measured combined 3,185,739-byte
bundle exceeded 3100 KiB. This admits at most another 20 KiB of development
bundle; public npm launcher size caps remain unchanged.

## User-journey evidence

All runtime profiles use shadow HOME/XDG/APPDATA/USERPROFILE and file credentials.
No profile data flows back to the developer profile.

- L2, 100×30 and 64×22: search → select → play → post-play; citation checks
  found `"title_id": "tmdb:smoke-movie-1"` and `Post-play` in captured evidence.
- L3, real tmux: Up Next first click leaves the exact SQLite row pending;
  second click changes that row to played and renders post-play. Tracks current
  provider click says `Current provider`, remains open and does not switch.
  Wheel focus changes the source viewport at 64×22; keyboard navigation returns
  control. Failed source rows are intentionally retryable, not disabled rows.
- Earlier mouse-worker L3: Settings selection, toggles and reverse toggles,
  submenu highlight/cancel, wheel, Library/Downloads tabs and resize guard.
  Two analytics clicks left consent unset and installId empty; Enter enabled it.
- L4: generated media decoded through real mpv, backed by progress/history.
  A separate real-mpv capture established replace ordering:
  end-file(stop,id1) → start-file(id2) → file-loaded.

Captured bundles remain under `/tmp/kunai-watching-final-{play,narrow}` and
`/tmp/kunai-watching-pointer-{queue-focus,queue-activate,tracks-current,tracks-narrow,tracks-return}`.
The owned terminal session and its profile were removed after capture.
Trailing CR inside a paste chunk retains Ink's existing text behavior; an
explicit Enter is required. Separate paste and Enter in one drain is covered.

## Live checks — October 22 only

A production-registry sweep at 08:06 UTC probed all 12 adapters:

| Result             | Providers                                                          |
| ------------------ | ------------------------------------------------------------------ |
| Resolved/probed    | Rivestream, Vidrock, Movy, HiAnime, AnimeGG, KickAssAnime, YouTube |
| Exhausted/degraded | VidLink, AniDB, Miruro                                             |
| CAPTCHA blocked    | AllAnime                                                           |
| Unreachable        | Videasy                                                            |

Vidrock and Rivestream each decoded 30 frames in actual mpv. Movy resolved
streams but hit the existing 20-second decode deadline: playback is **not
qualified**. No deadline was raised. AllManga build181 bootstrap/crypto passed,
which does not bypass the CAPTCHA or prove full stream resolution.
Live IntroDB v4 movie (TMDB550) and TV (TMDB1396, S1E2) returned HTTP200 with
TVDB identity and expected media type; TV coordinates matched.

Logs: `/tmp/kunai-watching-final-{types,lint,tests,build,preflight,fmtcheck,doccoverage,binary,real-mpv,binaries-all,assets,npm-prepare,npm-install,npm-pack}.log`,
`/tmp/kunai-watching-live-{vidrock,rivestream,movy,allmanga}.log`.
The full sweep JSON and real-mpv event capture are retained in this plan's
ignored `.superpowers/sdd/2026-10-22-watching-release-candidate/` workspace.
These results are network-, fixture- and date-specific, not all-title guarantees.

## Remaining release gates

1. Maintainer integration approval. A fresh independent review of 09275b6b4
   completed after earlier quota failures, found the cancellation race above,
   and ran 188 focused tests. Seven UI/consent suites were blocked by Ink
   resolution in that reviewer checkout; the parent ran the full suite.
   Review findings were fixed with failing-first regressions; this remains
   local verification and does not constitute remote PR or release approval.
2. Explain installer contention issue **650**. Diagnostics from 651 and passing
   reruns cannot recover the filesystem error discarded by the original fixture.
3. Resolve or explicitly qualify today's provider failures, particularly Movy
   decode and AllAnime CAPTCHA, before a blanket provider signoff.
4. Hosted Linux/macOS/Windows qualification, poster protocols, physical Android
   evidence (631), and applicable real npm update/sync/operator journeys. Local
   Bun compilation and fixture tests do not replace those checks.
5. Integrate chosen fixes, regenerate version PR **327**, then qualify its exact
   combined release artifacts and deployment statuses. No release was published.

## October 23 follow-up — ready for local manual testing

Use this exact checkout; the globally installed command and main checkout do
not automatically include these local commits:

```sh
cd /home/kitsunekode/.t3/worktrees/kitsunesnipe/fix-watching-release-readiness-20261022
SANDBOX_DIR=/tmp/kunai-watching-preview KEEP=1 bun run sandbox
```

An unused path or an empty directory you own is accepted on first use. Later
runs with KEEP=1 retain this profile's queue, history and Settings. It redirects
HOME/XDG/APPDATA/USERPROFILE and forces file credentials; your installed profile
and account vault are untouched. A nonempty unmarked directory, symlink or
invalid marker is refused before reset. Omit KEEP=1 only when you intend to reset
a sandbox initialized by this launcher. Native Windows does not use this Bash
source-checkout launcher.

Try search → play → stop/resume, source/quality switching, and mouse selection
in Library, Up Next, Tracks and Settings. Analytics stays off unless explicitly
enabled by keyboard. Setup/preferences and tracker authentication belong to the
isolated profile; real account tokens are not copied from your installed app.

This follow-up used GPT 6.1 Sol. Two October 22 implementation delegations hit
quota limits, so the controller continued on the requested model. A fresh
October 23 Sol review completed with no actionable findings in the sandbox fix:
six shell integration cases pass under Bash 5.3 and 3.2 on Linux, with syntax,
ShellCheck and diff checks. Native macOS was not independently exercised.

The launcher had two reproduced defects: a reset could delete an unrelated
SANDBOX_DIR before validation, and a shadow HOME did not isolate the account
credential vault. Four assertions failed before the fix; all six cases pass
with the marker and forced file backend. Actual PTY proof reached setup and
then Browse/recommendations, and a retained-profile relaunch skipped setup.
Remaining-defaults selection left analytics unset and installId empty. The owned
PTYs were stopped; their isolated proof profile remains outside the checkout.

Fresh local checks on this source follow-up:

- Forced root types 15/15, lint 14/14, tests 26/26 and build 10/10, zero cache.
- 9427 tests pass, 62 skip, 0 fail; CLI integration is 367 pass/27 skip.
- Real mpv: 1 pass; full-set compiled binary smoke: 14 pass.
- Preserved Linux archive installer: 1 pass, verifying archive transport,
  provenance, sandboxed launcher version/help and no raw fallback.
- Current activation-lock suite: 37 pass, 1 Windows-only skip.
- Upstream main advanced only by generated provider status (`b5f2b09b8`); it was
  merged locally, then all 440 docs tests passed. No runtime changes came from it.
- The rebuilt Linux binary is byte-identical to the preserved npm platform
  binary; the cross-platform runtime graph is unchanged from the earlier build.

Movy was checked three times with distinct bounded triggers. The standard
30-frame smoke still timed out. A diagnostic through the same production
engine/header builder decoded a 2160p HLS frame and exited 0; a requested1080p
attempt then hit the existing 12-second provider-resolve deadline. This does
not establish sustained playback or an adapter defect. Timeout copy now says
that the frame budget was not confirmed, rather than asserting zero decode.
No timeout, quality default or resolve gate was loosened.

The original #650 failed-job log was recovered. It contains the boolean
violation assertion and no underlying mkdir error, so historical attribution
remains unavailable. The fresh lock and Linux installer passes above do not
close that issue. Logs are retained as `/tmp/kunai-followup-650-failed.log`,
`/tmp/kunai-followup-lock-tests.log` and
`/tmp/kunai-followup-native-installer.log`.

This is ready for maintainer testing. Release sign-off still requires resolution
or explicit acceptance of the remaining provider/installer evidence gaps,
hosted/native-device qualification and approval of the actual release candidate.
No PR was merged remotely and nothing was published.

## October 23 watching UX pass

Source: **fc2f4604f828a28b4f87746c1db25758616c0450**, compared with
**5bfc0a4c6**. This is a local candidate; no remote merge or publication.

- New-file watchdog state starts from that file's first sample. Startup
  starvation says waiting/buffering; genuine established-stream failures retain
  their recovery path and diagnostics. The startup rail follows the current cycle.
- Tracks separates focus from applied selection, reserves label/value columns,
  limits long source rows to one line, shows Auto and the actual resolution, puts
  subtitle Off first, and removes repeated host/error/current/available prose.
- Session subtitle and quality choices reach resolve, prefetch, mpv options,
  source selection and inventory/recovery keys. Source switches preserve the
  quality preference; Off clears provider-default external subtitles after a
  resolve. Accepted live subtitle acknowledgements update only their still-current
  stream. Saved per-media defaults stay separate.
- Setup profile/language/toggle/footer controls and palette rows have measured
  pointer targets. Back, Share and covered-input ownership use their real action
  paths. Palette prefix filtering narrows `/fi` to Filters. Setup is legible at
  72×24, including every library toggle and Back. Pointer input cannot enable
  analytics. No navigation delays or simulated progress were added.
- A single provider/poster/subtitle endpoint failure means limited connectivity;
  explicit network outages/manual offline still stop online work. Other providers
  remain usable after one CDN DNS failure.

Checks run on that committed source:

| Check                                  | Result                                                    |
| -------------------------------------- | --------------------------------------------------------- |
| Forced root typecheck                  | 15 tasks pass, zero cache                                 |
| Forced root lint                       | 14 tasks pass, zero cache; existing warnings remain       |
| Forced root tests                      | 26 tasks pass, zero cache; **9458 pass, 62 skip, 0 fail** |
| CLI unit / integration                 | 6757 pass / 369 pass; 1 / 27 skips                        |
| Forced build                           | 10 tasks pass, zero cache; Linux host binary rebuilt      |
| Host checksum, version and help        | pass                                                      |
| Host compiled-binary smoke             | 13 pass, 1 full-release-set skip, 0 fail                  |
| Formatting, preflight and doc coverage | pass; anti-slop baseline unchanged                        |
| Opt-in real mpv                        | 1 pass; advancing IPC position and SQLite history         |

The build printed a Turbo output-discovery warning for the development bundle
while the test suite also exercised release builds. The final host artifact exists,
passes its checksum/version/help gate and passes compiled smoke. This was a host
build; it does not replace fresh cross-compilation or hosted-platform qualification.

Runtime witnesses use isolated storage roots and file credentials:

- Real 72×24 PTY: all six setup screens, actual SGR mouse selection of Movies and
  French, mouse Next, decline analytics, save and relaunch. The final
  config has movie subtitle `fr`, other profiles unchanged, analytics `disabled`
  and `installId` empty. Evidence: `/tmp/kunai-ux-setup-persisted` and
  `/tmp/kunai-ux-setup-small`. The fixture Recommendations surface was briefly
  unrecognized by doctor; one relaunch reached healthy Browse.
- L2 replay: `Smoke Movie`, `subs off`, Share and the single
  `[o] tracks  [k] quality  [q] stop  [/] commands` footer. Citation `subs off`
  verified in `/tmp/kunai-ux-playing-final`. The L2 driver now hydrates profiles
  like main instead of displaying its constructor's placeholder subtitle value.
- Ink worst-case fixtures: long mirror labels/errors, CJK/Arabic text, 35 subtitle
  options, Auto and one-quality cases at 48/72/100/140 columns. A 72-column fixture
  first failed with 29 rows in a 20-row panel; it now fits. Captures are under
  `/tmp/kunai-ux-frames`; regression tests are committed.
- Only the six named PTYs created for this pass were stopped and their temporary
  profiles removed. Captured evidence remains outside those profiles.

Applicable seam audit: preference declaration-to-readers, Auto/numeric and
subtitle-on/Off reverse states, browse/palette/player picker entrypoints, anime
and TMDB profile selection, shared provider-shaped inventory behavior, and owning
docs. Linux terminal behavior is exercised; macOS/Windows terminal hardware,
screen readers, physical Android, live provider playback and hosted release checks
remain separate gates. The existing Linux `--install-protocol-handler` owns URL
registration; macOS/Windows need packaged associations. No daemon was needed or
registered. Upstream provider rewrite work and issue 650 retain their earlier
qualification boundaries. Fresh GPT 6.1 Sol review of `5bfc0a4c6..fc2f4604f` found no actionable
findings after tracing all runtime edits and callers. It independently passed 30
watchdog/network tests. Eight other targeted files could not load dependencies in
its separate worktree; rendering, PTY, mpv and full checks above are controller-run
evidence, not independently repeated by the reviewer. No reviewer source changes.

This UX implementation is ready for local manual testing with the sandbox command
above. Release publication, hosted platform gates, physical devices and sustained
live-provider qualification remain outstanding; none is implied by local green.

## October 24 capability recovery — local candidate

Current dirty follow-up is based on `f3e893ce7`; no commit, remote merge or
publication was performed. This evidence supersedes earlier October 24 partial
worker runs; it does not replace the platform/live release gates above.

Implemented: real HLS variant expansion for Rivestream, Movy and extensionless
VidRock manifests; honest adaptive DASH Auto for VidLink; exact YouTube format
and client selection through both pickers and handoff options; clickable guarded
footer actions; bounded suggestion previews; native-anime-first provider rows
with recent-health hints; provider access from failure; and native subtitle
selection/visibility separate from saved defaults. AniDB is removed from the
production roster and relay roster, with revision-6 saved-config normalization;
its package and history identities remain. Videasy and AllManga remain registered.

React Doctor was used for the changed React surfaces. Its branch-wide scan
still reports warnings in earlier work; this is not a clean React-health claim.
The newly introduced grapheme formatter allocation was moved out of render.

One fresh GPT-6.1 Sol review found four actionable regressions, all fixed with
regressions: late preferred subtitles not activating, live observation cloning
invalidating accepted subtitle picks, unchanged process visibility missing on the
next file, and YouTube Auto losing intent through picker/coordinator. A separate
parent regression also covers late Off acknowledgements crossing file generations.
The original reproduction tests failed before their fixes. The full suite below
ran after integration. Error-panel captures and the relay count were refreshed;
the retired production AniDB handoff integration now checks recovery to a live
registered lane rather than resolving the retired module from production.

| Fresh command                       | Result                                              |
| ----------------------------------- | --------------------------------------------------- |
| `bun run test --force`              | 26 tasks, zero cache; 9546 pass, 62 skip, 0 fail    |
| `bun run typecheck --force`         | 15 tasks pass, zero cache                           |
| `bun run lint --force`              | 14 tasks pass, zero cache; existing warnings remain |
| `bun run build --force`             | 10 tasks pass, zero cache, host Linux binary built  |
| Development bundle                  | 3,174,928 bytes, below unchanged 3,194,880-byte cap |
| `bun run fmt` / `bun run fmt:check` | pass                                                |
| Doc paths, frontmatter, coverage    | pass                                                |
| Opt-in compiled host smoke          | 13 pass, 1 full-release-set skip, 0 fail            |
| Opt-in real mpv CLI tier            | 1 pass: advancing IPC position and SQLite history   |

Real-terminal browse/preview replay used a fresh isolated profile and file
credentials, verified by the session doctor, then captured in
`/tmp/kunai-watching-final-terminal/` and disposed. This is fixture-catalog
terminal evidence, not live-provider evidence. The real-mpv subtitle lifecycle
check selected a late English track, preserved explicit Off through another
attachment, and observed the next file with unchanged visibility in one process:
`/tmp/kunai-subtitle-lifecycle-real.log`. Its reproducible script is
`/tmp/kunai-subtitle-lifecycle-proof.ts` (run from the CLI test/agent location for
repository alias resolution); all storage roots were isolated and removed.

Bounded direct-provider resolve/probe evidence is redacted in
`/tmp/kunai-provider-live-recovery.jsonl`: VidLink adaptive DASH with 15 subtitle
tracks; Rivestream 720p/480p with 26 tracks; VidRock a real HLS ladder; Movy
2160p/1080p/720p/480p. These are title-specific resolve/probe facts, not decoded
live playback or general provider health. Higher Rivestream wrapper targets
failed, and an unverified external subtitle service was not added. No media relay
or weakened verification gate was introduced. External provider availability,
macOS/Windows, physical mobile behavior, and streaming SponsorBlock removal remain
unqualified by this pass.

YouTube discovery/trending/history recommendations and channel-upload browsing
already exist. Filtered channel search still needs a separate recovery pass before
claiming the full channel journey is qualified. Live TV/sports source intake and
manga/comic reading remain separate unfinished features, not shipped capabilities.
Manga was explicitly confirmed as reading, not the AllManga anime adapter.

Manual local testing, with a fresh isolated profile:

```sh
SANDBOX_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kunai-preview.XXXXXX")" KEEP=1 bun run sandbox
```

Start with subtitle Off/On in Kunai and mpv, source/quality/Auto reversal,
clickable footer actions and failure-to-provider recovery. The sandbox prints its
path; preserve it for repeat testing with `KEEP=1` and that same `SANDBOX_DIR`.

### Delayed subtitle-worker question

The old quota-failed worker's pending question was answered and the superseded
worker stopped. Its additional finding was independently reproduced: late Wyzie
completion spread an older stream snapshot, erasing live sid/visibility facts,
overwriting an explicit Off, and updating a replacement source in the same title.
The merge now uses the current stream, checks file/source identity and cancellation,
preserves newer choices and inventory, and guards user-visible attachment feedback.
Three failing integration cases now pass; the focused file has 11 passing tests.
The follow-up logs use `/tmp/kunai-late-verified-*`; the fresh forced full suite passes 9546 tests with 62 skips and no failures.
Forced types/lint, formatting/docs, the 10-task host build and host binary smoke
(13 pass, 1 full-release-set skip) also pass after this additional change.

## October 26: combined security and scoped search checkpoint

Source checkpoint: `2d597ab16` (search recovery `25686928f`). This candidate includes PR668 at
`7b9acf451` and the `origin/main` status update at `d923c4e12` through normal
merges. It remains a release candidate, not a published release.

Search history is partitioned by anime, series/movie and YouTube. Local title
suggestions stay in their lane; remote requests are cancelled and gated by
query, mode and provider. Completed results also carry that scope so they cannot
flash in another mode before passive-effect cleanup. Legacy unclassified history
is preserved without being copied into every lane. YouTube type-ahead remains
local-only; committed search retains its provider-native path.

Palette title selection and hover expose bounded metadata. Compact terminals use
the section heading; taller terminals reserve three stable rows. Hover does not
activate a title or move its hit target. Existing keyboard submission and Escape
behavior remain covered. New and cached relative YouTube artwork uses the image
CDN. Tracks no longer calls a selected source playing or repeats host labels.
Subtitle inventory, explicit Off, pending lookup and confirmed mpv selection
remain distinct; waiting and Off use neutral text.

Fresh verification of this source:

- Forced root types: 15 tasks, no cached tasks; forced lint: 14 tasks, no errors
  (existing warnings remain). Formatting, anti-slop baseline, doc paths and
  frontmatter checks pass. No lint baseline or bundle budget was increased.
- Forced root tests: 9,677 pass, 62 explicit skips, zero failures across 26
  uncached tasks. This includes 6,877 CLI unit tests and 411 CLI integration tests.
- Forced host build: 10 uncached tasks pass. The development bundle is 3,181,843
  bytes against the unchanged 3,194,880-byte cap. The Linux binary is 107.4 MiB;
  the embedded Bun runtime dominates it. Public npm files total 10.5 KiB.
- Real-mpv generated-media proof: mpv time advances and SQLite records progress.
- AppRoot replay: the palette frame contains `Movie · videasy · history` and the
  backend records `tmdb:smoke-movie-1`; both citations were mechanically checked.
- Live YouTube: metadata resolves, inventory reaches 2160p, and Shorts search
  returns only Shorts. A separate headless mpv run decodes one frame of the
  official Big Buck Bunny fixture using Kunai's resolved format and raw options.
  This does not qualify interactive switching, physical terminals or mobile.
- `bun audit --json` returns an empty advisory result. React Doctor reports no
  newly introduced findings against the pre-follow-up candidate.

Evidence logs use `/tmp/kunai-search-final-*`; redacted live and worktree snapshots
are under the task's `20261026-search-youtube-recovery` artifact directory.

Release remains blocked: the fresh live-default signoff resolves and probes the
series and anime routes, but the default VidLink movie route returns no stream
(`provider-drift`). Its fixture, timeout and resolve gate were not weakened.
GitGuardian's historical-fixture disposition remains with the user. Hosted checks
must run on the new head; physical-device and final publication/provenance gates
remain separate. No remote PR merge, release tag or package publication occurred.

The primary checkout is clean on `main`, aligned with `origin/main`. The worktree
audit found 40 existing checkouts, 23 with uncommitted work; notably,
`docs/kanna-stay` has 31 unpushed commits and `deps/ink-8` has one. They were
preserved. Only the stale registration for the already-missing cursor-audit
worktree was pruned; its branch and commits remain available.

## October 27: upstream controls and live-roster parity

The bounded VidLink comparison used Dune (438631), Fight Club (550) and
Inception (27205), with identical encryption and production movie request paths.
Dune returned HTTP 200 with JSON `null`, both with `webkit` and with no playback
environment header. Both controls returned DASH manifests and 15 captions. No
signed URL or cookie was retained. This is a title-specific upstream no-source
observation, not a local encryption fix or a green default-route signoff.

The production live-smoke aggregate had drifted: it still invoked retired AniDB,
while omitting VidRock and Videasy. A new roster-derived regression failed on
that mismatch, then passed after the aggregate was reconciled to all 11 live
production modules. The root and CLI AniDB smoke aliases were removed. Historical
fixtures stay available without claiming current production search coverage.
The focused roster file passes 10 tests; CLI typecheck and lint pass, with the
existing warnings retained. No runtime defaults or probe gates changed.

## October 27: mobile preview guide recovery

The website integration branch now includes the unique public guide and navigation
entry from PR 499. It was checked against the current mobile host-proof contracts
and corrected to keep physical Android/iPhone qualification pending, distinguish
probe traffic from VLC handoff, and preserve uncertain lock ownership. Stale
generated metadata from PR 499 was not copied; current metadata was regenerated.
The website suite passes 452 tests; its typecheck, lint, and production build pass.
This is documentation recovery, not a supported mobile release or permission to
close PR 499 before the integration lands.
