# Kunai 0.2.6

0.2.6 — 2583ec8: Ship the post-0.2.5 Kunai release train.

This release includes the YouTube provider lane with Invidious/Piped/ytsearch metadata, yt-dlp playback gating, playlist/channel selection, live/upcoming handling, SponsorBlock/cookie settings, metadata cache, diagnostics probes, download/playback parity, video watch-history stats, and an opt-in live YouTube smoke.

It also rolls up the unreleased CLI work since 0.2.5: persistent playback and mpv lifecycle hardening, provider fallback and endpoint-health diagnostics, share links and `kunai://` round trips, offline/download library improvements, watch-ledger stats and continuation identity reconciliation, queue/playlist/notification/calendar/detail surfaces, settings-shell polish, storage migrations, native installer/update/release-note infrastructure, docs truth-sync, and package/build reliability gates.

Release notes should call out that YouTube playback requires `yt-dlp`, YouTube age-restricted content requires user-supplied cookies, provider relay remains user-owned, live provider smokes are opt-in, and the release gate now includes deterministic checks plus targeted provider reality checks.
