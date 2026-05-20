# Source Inventory UI Handoff

Use this when polishing source, quality, language, subtitle, history, download,
or playback diagnostics UI. The goal is to let UI render provider-native facts
without extra provider calls or provider-specific guessing.

## Contract Shape

Provider resolution can expose three related layers:

```text
Provider
  -> Source / server / mirror
    -> Variant / quality / presentation
      -> Stream + subtitles + artwork + seekbar facts
```

Not every provider exposes every layer. UI should render what exists and fall
back calmly when a provider only returns a selected stream.

Primary UI fields:

- `sources[].label`: compact source/server label.
- `sources[].kind`: `embed`, `manifest`, `direct-media`, or `unknown`.
- `variants[].label`: compact quality/presentation label.
- `variants[].qualityLabel` / `qualityRank`: quality sorting and display.
- `variants[].presentation`: `sub`, `dub`, `hardsub`, `softsub`, or provider
  presentation when known.
- `streams[].audioLanguages`, `subtitleLanguages`, `hardSubLanguage`: normalized
  ISO-639 language codes only.
- `languageEvidence[].nativeLabel`: provider-native label for detail panels and
  diagnostics.
- `sourceEvidence[].nativeLabel` / `host`: source/server facts for details and
  support bundles.
- `ProviderResolveInput.preferredSourceId` / `preferredStreamId`: exact user
  selection hints. Playback, downloads, and repair re-resolve paths should pass
  these through when they are known so provider-local cycling can try the
  intended source first and cache entries do not collapse distinct streams
  together.

Do not put provider code names such as `killjoy`, `FlowCast`, `HindiCast`,
`Vietsub`, or `H-SUB` into primary language UI. Those are evidence/source labels,
not normalized languages. If no ISO code is known, show the native label as source
detail only.

## Anime Controls

Anime providers often expose presentation first, then server/source:

```text
Sub / Dub / Hard Sub / Soft Sub
  -> Server 1 / Server 2 / native provider server
```

Recommended UI:

- First control: presentation when distinct choices exist.
- Second control: source/server within the chosen presentation.
- Quality control only when provider returned distinct quality variants.
- Show `hardSubLanguage` as an availability fact, not as an external subtitle
  sidecar requirement.

## Series And Movie Controls

Series/movie providers often expose source/server names that imply audio or
quality but are not languages by themselves.

Recommended UI:

- Source/server control: `sources[].label` plus `sourceEvidence.host` when useful.
- Quality control: sort by `qualityRank`, display `qualityLabel`.
- Language/audio control: only from normalized `audioLanguages` or explicit
  language evidence. Keep source aliases in details.
- Subtitle control: attach provider/external subtitles when present; hardsub-only
  means no sidecar is expected.

## No Extra Call Surfaces

These screens should prefer cached/provider-returned inventory and avoid fresh
provider calls on render:

- playback source picker
- quality/language/subtitle picker
- history/continue rows
- post-playback recommendations
- download recovery details
- diagnostics/support bundle summaries

Fresh provider work belongs behind explicit actions such as recover, refresh,
repair, download, or play.

## Exact Selection And Cache Identity

Source and stream selection can change the actual bytes, language, subtitle
delivery, host, or DRM/CDN behavior even when quality looks identical. Treat
these as cache identity inputs:

- include `source` and `stream` key parts for direct-provider stream caches;
- persist selected source/stream IDs when enqueueing a download from playback;
- pass selected IDs into download re-resolve so repair/retry keeps the user's
  chosen source when it still exists;
- if a provider cannot honor the exact source, it may fall back, but diagnostics
  should mark the selection as changed.

## MPV Bridge And Assets

The persistent mpv bridge lives at `apps/cli/assets/mpv/kunai-bridge.lua` and is
copied to the user config path when needed. UI should treat the bridge as a
runtime asset, not as render state.

Important bridge contracts:

- manual next/previous checks availability before stopping mpv;
- manual next/previous sets `user-data/kunai-loading` before `stop`, so the OSD
  gives immediate feedback;
- `file-loaded` clears transient loading and resume state;
- refresh is intentionally different from resume: refresh re-resolves the same
  episode, while resume seeks to saved history without provider work.

If the bridge asset cannot be found, persistent playback should degrade with a
diagnostic instead of silently changing navigation semantics.

## Diagnostics Copy

Good user-facing copy separates these cases:

- network offline: stop retrying and tell the user connectivity is the blocker;
- provider blocked: provider is reachable but denied the request;
- provider empty: provider had no candidates for this episode;
- parse failed: provider shape changed or scraper failed;
- subtitle unavailable: no sidecar was expected or found;
- subtitle repairable: video is playable, optional sidecar can be repaired later;
- stale recommendation/history data: cached data is shown while refresh is
  deferred or failed.
