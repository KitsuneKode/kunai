# Playback Source Inventory Contract

Use this doc when changing provider retry behavior, source/quality/language switching, stream cache keys, provider fallback, or playback picker data.

This is a narrow contract doc. For broader context, read:

- [.plans/provider-result-contract.md](../.plans/provider-result-contract.md) for provider ownership.
- [.plans/search-service.md](../.plans/search-service.md) for catalog/search ownership.
- [.docs/ux-architecture.md](./ux-architecture.md) for shell and overlay behavior.
- [.docs/provider-dossiers/](./provider-dossiers/) and `apps/experiments/scratchpads/provider-*/*.md` for provider evidence.

## Principle

Providers own provider-specific mess. The playback runtime owns user policy. The UI renders normalized inventory and never scrapes.

```text
provider module
  -> provider-specific source retry / mirror probing / variant extraction
  -> normalized ProviderResolveResult
  -> playback resolve service cache + fallback policy
  -> UI source, quality, subtitle, audio, and diagnostics views
```

## Provider Responsibilities

Each provider owns:

- source and mirror ordering
- retry classification for its own source failures
- hard-sub, audio, subtitle, quality, header, expiry, and referrer evidence
- normalized `sources`, `variants`, `streams`, `subtitles`, `failures`, and trace events
- language availability when the provider exposes it up front

Providers should not:

- decide global provider fallback
- write history
- write cache directly
- launch or control `mpv`
- hide exhausted providers behind `null` without structured failure evidence

## Retry And Fallback

Provider-internal retry happens before provider fallback.

- Retry only retryable failures: timeout, transient network error, empty response when the source commonly races.
- Do not retry deterministic failures: unsupported title, unavailable sub/dub mode, parse failure caused by a known schema mismatch, missing runtime.
- Default source attempt policy should be short and bounded: two attempts maximum for retryable source failures unless a provider dossier justifies a different policy.
- Provider fallback starts only when the active provider is exhausted or the user explicitly requests fallback.

Abort semantics:

- Hard abort: title/episode changed, quit, shutdown. Stop work and do not mutate current playback.
- Soft abandon: user requested fallback while provider work is still in flight. The UI may move on immediately. If the abandoned provider completes with a healthy full inventory before cancellation lands, the runtime may cache it but must not switch current playback back to it.

## Cache Shape

Cache inventory before selected stream.

Use `ProviderResolveResult` as the source inventory unit whenever possible. It contains the selected stream plus all discovered candidates.

Recommended cache concepts:

- `catalog-search`: search results, aliases, poster, metadata source, ratings.
- `episode-list`: provider or catalog episode list, including sub/dub availability when known.
- `source-inventory`: full provider result for a title episode and language context.
- `stream-url`: selected direct URL only when it is separately useful and expiry is understood.
- `subtitle-list`: subtitle candidates by title, episode, provider, source, and language.
- `provider-health`: recent source/provider failures and survival rate.

`source_inventory` already exists in `@kunai/storage`; wire it before adding another table for the same concept.

## Cache Keys

Inventory keys must separate independent dimensions:

```text
provider id
provider result schema version
media kind
title id
season / episode / absolute episode
audio mode or language, such as sub/dub
subtitle language or none
runtime class when behavior differs
region/account/debrid scope when introduced
```

Quality should not be part of the inventory key when the provider returns all qualities up front. In that case quality is a selection over cached inventory.

Quality may be part of a deferred variant key only when the provider genuinely requires another call to materialize a specific quality.

## Source, Quality, And Language Switching

Source and quality pickers must read from cached inventory.

- Source change: select the best stream from the chosen `sourceId`.
- Quality change: select the chosen stream or variant without recomputing inventory.
- Subtitle change: select from `subtitles` or a separately cached subtitle list; do not refetch unrelated streams.
- Audio/sub-dub change: reuse cached inventory only if that audio mode was included in the inventory. Otherwise resolve a separate inventory key for the requested mode.

Never let one selected source overwrite another source's inventory. Store the full normalized result, then store user selection as separate playback intent.

## Hard-Sub, Soft-Sub, And Dub Display

The UI should distinguish:

- audio language, for example `audio ja`, `audio en`, or `dub`.
- hard-sub language, for example `hardsub en`.
- soft subtitles, for example `12 soft subs`, `soft sub en selected`.

Availability states:

- `available`: provider explicitly returned this mode or language.
- `unavailable`: provider explicitly returned no candidates for it.
- `unknown`: provider does not expose it without resolving.

Avoid implying soft subtitles when only hard-sub is available. Avoid calling external subtitle services when provider hard-sub satisfies the current mode and the user did not ask for soft subtitles.

## Anime Title Aliases And Search Display

English, Romaji, native, provider title, and synonyms are catalog/search metadata, not provider resolve work.

Switching anime title display preference must be a pure projection over `SearchResult.titleAliases`. It should not refetch search results when aliases are already cached.

## Runtime Dependency Stance

The source checkout currently requires Bun for development and local source runs. The codebase uses Bun-first APIs and tooling (`Bun.spawn`, `Bun.which`, `Bun.file`, `Bun.connect`, `Bun.hash`, workspaces, lockfile behavior).

For beta, prefer reducing onboarding friction through packaged binaries or installer checks over porting the runtime to Node/npm. A Node-only source path is possible later, but it would add compatibility work across process, socket, filesystem, bundling, and package scripts without improving playback reliability first.

