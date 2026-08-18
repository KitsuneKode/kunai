# Provider Result Contract Plan

Status: Planned before broad `@kunai/core` extraction

Use this plan when changing provider return shapes, subtitle extraction ownership, quality/source inventories, or the future `@kunai/core` resolver boundary.

## Problem

Kunai currently has too much provider-specific behavior leaking upward into app/runtime code.

The desired shape is:

```text
caller
  -> provider abstraction
  -> provider-specific extraction
  -> normalized ProviderResolveResult
  -> app policy: playback, history, diagnostics, UI
```

The caller should not know how a provider found subtitles, how quality labels were parsed, which backend endpoint was decrypted, or why a source needs a referrer. The caller should receive normalized candidates, evidence, and structured failure reasons.

## Principle

Providers own provider-specific facts.

Shared helpers own repeated mechanical behavior.

App/runtime code owns user policy.

## Provider Responsibilities

Each provider should own:

- provider-specific URLs, endpoints, tokens, and decryption
- stream/source discovery
- subtitle discovery when the provider exposes it
- quality/source inventory extraction
- audio/sub/dub variant discovery
- header/referrer requirements
- provider-specific failure classification
- provider-specific evidence in `ResolveTrace`

Providers should not:

- write history
- write cache directly
- decide UI copy
- launch `mpv`
- know account/premium policy
- hide failures as `null` without structured reasons

## Shared Helper Responsibilities

Move logic into shared helpers only when it is genuinely common:

- language matching
- English fallback
- SDH filtering
- subtitle format preference
- quality label ranking
- cache key construction
- TTL class mapping
- URL/header redaction
- trace step construction
- common Wyzie response parsing

Shared helpers should be boring, pure, and testable. They should not contain provider-specific endpoint decisions unless they are explicitly a shared provider family helper.

## App/Runtime Responsibilities

The app/runtime layer owns:

- configured subtitle language or `none`
- temporary English-first default policy
- whether to open subtitle picker
- whether to retry, fallback, or ask user
- `mpv` handoff
- history save policy
- diagnostics panel presentation
- cache read/write orchestration through `@kunai/storage`

## Target Contract

Long term, each provider should return a shared shape close to:

```ts
type ProviderResolveResult = {
  providerId: ProviderId;
  streams: StreamCandidate[];
  subtitles: SubtitleCandidate[];
  cachePolicy?: CachePolicy;
  trace: ResolveTrace;
  failures: ProviderFailure[];
  healthDelta?: ProviderHealthDelta;
};
```

Existing `StreamInfo` can remain as a CLI adapter output until `@kunai/core` exists.

## Subtitle Contract

Subtitle extraction should follow this shape:

```text
provider-specific subtitle source
  -> normalized SubtitleCandidate[]
  -> shared selection/filtering helper
  -> selected subtitle URL + full subtitle list
  -> mpv
```

Provider examples:

- VidKing may expose provider payload subtitles and/or Wyzie evidence.
- AllAnime family may expose provider subtitle URLs with source/referrer requirements.
- Cineby Anime may need Playwright evidence.
- Candidate providers may have unknown subtitle behavior and must say so.

No provider should be marked "subtitle ready" unless:

- source is documented
- selection rules are tested
- selected URL reaches `mpv`
- failure mode is diagnosable

## Phase Order

1. Fix MPV playback-stats/history sign-off.
2. Temporarily harden English subtitle selection in CLI shared helpers.
3. Finish provider dossiers with subtitle evidence.
4. Define `@kunai/core` provider interfaces/adapters.
5. Extract one low-risk provider first.
6. Move common helpers into `@kunai/core` only after two providers prove the abstraction.

## Acceptance

- Provider-specific quirks stay inside provider implementations or provider-family helpers.
- Shared helpers are pure and covered by tests.
- App code consumes normalized stream/subtitle/source candidates.
- Missing provider capabilities are explicit, not discovered by crashes.
- Subtitle support is evidence-driven, not a boolean.
