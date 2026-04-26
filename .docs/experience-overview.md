# KitsuneSnipe Experience Overview

This document explains what KitsuneSnipe is trying to be from a user perspective. It is intentionally higher-level than the engineering plans.

## What KitsuneSnipe Does

KitsuneSnipe is a terminal-first media discovery and playback handoff app.

It helps users:

- search for movies, series, and anime from a fullscreen TUI
- inspect search results before committing to playback
- choose providers, seasons, episodes, subtitles, and settings without leaving the shell
- resolve playable stream URLs through supported providers
- launch playback in `mpv`
- return to the shell after playback for replay, next episode, provider changes, diagnostics, history, or a new search

The goal is a fast, keyboard-native experience that feels closer to a polished streaming app than a chain of prompts.

## What KitsuneSnipe Does Not Do

KitsuneSnipe does not host media.

It does not:

- store video files on a KitsuneSnipe server
- upload, mirror, seed, or redistribute video content
- own or operate third-party streaming infrastructure
- guarantee that third-party providers are available, lawful, complete, or stable
- bypass DRM
- require accounts or centralized user tracking for core playback

All playable content, manifests, subtitles, posters, metadata, and related assets are provided by non-affiliated third-party services and infrastructure.

Copyright or DMCA-style notices for specific media should be directed to the actual hosting or serving provider.

## Current Experience

The current app supports:

- movie, series, and anime modes
- configurable default startup mode
- provider switching
- searchable browse/results flow
- filterable pickers for common list flows
- watch history and resume behavior
- app-owned autoplay through available released episodes
- subtitle policy for disabled, provider-default, and interactive subtitle picking
- diagnostics panels with stream, subtitle, provider, and recent runtime event state
- shared Ink root host for smoother terminal screen handoffs
- fullscreen layout policy with resize blockers for too-small terminals

## Planned Experience

The next experience goals are:

- finish the explicit root `AppShell` state machine for browse, playback, overlays, and post-playback
- move start season, start episode, and subtitle selection into true mounted overlays
- add richer metadata and preview panes when providers or metadata services actually supply useful detail
- add image preview support in browse and picker contexts without making the shell depend on image protocols
- harden provider inventories for subtitles, qualities, audio/dub variants, and multiple stream hosts
- add a developer mode with clearer provider, stream, subtitle, cache, and player diagnostics
- add local-first usage stats and future export/sync hooks
- later add opt-in integrations for services such as MAL, AniList, IMDb, and TMDB
- add a bounded mascot system after the shell layout and motion lanes are stable

## Design Principles

The shell should feel:

- fast under repeated keyboard use
- readable during long sessions
- explicit about what is loading, missing, disabled, or unavailable
- calm enough for terminal use, but visually intentional
- responsive to terminal size without relying on scrollback
- privacy-safe by default

The footer should stay compact. The command palette and help panels should carry deeper discovery.

## Provider Expectations

Providers are treated as integrations, not permanent truth.

Provider work should:

- begin with a research dossier for non-trivial sites
- document known, suspected, and unknown behavior
- distinguish stable metadata from volatile stream/session data
- prefer deterministic API or hybrid extraction when research proves it is reliable
- keep Playwright fallback paths where browser behavior is genuinely required
- emit diagnostics that explain which stage failed

AllAnime-family parity should track the local `ani-cli` reference for that provider family only. It is not the standard for every anime provider.

## Privacy And Diagnostics

Diagnostics are local-first.

The app should:

- keep small local traces for recent runtime events
- avoid automatically uploading reports
- redact or avoid sensitive data by default
- make report generation explicit and user-initiated
- show enough local diagnostic state to make provider drift easier to debug

History and stats should remain local unless future sync/export features are explicitly enabled by the user.
