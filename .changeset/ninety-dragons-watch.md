---
"@kitsunekode/kunai": minor
---

Kunai 0.2.0 bundles the beta shell, playback, provider, and offline work landed since 0.1.4.

**Playback and reliability**

- Persistent mpv session with clearer playback supervision, recovery modes, dead-stream guards, and provider fallback policy.
- During playback, the shell now shows a compact facts strip (source inventory, quality/audio/sub tracks, autoplay/autoskip state) plus a short live-key legend so controls are visible without opening the command palette.
- Source inventory projection for stream, source, quality, and media-track pickers; playback reliability gates and diagnostics correlation.

**Lists, sync, and attention**

- Watchlist, playlists, stats, sync handoffs, notification inbox, queue recovery, and queueable post-playback recommendations.
- Safe playlist import/export and identity-based notification/queue contracts (no raw stream URLs in durable exports).

**Shell and discover**

- Launch redesign surfaces: post-play hierarchy, loading stages, calendar/discover polish, viewport resize blocker, and calmer footer/command palette behavior (browse search layout unchanged).
- Onboarding slides, history grouping, continue-watching shelf, and expanded settings section intent copy so choices are harder to misread.

**Providers and offline**

- Provider metadata v2, cycle engine, evidence fixtures, and normalized source inventory across direct providers.
- Download sidecar repair states, repair-all sweep, and download metadata that preserves selected source/quality on enqueue.
