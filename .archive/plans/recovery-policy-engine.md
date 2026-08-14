# Recovery Policy Engine

Status: planned

## Goal

Move retry, fallback, and ask-user decisions into a small policy layer so playback recovery is consistent, bounded, and explainable.

## Decisions

- Add recovery modes: `guided`, `fallback-first`, and `manual`.
- `guided` is the default.
- `fallback-first` is opt-in and may auto-fallback on slow resolve after a visible grace window.
- `manual` never provider-switches without user action.
- User-selected `down` providers are tried once; automatic fallback skips them.

## Policy Inputs

- User intent: automatic resolve, explicit provider selection, retry, refresh, fallback, cancel.
- Media compatibility: movie, series, anime.
- Network snapshot: online, offline, limited, unknown.
- Cache state: fresh, stale, validated, failed health check, force refresh.
- Provider health: healthy, degraded, down, unknown.
- Provider failure class: timeout, network, rate-limited, provider-empty, parse-failed, blocked, cancelled, runtime-missing, unsupported.
- Playback failure class: expired stream, network buffering, player exited, IPC stuck, seek stuck.

## Policy Outputs

- `use-cache`
- `validate-cache`
- `resolve-primary`
- `retry-primary`
- `auto-fallback`
- `ask-user`
- `stop-blocking`
- `proceed-with-warning`

## Behavioral Contract

- Fail fast for missing runtime, incompatible provider/media kind, invalid title/episode, user cancel, and offline-only flows that request online-only work.
- Auto-recover only when cheap and bounded: one transient provider retry, one stale-cache refetch, one fallback pass, bounded mpv reconnect.
- Ask the user when cause is ambiguous: slow provider, single timeout, degraded provider selected by user, missing subtitles, no stream with alternatives.
- Proceed with warning when video is playable but extras are missing or health probe is uncertain.
- Never degrade provider health for local network-unavailable evidence.

## UI Integration

- Loading UI uses policy output instead of hardcoded elapsed-time assumptions.
- Fallback option remains visible when available.
- Final failure appears only after budget is exhausted.
- Diagnostics receives the policy decision, input facts, and reason.

## Tests

- Guided mode retries one transient provider error, then asks/fallbacks by evidence.
- Fallback-first auto-fallbacks once after slow threshold.
- Manual mode never auto-fallbacks.
- User cancellation stops without retry/fallback.
- Local network unavailable does not degrade provider health.
- Down fallback providers are skipped automatically but explicit selection tries once.
- Playable stream with missing subtitles/artwork proceeds with warning.
