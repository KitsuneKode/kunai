# Watching candidate — October 22, 2026

Initial runtime implementation **cf83c54054007bc0b268026bae2004ad01e7e1cd**, based
on main **8a86bf9dc3d0e8315522624c939df807ea69e028**. This is a qualification
record, not a published release or merge approval. Original dirty root checkout
was preserved. The candidate is on `fix/watching-release-readiness-20261022`.

Latest source follow-up: `ebb3a8a54`, including the safe manual launcher,
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
