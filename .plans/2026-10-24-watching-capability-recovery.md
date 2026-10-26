# Watching capability recovery

Status: IMPLEMENTED LOCALLY. Forced combined gates pass; live/platform qualification remains. Base: f3e893ce7. The October 24 screenshot report is the
acceptance scope, extending the October 23 UX pass rather than assuming it is
complete. Existing Ink, player bridge, provider gate and app boundaries remain.

## Intended behavior

Requested/default subtitle state must agree with actual mpv visibility. Users can
reach provider, source, quality, subtitles, speed and fallback choices from the
watching/loading/failure journey. Visible action hints are clickable when available
and have the same guarded keyboard action. Focus/press feedback is visible without
relying on color or decorative delays; hover is supported only if the terminal
actually supplies motion reports. Single/unknown capabilities are facts, not fake
choices. Auto never invents available resolutions or upstream health.

Provider source/quality/subtitle inventories must preserve real HLS ladders,
stream/source identity and exact selection. Unknown and untested remain distinct
from broken, title-not-found and verified playable. Anime-specific sources lead
anime selectors, eligible shared providers follow. A failure offers provider
switch/fallback recovery without falsely declaring the title absent everywhere.
YouTube formats are meaningful resolution/codec/bitrate choices, not unexplained
duplicates, and video/anime identity stays separate from movie/episode structure.

Search suggestions reuse existing preview metadata and have a visually distinct,
keyboard/pointer accessible surface. Loading motion indicates actual work, respects
reduced-motion/offscreen policy, and never delays navigation. Mobile parity follows
the actual mobile architecture; web CSS/shadows apply only to real DOM surfaces.

## Work lanes

1. Parent: subtitle preference vs live sid/visibility/late attachment, clickable
   hints/shared footer ownership, useful primary controls, loading/failure recovery,
   suggestion surface and existing mpv selector integration.
2. Antigravity Gemini 3.8 High research: VidLink/Rivestream/VidRock/Movy raw response
   through master expansion, probe, inventory projection and exact selection.
3. Antigravity Gemini 3.8 High research: anime identities, fallback exclusions,
   failure classification, ordering/health and local ani-cli comparison.
4. Antigravity Gemini 3.8 High research: YouTube quality/client identity, video
   labeling, speed/defaults, supported segment skipping and mobile capability gaps.
5. Parent integrates only reproduced actionable fixes, tests reverse/error/narrow
   states, and checks provider-origin/protocol/process/IPC trust boundaries. No
   broad security assurance from a single audit or speculative performance change.
6. Bounded current-provider qualification and intake decisions. FMHY is a discovery
   directory, not a playback or independence guarantee. No deprecation/default
   replacement from one outage, and no provider additions without verified unique
   capability and the normal intake/gate requirements.

## Verification and constraints

Use failing-first regressions where behavior changes. Keep captured demo/worst-case
fixtures for long/non-Latin names, zero/one/many tracks, missing metadata, selected
stale rows and deferred failures. Prove declaration-to-reader, reverse states,
browse/palette/player/post-play entrypoints and anime/TMDB/YouTube identity decisions.

All runtime work uses isolated HOME/USERPROFILE/XDG/APPDATA/LOCALAPPDATA with file
credentials. No live SQLite, KUNAI_CONFIG_DIR, implicit analytics or OS registration.
Preserve other worktrees, especially active provider rewrites. No unprobed stream,
expanded timeout, malicious fetched script execution or exposed signed URLs.
No remote merges or release publication. Chromecast/cloud/full torrent/debrid
remain excluded. Phone and hosted-platform qualification stay explicit external
gates when hardware/CI is unavailable.

Apply requested animate/find-animation-opportunities/interaction-design as
state-feedback gates; better-interface/accessibility and break-ui as behavior and
layout checks. Beautiful shadows/mobile-native/modern-web-guidance apply to actual
web surfaces only. REA tool-design informs investigation/evidence boundaries;
ordinary source tracing remains repository analysis, not a reason to invent a
new investigation service. Run forced types/lint/tests, format/docs and build after
integration, followed by real terminal/mpv and bounded live evidence where possible.

## Subsequent requested capabilities

YouTube already has explicit trending, history-based recommendations and channel
upload browsing; verify filtered channel search before calling that journey
complete. Live TV/sports intake remains in the competitive parity plan: prove a
legitimate source and live timeline before promising event coverage. Manga/comic
reading belongs to [the reader lane](./manga-reader-lane.md), not AllManga. These
expansions are separate from completion of the current watching recovery.

## Local verification and remaining work

The implementation and four final review fixes pass the fresh forced root suite
(9546 pass, 62 skip), types, lint, host build and documentation checks. The unchanged
3120 KiB bundle cap passes. See [candidate evidence](../.release/watching-candidate-2026-10-22.md)
for exact counts, isolated terminal/mpv proofs and limitations. Remaining work is
live-provider decoded playback across representative titles, hosted macOS/Windows,
physical phones and release integration; no publish or merge is authorized here.
