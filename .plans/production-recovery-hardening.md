# Production Recovery Hardening

Status: planned

This is the coordinating plan for making Kunai's playback, provider fallback, offline, diagnostics, and debugging behavior production-ready without making the app bossy or wasteful.

## Goal

Make online playback recovery, offline fallback suggestions, diagnostics, downloaded-library artwork, and developer debugging predictable for real users on imperfect networks and real provider churn.

## Policy Locked By Grill Session

- Default recovery mode is `guided`.
- `fallback-first` is an advanced persistent setting and a one-off user action.
- `manual` never switches providers without explicit user action.
- Automatic recovery must be cheap, bounded, visible, and evidence-backed.
- Slow or ambiguous behavior does not automatically punish provider health.
- Local network/user failures do not degrade provider health.
- Automatic fallback skips `down` providers, but explicit user selection may try one once.
- Playable video wins over missing subtitles, artwork, timing, or uncertain health probes.
- Offline library remains calm and usable when network is unavailable.
- Internet-unavailable states suggest offline library; they never auto-open it.
- Diagnostics/report issue flows are layered, redacted, previewed, and useful to both users and maintainers.

## Slice Order

1. [Recovery policy engine](./recovery-policy-engine.md)
2. [Network status and offline suggestion](./network-status-and-offline-suggestion.md)
3. [Diagnostics reporting UX](./diagnostics-reporting-ux.md)
4. [Offline artwork cache and library previews](./offline-artwork-cache-and-library-previews.md)
5. [Developer debugging workflow](../docs/developer/debugging-workflow.mdx)
6. [Provider/player harness test matrix](./provider-player-harness-test-matrix.md)
7. [Production readiness usage hardening](./production-readiness-usage-hardening.md)

## Existing Plans To Keep In Sync

- Provider reliability diagnostics: [provider-reliability-diagnostics-and-reporting.md](./provider-reliability-diagnostics-and-reporting.md)
- Download/offline/onboarding: [download-offline-onboarding.md](./download-offline-onboarding.md)
- Search/offline continuation engines: [search-offline-continuation-engines.md](./search-offline-continuation-engines.md)
- UI polish and image protocol: [ui-polish-and-image-protocol.md](./ui-polish-and-image-protocol.md)
- Runtime diagnostics/offline boundary hardening: [runtime-diagnostics-offline-boundary-hardening.md](./runtime-diagnostics-offline-boundary-hardening.md)
- Production readiness usage hardening: [production-readiness-usage-hardening.md](./production-readiness-usage-hardening.md)

## Implementation Rules

- Do not add retry loops without a budget.
- Do not make health probes block playable streams unless the stream is clearly stale/dead.
- Do not hide user-selectable providers only because health is degraded.
- Do not show network warnings inside offline-only flows unless the user asks for online repair/refresh.
- Do not let artwork, subtitles, recommendations, or diagnostics block playback.
- Do not emit noisy `console.log` from Ink render paths; use diagnostics and trace events.

## Completion Definition

- Recovery decisions come from a single testable policy layer.
- Online UI clearly distinguishes slow, provider failure, user/network failure, and hard blockers.
- Offline library remains useful and rich without hidden network dependency.
- `/diagnostics`, `/export-diagnostics`, and `/report-issue` share redacted structured evidence.
- Developer debugging has one documented workflow for traces, live smokes, breakpoints, and support bundles.
- The harness test matrix covers the real-world edge cases listed in the slice docs.
