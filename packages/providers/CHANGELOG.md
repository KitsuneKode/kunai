# @kunai/providers

## 0.1.1

### Patch Changes

- [#479](https://github.com/KitsuneKode/kunai/pull/479) [`8174aae`](https://github.com/KitsuneKode/kunai/commit/8174aae3c5e2effcdfcfa52e420393fc103debc9) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - fix(providers): hianime errors name the failed request; surface embed artwork

  Curl and HTTP failures now include `from https://host/path` — the upstream
  [#1902](https://github.com/KitsuneKode/kunai/issues/1902) behavior — with the query stripped so a `/search?keyword=…` title never
  lands in logs. Cloudflare-block advice is gated on the binary that actually
  ran: an impersonating wrapper says "curl-impersonate was already used" instead
  of telling the user to install what just ran. The embed's `poster` and
  `sprite_vtt` fields were parsed and dropped; they now ride the standard
  `artwork` slot (`posterUrl`/`seekBarVttUrl`) on streams and variants, which the
  source-inventory projection turns into real seek-thumbnail/artwork capability
  flags.

- [#479](https://github.com/KitsuneKode/kunai/pull/479) [`8174aae`](https://github.com/KitsuneKode/kunai/commit/8174aae3c5e2effcdfcfa52e420393fc103debc9) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - test(cli): pin the production provider roster and capability↔operation parity

  The resolve-gate coverage class of bug — a registered production provider
  silently absent from a hardcoded coverage list — now fails on main: the roster
  is pinned to the 8 module ids `loadProductionProviderModules()` returns, and
  every `capabilities` entry must have a runtime-port operation that implements
  it. That check immediately caught two real drifts: youtube declared
  `search`/`episode-list` capabilities its runtime ports never admitted, and
  miruro declared `episode-list`/`subtitle-resolve` while listing only
  `resolve-stream`. Both manifests now name the operations they actually run.

- [#337](https://github.com/KitsuneKode/kunai/pull/337) [`ad91369`](https://github.com/KitsuneKode/kunai/commit/ad913693a2980ea2cb570380a8c7fcc6be2e8e6b) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Harden provider stream resolution and mpv playback handoff:

  - **Miruro & Rivestream failover**: Probe stream reachability during candidate cycle resolution, automatically failing over from unreachable or rate-limited (HTTP 429) CDN endpoints to healthy mirror servers before returning to mpv.
  - **Rivestream DASH & Origin headers**: Accurately detect `.mpd` manifests as DASH (`protocol: "dash"`, `container: "mpd"`) instead of misclassifying as MP4, and supply CORS `Origin` headers.
  - **AniDB maintenance detection**: Safely detect HTTP 503 and HTML maintenance pages during search, preventing false 0-result displays by marking the provider offline.
  - **AllAnime persisted query drift**: Classify `PersistedQueryNotFound` as upstream GraphQL hash drift with clear non-retryable diagnostics rather than collapsing into empty sources.
  - **YouTube playback hardening**: Add `/ba` audio fallback to yt-dlp format selectors (`bv*+ba/b/ba`) for audio-only and podcast uploads, explicitly set `--ytdl=yes` on one-shot mpv spawn, and fail closed early on rental/payment-required videos.

- [#479](https://github.com/KitsuneKode/kunai/pull/479) [`8174aae`](https://github.com/KitsuneKode/kunai/commit/8174aae3c5e2effcdfcfa52e420393fc103debc9) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Classify provider HTTP failures structurally instead of by message text.

  Every non-OK provider response now throws `ProviderHttpError` — status, error
  code, and retryability attached — from a shared contract in `@kunai/types`.
  HiAnime, AniDB, Videasy, Miruro, VidLink, VidRock, RGShows, and the YouTube
  lane (Invidious + Piped) all carry the structure, and Miruro preserves it when
  wrapping a status error.

  The cycle engine reads the structure first: a 429 classifies as
  `candidate-rate-limited`, a 5xx as `candidate-server-error`, and a 401/403 or
  Cloudflare/WAF block as `candidate-blocked` — instead of degrading to a
  retryable "network blip" that spins to the attempt cap. Rate-limited and
  server-error failures now reach endpoint-health quarantine as real evidence,
  while provider-wide blocks stay out so a session guard cannot poison a healthy
  mirror. Wrapped errors keep the original classification, and direct-layer
  classifiers prefer the structured fields over message matching.

- Updated dependencies [[`068d9fc`](https://github.com/KitsuneKode/kunai/commit/068d9fcd269ba2c76fd8f0bf0ed1b0da48cb998a), [`8174aae`](https://github.com/KitsuneKode/kunai/commit/8174aae3c5e2effcdfcfa52e420393fc103debc9)]:
  - @kunai/core@0.1.1
  - @kunai/types@0.1.1
