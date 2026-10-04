# Production provider gate follow-up — 2026-10-04

Baseline: #564 at `e3c81296fd7f134f4a8f599d39cfa9cde38ece99`. Source authority: `apps/cli/src/container/bootstrap-providers.ts`. Twelve adapters are returned, while the prior resolve-gate test enumerated only eight. The omitted Movy, HiAnime, AnimeGG and KickassAnime adapters had no shared-gate call. The two documented runtime exemptions (YouTube and Miruro) are retained and are not claims of direct-media verification.

## Reproduction and repair

Eight focused cases failed before the adapter fixes: the four newly covered roster entries and four real adapter resolves whose fixture media URL answered 403. Each adapter still returned resolved. This disproves the old test's implication that all registered adapters had gate coverage. Fixtures use injected fetch ports and never request real provider/media URLs.

The four gate changes and registry-derived coverage are adapted from #500's exact head `e5fd018af3d6`. Only those adapter calls, coverage and the necessary KickassAnime fixture updates are carried; the PR's broader network changes are not copied. Existing cancellation/error-classification changes on this baseline are preserved. KickassAnime's old “missing master still plays” test is corrected to require an exhausted result; its healthy fixture now includes a media playlist and segment bytes instead of an infinitely repeating master.

Three quality cases also failed before the selection adjustment: pinned HiAnime sub/dub lanes ignored requested 360p, and a pinned AnimeGG mirror ignored requested 1080p. HiAnime consumes its lane pin before rung selection; AnimeGG's matching active-mirror pin no longer acts as a first-rung preference. Explicit stream id behavior remains intact.

Focused fixture checks pass **158 tests**, including refusal and cancellation during the probe for all four adapters, no provider-success event on either failure, both HiAnime audio lanes, and the selected AnimeGG candidate's exact referer/user-agent reaching the media probe. A separate two-host fallback fixture rejected 1080p and accepted 720p; it caught stale selected-quality diagnostics before the final correction. Returned streams and variants now exclude the refused host, and diagnostics report the rung actually shipped. Existing parser, title identity, source inventory, quality, language, relay and catalog fixtures run in the same set.

The shared gate rejects definitive refusal, permits indeterminate/slow probes as unverified, and uses the existing host-refusal policy. This follow-up does not change that policy or prove live video playback. Probe cost can affect resolve latency; measure the integrated candidate's stage budgets before claiming faster startup. The coverage parser fails on an empty roster parse; if the bootstrap import form changes, update its explicit regex/test rather than accepting no coverage.

## Remaining provider release gates

The metadata-only AllManga bootstrap was fresh earlier in this pass. Live default-route signoff, regional provider behavior, headers/subtitles at actual mpv handoff, current provider-status publication, DNS destination binding and the older #508 relay-marker findings still need their own revision-bound evidence. The static status/matrix probe lists also remain smaller than the full registry and need explicit per-adapter coverage decisions. No provider board, account setting, review thread or release was published by this repair.

Fresh full local verification: **8,167 passed, 60 skipped, zero failures; 26 successful tasks and zero cache replays**. Typecheck passed 15 fresh tasks; lint passed 14 fresh tasks with zero errors and 20 existing warnings. The final CLI/host binary build passed ten fresh tasks. Format/check, documentation paths/frontmatter, the anti-slop ratchet, version guard and 15 installed-consumer dependency-patch checks passed. These are local receipts; hosted checks and external evidence remain separately qualified in the follow-up PR. Merge #564 before this branch; refresh the integration plan's base/head and checks after any rebase or conflict.
