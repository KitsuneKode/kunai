---
"@kitsunekode/kunai": patch
---

Improve the terminal UX around discovery, offline watching, playback recovery, diagnostics, and minimal startup flows.

Discovery now preserves artwork on release-calendar entries, exposes discover/offline/download/filter commands from browse, adds `--discover`, and makes `/random` / `/surprise` use a cached randomized catalog pool instead of only reshuffling trending picks. Search also has guided filter chips so richer queries can be built without blocking result browsing.

Offline mode now behaves more like a local library: rows are grouped by title, show clearer shelf metadata, include local availability in search context, expose queue/online handoff actions, support title-level integrity/repair/delete actions, persist poster and IntroDB/AniSkip timing metadata for downloads, generate best-effort local thumbnails with `ffmpeg` when available, and work with the new `--zen --offline` minimal shelf flow.

Playback and diagnostics are clearer: provider fallback attempts are recorded as a bounded timeline, recover is described as a stream refresh/resume action, command palette rows are width-aware, details panels use cleaner selection/local/details/synopsis/availability sections, diagnostics/report exports are pruned, smoke-test recipes are available from Diagnostics, and loading status copy no longer presents healthy subtitle attachment or provider retry progress as an error.

Release documentation now includes a feature tour, expanded onboarding/playback/offline guidance, and VHS demo scripts for onboarding, discovery, offline, diagnostics, and launch-story capture.
