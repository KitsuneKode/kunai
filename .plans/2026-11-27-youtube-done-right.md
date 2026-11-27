---
status: active
created: "2026-11-27"
lastReviewed: "2026-11-27"
---

# YouTube playback in Kunai

Keep extraction in a user-installed yt-dlp. Make Kunai own the handoff from the
selected formats to the player, the evidence that the media is reachable, and the
controls people use while watching. Use anonymous access by default. Keep catalog
lookups independent from media acquisition so a public instance outage cannot
break playback from a known video ID.

## What the other clients do

| Client              | Stream acquisition and maintenance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Features worth borrowing                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ReVanced            | Patches the installed Android YouTube app and substitutes streaming data from alternative InnerTube clients. The Android Reel change was introduced to restore playback and a 6.1.1 development build made it the default. The source diff shows Android VR, Android No SDK and VisionOS alternatives. Troubleshooting also documents Android No SDK and iPadOS to restore the audio-track menu on applicable builds. It advises changing the client on buffering and repatching after upstream breakage. An August change proposes rejecting SABR-only fallback responses to preserve quality selection. Client defaults are release-specific. [Client source diff](https://gitlab.com/ReVanced/revanced-patches/-/merge_requests/6830/diffs), [6.1.1-dev.1](https://gitlab.com/ReVanced/revanced-patches/-/releases/v6.1.1-dev.1), [Troubleshooting](https://github.com/ReVanced/revanced-documentation/blob/main/docs/revanced-resources/troubleshooting.md#24-youtube-audio-track-menu-is-missing), [Quality proposal](https://gitlab.com/ReVanced/revanced-patches/-/merge_requests/6983) | SponsorBlock skips segments in the video, Return YouTube Dislike (RYD) restores a dislike display via a separate service, and background playback and ad hiding are app patches. Stream spoofing is separate from these features. [ReVanced patches](https://gitlab.com/ReVanced/revanced-patches), [Archived patch catalogue](https://gitlab.com/cuynu/oldvanced-patches-rvx), [June playback fix](https://dev.revanced.app/announcements?id=23-youtube-and-youtube-music-playback-issues-fixed) |
| NewPipe / Extractor | Android frontend with its own Java extractor for YouTube's internal responses, player script and manifests. Extractor 0.26.3 switched to VisionOS when SABR enforcement removed usable URLs from its prior client, with kids' videos potentially reduced to one muxed 360p stream. Version 0.27.0 removed broken Android/iOS PO-token paths and the obsolete web-embedded path, updated n-sig parsing and marked auto-dub tracks. [Client change](https://github.com/TeamNewPipe/NewPipeExtractor/pull/1508), [0.27.0](https://github.com/TeamNewPipe/NewPipeExtractor/releases/tag/v0.27.0)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Account-free search, local playlists/subscriptions, captions, 4K where available, and audio-only background play. The Tubular fork adds SponsorBlock and RYD. [NewPipe features](https://github.com/TeamNewPipe/NewPipe#features), [Tubular](https://github.com/polymorphicshade/Tubular)                                                                                                                                                                                                         |
| yt-dlp              | Extracts player responses with several InnerTube client profiles and returns progressive formats, adaptive audio/video, or HLS/DASH where available. 2026.11.23 documents the anonymous default `tv_samsung,visionos,web` with JS support and different defaults for cookie-authenticated use. It added `ios_producer` and fixed signature timestamp and live/post-live paths in that release. [Pinned extractor options](https://github.com/yt-dlp/yt-dlp/blob/2026.11.23/README.md#youtube), [2026.11.23 release](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.11.23)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Owns format selection, captions and translated captions, chapters, playlist/channel paging, search, live extraction, and SponsorBlock chapter/segment metadata for downloads. Its output is a viable input to Kunai's player control and local library. [Options and format selection](https://github.com/yt-dlp/yt-dlp/blob/2026.11.23/README.md)                                                                                                                                                |
| Invidious / Piped   | Invidious separates its web/API tier from the YouTube.js-based Companion for stream extraction. Media can go direct or via an instance depending on setup. Piped's backend uses NewPipe Extractor and the frontend uses a media proxy. Both put extraction pressure on a shared server IP. [Companion](https://github.com/iv-org/invidious-companion), [Invidious streaming FAQ](https://docs.invidious.io/faq/), [Piped backend](https://github.com/TeamPiped/Piped-Backend), [Piped proxy](https://github.com/TeamPiped/Piped-Proxy)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Browse/search, channels, playlists and subscriptions. Piped also lists SponsorBlock, RYD, audio-only and 4K support. Use the metadata API boundary and keep instance health separate from local playback health. [Invidious](https://github.com/iv-org/invidious), [Piped features](https://github.com/TeamPiped/Piped#features)                                                                                                                                                                  |
| FreeTube            | Local YouTube.js extraction with optional Invidious fallback. The local backend added native SABR to its Shaka playback flow and recovered selectable audio tracks. Release notes report server-directed ad/backoff timers and automatic retry/reload. 0.26.0 beta restored live playback with live seeking still out of reach. Shared public APIs have also disabled third-party access. [Local API](https://github.com/FreeTubeApp/FreeTube-Docs/blob/master/usage/local-api.md), [Releases](https://github.com/FreeTubeApp/FreeTube/releases), [Maintainer account of public API failures](https://github.com/FreeTubeApp/FreeTube/issues/8524)                                                                                                                                                                                                                                                                                                                                                                                                                                             | On-screen chapter navigation, local history/playlists, subtitles and audio selection, SponsorBlock category behavior, and DeArrow with a show-original action. [Releases](https://github.com/FreeTubeApp/FreeTube/releases), [Player and metadata settings](https://github.com/FreeTubeApp/FreeTube/blob/development/static/locales/en-US.yaml)                                                                                                                                                   |
| Grayjay             | Delivers YouTube through a separately versioned FUTO source plugin. Its published settings and changelog show Samsung TV, iOS Producer and VisionOS alternatives, generated DASH and native SABR/UMP playback, token support, n-parameter fixes, source checking and plugin reload on recovery. Those are plugin capabilities; site responses and player support still determine playback. [YouTube source settings and changelog](https://github.com/futo-org/grayjay-plugin-youtube/blob/master/YoutubeConfig.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Original audio labeling, language selection, seek thumbnails, optional DeArrow, and manual or automatic SponsorBlock per category. [YouTube plugin](https://plugins.grayjay.app/Youtube/YoutubeConfig.json)                                                                                                                                                                                                                                                                                       |

## Where playback breaks in late November 2026

1. **Browse and player requests.** An instance can lose upstream access, disable
   its public API, or get a bot/sign-in response before returning playback data.
   A working search tells us little about media. A failing shared instance and
   a local YouTube refusal are distinct. An explicit 429 merits bounded
   backoff. An explicit account, region or entitlement refusal should reach the
   user directly. A generic 403 alone cannot establish an IP ban.
   [Invidious diagnostics](https://docs.invidious.io/youtube-errors-explained/),
   [yt-dlp extractor guidance](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#youtube).
2. **Player response and format inventory.** SABR is YouTube's request-driven
   adaptive streaming protocol. A `serverAbrStreamingUrl` is insufficient as
   a standalone media URL for mpv/VLC. The web client lost ordinary adaptive
   HTTPS URLs, and requirements differ by profile, content and rollout. A
   single muxed rendition can survive while HD/4K and additional audio vanish.
   NewPipe switched client profiles, FreeTube and Grayjay implemented SABR
   playback, and yt-dlp's SABR downloader is still an open PR at this review.
   A downloader landing upstream would still need a proven mpv/VLC handoff.
   [Web rollout](https://github.com/yt-dlp/yt-dlp/issues/12482),
   [yt-dlp SABR PR](https://github.com/yt-dlp/yt-dlp/pull/13515).
3. **URL derivation and content requests.** The player JS can change both the
   signature deciphering step and the transform for the `n` parameter, which
   affects throttling or request success. The yt-dlp EJS solver handles its
   current JavaScript challenges using a supported JS runtime. PO tokens are a
   separate attestation signal with distinct player, Google Video Server (GVS)
   and subtitle contexts. yt-dlp's guide documents enforcement on GVS and
   subtitles for affected clients. Missing tokens can silently remove formats,
   yield 403s from media or caption hosts, or coincide with a block. Tokens
   and signed URLs can depend on the session, video, client and egress. Keep
   extraction and media on the user's connection.
   [EJS](https://github.com/yt-dlp/yt-dlp/wiki/EJS),
   [PO Token Guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide).
4. **yt-dlp controls.** `--extractor-args youtube:…` takes a single YouTube
   prefix with semicolon-separated keys and comma-separated values.
   `player_client` chooses the profile set, `po_token` supplies externally
   configured tokens, `player_skip` trades requests for missing data, and
   `skip=translated_subs` limits captions. Leave these overrides explicit
   and preserve the user's existing choices. Document the observed yt-dlp version
   alongside any client-policy decision.
   [Pinned argument contract](https://github.com/yt-dlp/yt-dlp/blob/2026.11.23/README.md#youtube).

## Kunai at the reviewed revision

Reviewed `8a5f0d5967dc52892d954be3b77c1331ff5f21f6` on Linux. The
[provider dossier](../.docs/provider-dossiers/youtube.md) explains the split.
The production video lane is local-only and relay-unsafe.

- **Discovery** uses Invidious, optional configured Piped and flat local
  yt-dlp. Shorts use a dedicated first path. Playlist/channel listing uses
  Invidious with a local fallback capped at 50; search fallback is capped
  at 12. Video, collection and live/upcoming identities are already modeled.
  [Provider](../packages/providers/src/youtube/direct.ts)
- **Resolve and playback** use different yt-dlp invocations. Config wires a
  15-minute normalized metadata cache and a default `visionos,web` client
  list. The provider projects one extracted ladder across client lanes,
  emits a watch URL with `requiresYtdl`, and returns success even without
  successful extraction on transient errors. mpv's hook then independently
  extracts using the selected client's arguments. Desktop VLC rejects this
  contract because it has no yt-dlp hook. The current resolve-gate test
  exempts YouTube by name. A watch-page probe or a successful metadata
  extraction alone cannot attest the eventual CDN request.
  [Config](../apps/cli/src/container/configure-youtube-provider.ts),
  [Default clients](../packages/config/src/defaults.ts),
  [Player options](../apps/cli/src/services/providers/youtube-playback-options.ts),
  [Gate exemption](../packages/providers/test/provider-resolve-gate-coverage.test.ts),
  [VLC handoff](../apps/cli/src/infra/player/vlc/vlc-player-service.ts)
- **Tracks and timing** have exact video format IDs with codec/FPS/bitrate
  labels where known. Video-only formats are paired with best audio; the
  ladder has no independent language/dub selection or HDR policy. Caption
  normalization keeps manual and automatic inventory and bounds the offered
  automatic translations. Actual active tracks come from mpv. The normalized
  cache has no chapter inventory. SponsorBlock category settings already reach
  both yt-dlp downloads and the mpv hook, with no demonstrated streaming skip.
  [Format selectors](../packages/providers/src/youtube/yt-dlp-metadata.ts),
  [Metadata](../packages/providers/src/youtube/metadata-normalize.ts),
  [Caption policy](../packages/providers/src/youtube/subtitle-language.ts),
  [Existing options](../packages/providers/src/youtube/ytdl-options.ts)
- **Viewing state and live** already use provider-native video IDs for history
  and enrichment. The provider treats upcoming premieres as unavailable and
  sends active live streams to the live edge. The handoff suppresses resume
  seeking for active live streams. Preserve ordinary VOD resume and the
  distinction between active live, replays and post-live processing. Mobile's
  VLC handoff reports acceptance and cannot observe decode or progress.
  [History enrichment](../apps/cli/src/services/youtube/youtube-history-metadata.ts),
  [Live result mapping](../apps/cli/src/services/providers/provider-result-adapter.ts),
  [Mobile contract](../apps/mobile/src/application/run-mobile-application.ts)
- **Failures** distinguish several explicit refusals using fixed messages.
  Transient metadata loss currently falls through to an unproven watch URL.
  The subprocess wrapper has its own timeout. Playback also has outer
  attempt budgets of 6/12/30 seconds for fast/balanced/quality-first, which
  must govern extraction and probing together.
  [Failure classifier](../packages/providers/src/youtube/metadata-failure.ts),
  [Attempt budget](../packages/core/src/provider-attempt-budget.ts)

### Verification on November 27

- Provider YouTube tests, duration tests and resolve-gate coverage had 147
  passes, 1 skip and 0 failures. CLI YouTube and token-plugin tests had 46
  passes and 0 failures. Both package scripts ran directly with private storage
  roots from `storageRootEnv`.
- The existing `bun run test:live:youtube` in the restricted shell exited 1.
  It emitted a resolved watch URL alongside `network-error` and
  `streamReachable: false`, then exited before checking the higher-quality
  fixture. The separate search → resolve → play harness identified DNS failure
  in this environment. That is evidence of the resolve false positive, with
  no evidence of an upstream IP block.
- Outside the network-restricted shell, with a fresh disposable profile,
  analytics disabled and no credentials, provider search for “Me at the zoo”
  returned nine rows including the fixture. The production container engine
  resolved that row in 2.38 s with 12 format variants and no failure codes.
  Headless mpv 0.42.0 with yt-dlp 2026.11.23 used the adapted stream and
  advanced private IPC `time-pos` to 2.93 s across 45 samples before exit 0.
  This was a bounded adapter-to-player test on one public short VOD. It did
  not exercise the interactive TUI, recorded history, live, 4K/HDR, translated
  subtitles, category skips, restricted content, VLC, or a physical mobile
  device.

## Ranked changes

### 1. Resolve concrete media once and verify the exact handoff — L, high risk

Add a typed, cancellable yt-dlp extraction result for direct muxed URLs, separate
video/audio resources, or a handoff-compatible manifest. Parse the selected
format response and required per-resource headers. Preserve session context from
extraction to probe and player. Run `verifyCandidateStream` with positive
direct-media evidence on every required resource in the candidate. A 403 on the
audio leg rejects the pair even if video passes. Use the same URL and headers in
the player; qualify separate audio and per-resource headers through mpv before
advertising the pair. Start VLC with validated single URLs or supported
manifests, and expose a clear player capability reason for unsupported pairs.
Treat URL-less SABR, DRM and unsupported protocols as explicit outcomes.

Carry expiring URLs in memory with a conservative expiry and re-resolve on a
stale or refused handoff within the playback budget. Cache stable format
descriptors and watch identity. Resolve an alternate quality/client on demand
before promoting it to a playable source. Remove the exemption when the
production path uses the shared gate. Require real decoded audio and picture on
a sample of progressive, adaptive and manifest fixtures because media
reachability alone does not prove decode.

Files — `packages/providers/src/youtube/direct.ts`,
`yt-dlp-metadata.ts`, `spawn-ytdlp.ts`, `packages/types/src/index.ts`,
`packages/providers/src/shared/resolve-gate.ts`,
`packages/providers/test/provider-resolve-gate-coverage.test.ts`,
`apps/cli/src/services/providers/provider-result-adapter.ts`,
`apps/cli/src/app/playback/source-quality.ts`,
`apps/cli/src/infra/player/PersistentMpvSession.ts` and VLC handoff.
Risk comes from dual-resource headers, freshness, secondary track loading
and the latency budget.

### 2. Use upstream client policy and make failures actionable — M, medium risk

Let the selected yt-dlp release own anonymous and authenticated default
client sets. Keep explicit user-supplied extractor arguments and use per-lane
evidence when they constrain the inventory. Migrate the shipped default only
where inherited values are known. Share executable discovery and report version,
EJS runtime availability and plugin presence in doctor and startup diagnostics.
Keep executable updates and external components under user control. Preserve
the existing explicit cookie and vaulted-token options with redaction.

Classify missing dependency/challenge solver, missing supported formats,
throttling, blocked/bot, unavailable region, age/entitlement, timeout and media
403 by stage. Prefer upstream-supported anonymous formats when available.
Stop on explicit restrictions, surface the reason and offer the ordinary watch
page. Retry transient conditions within the attempt budget, respect backoff and
stop retry loops on hard refusal. Distinguish protocol/format loss from total
unavailability. Extend the smoke to search and use selected media gate evidence
and an mpv IPC decode witness; retain a high-quality fixture alongside the
control VOD. Publish only sanitized stage, count, quality and timing values.

Files — `packages/config/src/defaults.ts`,
`packages/providers/src/youtube/{metadata-failure,ytdl-options,version-freshness}.ts`,
`apps/cli/src/container/configure-youtube-provider.ts`,
`apps/cli/src/services/ytdlp/YtDlpService.ts`,
`apps/cli/src/services/youtube/youtube-diagnostics-probes.ts`,
`apps/cli/src/services/update/run-doctor.ts`,
`apps/cli/test/live/youtube.smoke.ts`,
`.github/workflows/provider-status-sweep.yml`. Risk comes from mistaking
warning text for policy and migration of custom configuration.

### 3. Make the quality, audio and caption choices real — L, high risk

Preserve client provenance, height, FPS, video codec, bitrate and dynamic range.
Expose available 2160p/VP9/AV1/HDR in the existing quality picker. Offer a
decoder-compatible automatic setting, maintain explicit ceilings, and expose
HDR/SDR decisions clearly when the terminal host or display cannot render HDR.
Use mpv-observed codec and video parameters as the release witness. For VLC, show
only formats supported by the verified handoff and preserve the current explicit
unsupported reason where needed.

Give audio its own original/language/track identity, with explicit original,
dub and auto-dub labels when available. A live switch requires a player-track
or a verified re-load at the current position. Model manual captions, original
automatic captions and auto-translations as separate entries, fetch translations
only when requested and keep Off meaningful across reloads. Preserve VOD resume
by video ID across all choices. Keep old cache rows readable where safe and
re-extract stale inventory when full track info is needed.

Files — `packages/providers/src/youtube/{yt-dlp-metadata,metadata-normalize,youtube-metadata,quality-selection,subtitle-language}.ts`,
`apps/cli/src/services/providers/provider-result-adapter.ts`,
`apps/cli/src/app/playback/{source-quality,tracks-panel-pick,subtitle-status}.ts`,
`apps/cli/src/infra/player/{PersistentMpvSession,mpv-subtitle-tracks}.ts`.
Risk comes from fake availability across clients, mislabeled auto-dubs, loss
of resume position on track change and platform-specific decode support.
[mpv player and HDR options](https://mpv.io/manual/stable/)

### 4. Add chapter navigation and native SponsorBlock skip markers — M, medium risk

Normalize yt-dlp creator chapters and pass them to the existing per-file
chapter writer alongside labeled skip markers. Keep chapter navigation useful
when SponsorBlock is disabled. Add an opt-in SponsorBlock timing source keyed to
the resolved YouTube video ID, including inside collections. Fetch asynchronously
with a short timeout and a bounded cache. Use hash-prefix reads and match the
exact video in the response. Validate finite, ordered, duration-bounded intervals
and deduplicate overlaps. Start with sponsor, intro and outro category policies
with Off, prompt and automatic modes. Keep sponsor/outro classification out of
the credits/near-end completion decision. Use the current media clock and seek
paths so resume stays on the video's original timeline. Bind a late result to
the active playback generation. Keep download cutting as a download policy and
migrate existing category preferences into equivalent streaming choices after
native skip behavior is verified. Avoid double skips by removing the old mpv
flag for streaming when the native path takes ownership.

Files — `apps/cli/src/app/playback/playback-timing-lookup.ts` constructs the
`PlaybackTimingAggregator`, and `playback-stream-ready.ts` merges provider
timing and supplies live timing updates. Extend
`apps/cli/src/infra/timing/{PlaybackTimingSource,merge-timing,mpv-chapters}.ts`,
`apps/cli/src/domain/types.ts`, and
`apps/cli/src/infra/player/{playback-skip,PersistentMpvSession}.ts`.
Wire preferences through `apps/cli/src/app-shell/settings/registry/youtube.ts`
and active-playback controls currently gated to episodic paths. Check managed
VLC in `apps/cli/src/infra/player/vlc/vlc-auto-skip.ts`. Mobile handoff has
no comparable seek control. Risk comes from late updates, changed timelines and
credit segments triggering completion. [SponsorBlock API](https://wiki.sponsor.ajay.app/w/API_Docs),
[Hash-prefix privacy](https://github.com/ajayyy/SponsorBlock/wiki/K-Anonymity)

### 5. Finish search, collections, live and resume through real entry points — M, medium risk

Keep fast flat search and independent metadata health. Try local yt-dlp as the
default anonymous catalog path only after comparing result coverage, paging and
latency against existing backends. Keep user-configured instances as metadata
options and preserve genuine empty results. Page playlist/channel items on
demand with stable video IDs and one-based display positions. Cover search,
pasted video/channel/playlist URLs, queue, history and post-play with the same
video identity. Retain local history and resume across backends. Surface the
live edge, make active-live resume and timed skips unavailable, handle upcoming
and post-live explicitly, and validate replay seek independently of live playback.
For supported desktop players, consider an audio-only handoff using verified
audio and standard player controls. Require device proof for mobile playback.

Files — `packages/providers/src/youtube/{direct,ids,invidious-client,piped-client}.ts`,
`apps/cli/src/services/youtube/{YoutubeRecommendationService,youtube-history-metadata}.ts`,
`apps/cli/src/app/playback/{playback-episode-context,playback-player-launch}.ts`,
`packages/storage/src/repositories/history.ts` and mobile handoff capability
reporting. Risk comes from preserving item position, per-video history, correct
no-results semantics and live/replay transitions.

### 6. Offer DeArrow as an optional display preference — S, low risk

Use read-only branding with bounded, cached requests for visible items. Label
crowdsourced titles and thumbnails, provide a show-original action, and use the
creator title and art as the fallback on absence or failure. Keep canonical
video identity, history and share URLs independent of the display choice.
Defer RYD unless a video-detail surface gains a clear use for it.

Files — `apps/cli/src/services/youtube/` for the lookup,
`packages/providers/src/youtube/map-search-result.ts` for the original metadata
contract, and `apps/cli/src/app-shell/settings/registry/youtube.ts` plus the
YouTube search/detail display consumers. Risk comes from added latency and
disclosing queries to a third party. [DeArrow](https://github.com/ajayyy/DeArrow)

## Approaches to leave with upstream

- An in-tree InnerTube/SABR/UMP implementation would make Kunai responsible for
  player response parsing, client identity churn, attestation, JS changes,
  adaptive transport and platform playback. Revisit only if a maintained local
  backend exposes a proven direct handoff and materially improves coverage.
- APK patches and mobile-client profiles serve the host apps that ship them.
  Keep browser or app ad behavior, RYD, SponsorBlock and stream availability
  independent. Avoid ad-free or Premium-equivalent promises. Background
  audio in a terminal can use the external player's existing process model.
- Server-side media proxying, shared relay URLs, automatic cookie extraction,
  token harvesting, IP rotation and geo or age workarounds add operational
  dependencies or undermine access controls. Keep the relay metadata-only and
  keep credential-free playback honest about its limits.
- Keep YouTube behavior provider-scoped. Protect the IntroDB TMDB and AniSkip
  anime timing lanes and existing non-YouTube adapters. Update the provider
  dossier, public provider guide and playback timing doc with each behavior
  change. Verify entry points, reverse settings, actual player readers, and
  Linux/macOS/Windows behavior as each ranked item lands.
