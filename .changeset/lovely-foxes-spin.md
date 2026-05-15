---
"@kitsunekode/kunai": patch
---

Improve the terminal UX around discovery, offline watching, playback recovery, diagnostics, and minimal startup flows.

Discovery now preserves artwork on release-calendar entries, expands anime `/calendar` into a cached 7-day AniList airing window with day headers, time columns, episode badges, popularity/score metadata, and provider-backed playback mapping, exposes discover/offline/download/filter commands from browse, adds `--discover`, and makes `/random` / `/surprise` use a cached randomized catalog pool instead of only reshuffling trending picks. Search also has guided filter chips, including local/downloaded/watched/release/provider chips, so richer queries can be built without blocking result browsing.

Offline mode now behaves more like a local library: rows are grouped by title, show clearer shelf metadata, include local availability in search context, expose queue/online handoff actions, support title-level integrity/repair/delete/protect actions, persist poster and IntroDB/AniSkip timing metadata for downloads, generate best-effort local thumbnails with `ffmpeg` when available, and work with the new `--zen --offline` minimal shelf flow.

Local and online playback now share a clearer source-selection boundary: offline rows never trigger provider resolution implicitly, cached local browse filters can narrow already-loaded results by downloaded/watched/release/provider facts without extra provider calls, `--continue` and history launches record exact ready local matches without hijacking the online flow, broken local artifacts surface repair guidance, and downloaded playback follows the same autoskip settings as streamed playback.

Playback and diagnostics are clearer: provider fallback attempts are recorded as a bounded timeline, active playback now shows the exact provider identity, recover is described as a stream refresh/resume action, suspected dead-stream EOFs invalidate cached URLs and refresh the source instead of looping on stale cache, anime caught-up screens fall back to discover recommendations instead of TMDB-only title recommendations, long picker selections are clamped and highlighted consistently after result changes, next-episode prefetch now starts near known credits timing when available, command palette rows are width-aware, details panels use cleaner selection/local/details/synopsis/availability sections, diagnostics/report exports are pruned, smoke-test recipes are available from Diagnostics, and loading status copy no longer presents healthy subtitle attachment or provider retry progress as an error.

Release documentation now includes a feature tour, expanded onboarding/playback/offline guidance, and VHS demo scripts for onboarding, discovery, offline, diagnostics, and launch-story capture.
