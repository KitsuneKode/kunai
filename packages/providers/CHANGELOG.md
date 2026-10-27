# @kunai/providers

## 0.1.1

### Patch Changes

- [#337](https://github.com/KitsuneKode/kunai/pull/337) [`ad91369`](https://github.com/KitsuneKode/kunai/commit/ad913693a2980ea2cb570380a8c7fcc6be2e8e6b) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Harden provider stream resolution and mpv playback handoff:

  - **Miruro & Rivestream failover**: Probe stream reachability during candidate cycle resolution, automatically failing over from unreachable or rate-limited (HTTP 429) CDN endpoints to healthy mirror servers before returning to mpv.
  - **Rivestream DASH & Origin headers**: Accurately detect `.mpd` manifests as DASH (`protocol: "dash"`, `container: "mpd"`) instead of misclassifying as MP4, and supply CORS `Origin` headers.
  - **AniDB maintenance detection**: Safely detect HTTP 503 and HTML maintenance pages during search, preventing false 0-result displays by marking the provider offline.
  - **AllAnime persisted query drift**: Classify `PersistedQueryNotFound` as upstream GraphQL hash drift with clear non-retryable diagnostics rather than collapsing into empty sources.
  - **YouTube playback hardening**: Add `/ba` audio fallback to yt-dlp format selectors (`bv*+ba/b/ba`) for audio-only and podcast uploads, explicitly set `--ytdl=yes` on one-shot mpv spawn, and fail closed early on rental/payment-required videos.

- [#479](https://github.com/KitsuneKode/kunai/pull/479) [`8174aae`](https://github.com/KitsuneKode/kunai/commit/8174aae3c5e2effcdfcfa52e420393fc103debc9) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - test(cli): pin the production provider roster and capability↔operation parity

  The resolve-gate coverage class of bug — a registered production provider
  silently absent from a hardcoded coverage list — now fails on main: the roster
  is pinned to the 8 module ids `loadProductionProviderModules()` returns, and
  every `capabilities` entry must have a runtime-port operation that implements
  it. That check immediately caught two real drifts: youtube declared
  `search`/`episode-list` capabilities its runtime ports never admitted, and
  miruro declared `episode-list`/`subtitle-resolve` while listing only
  `resolve-stream`. Both manifests now name the operations they actually run.

- [#572](https://github.com/KitsuneKode/kunai/pull/572) [`6483631`](https://github.com/KitsuneKode/kunai/commit/6483631c4b41a283056a469a48c08ccd081dafa4) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - fix(providers): revive KickAssAnime on the CatStream rotation and wire AllManga into endpoint health

  KickAssAnime's servers list renamed `VidStreaming` to `CatStream` on the same
  cat-player page, and its manifest now arrives protocol-relative
  (`//bl.krussdomi.com/…`) rather than double-slashed — both names are playable
  and the URL normalizer pins the bare `//` form to https. AllManga's source
  cycle now keys candidates on each stream's own host and feeds the shared
  endpoint quarantine, so a mirror host refused by the resolve-gate probe is
  skipped on the next resolve instead of being re-probed forever. The status
  sweep probes all twelve production modules (vidrock, movy, animegg and
  kickassanime were missing) and a roster-parity test fails loudly if the lists
  drift again.

- [#591](https://github.com/KitsuneKode/kunai/pull/591) [`f17f55a`](https://github.com/KitsuneKode/kunai/commit/f17f55a9b1103736cd03572e27073007e29b28d3) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - fix: subagent-driven hardening across providers, shell, config merge, and the update lock

  Providers: HiAnime embed URLs scraped from upstream markup now pass the same
  literal-target gate AniDB uses, so a hostile embed payload cannot steer fetch
  or curl at LAN/loopback/file: targets. HiAnime and Miruro curl children killed
  by Ctrl-C (exit 130/143) or a caller abort now surface as AbortError-class
  cancellations instead of retryable network faults, every curl argv terminates
  options with `--` before the upstream URL, Miruro's pipe decode failures map to
  non-retryable `candidate-parse`, and its curl spawn takes the abort signal
  directly so a mid-spawn abort cannot strand the child. AniDB's HLS master
  expansion no longer follows redirects inside curl (`-sL`): it walks each hop
  itself so the per-hop blocklist applies. `curl_` wrapper discovery is
  case-insensitive so `Curl_chrome150.bat` resolves on Windows.

  Shell: the settings draft now flushes on unmount instead of losing a change
  made inside the 300 ms debounce, provider-supplied track labels are sanitized
  in the two-pane layout, the provider memory panel stops duplicating the
  "skipped in auto-fallback" note, the image-capability memo key covers every
  environment input it reads, and keyed inflight tasks clean up without spawning
  an unhandled rejection on failure.

  Config and updater: `mergeKitsuneConfig` overlays object-valued keys instead of
  replacing them, so a hand-edited `{"sync": {"anilist": null}}` or a partial
  language profile can no longer crash `x.y.z` readers or silently drop sibling
  keys. Version-lock stale reclaim is serialized through a claim file and rewrites
  the lock in place after re-verifying file identity — a live lock can no longer
  be deleted out from under a racing winner, and abandoned claims are swept.
  `curl --version` feature probes are time-bounded, and the HLS relay rejects any
  non-zero curl exit instead of relaying a truncated body that still carried a
  parseable status trailer.

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

- Updated dependencies [[`8174aae`](https://github.com/KitsuneKode/kunai/commit/8174aae3c5e2effcdfcfa52e420393fc103debc9), [`068d9fc`](https://github.com/KitsuneKode/kunai/commit/068d9fcd269ba2c76fd8f0bf0ed1b0da48cb998a)]:
  - @kunai/types@0.1.1
  - @kunai/core@0.1.1
