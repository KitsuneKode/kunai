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

Fresh forced candidate graph: 9,585 passed, 62 skipped, zero failed; 26 tasks,
zero cached. Fresh types, lint, formatting, doc paths, coverage routing and CLI
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
