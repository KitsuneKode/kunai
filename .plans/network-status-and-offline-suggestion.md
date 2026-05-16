# Network Status And Offline Suggestion

Status: planned

## Goal

Give users clear online/offline feedback without blaming providers for local network problems or disturbing offline library flows.

## Behavior

- Start the shell immediately.
- Run a lightweight connectivity snapshot in the background.
- Update network state reactively after online failures.
- Track network as `online`, `offline`, `limited`, or `unknown`.
- Use network state as a policy input, not a global blocker.

## Online UX

When online search or playback resolve sees network unavailable:

- Show `Network unavailable · Open offline library or retry`.
- Offer `offline library`, `retry`, `diagnostics`, and `back`.
- Do not auto-open the offline library.
- Do not degrade provider health.

## Offline UX

- Offline library does not show network warnings by default.
- If the user asks for online repair, artwork refresh, stream refresh, or provider fallback while offline, show a compact network warning then.
- Local playback, local subtitles, local thumbnails, and local cached posters must keep working without network.

## Classification Rules

- Network unavailable: multiple unrelated host failures, OS-level network errors, failed connectivity snapshot, repeated provider failures with same network-class error.
- Provider failed: provider status codes, provider parse changes, provider no-stream, provider-domain timeout while general connectivity is okay.
- Ambiguous: one timeout, CDN buffering, health probe timeout, remote poster failure, subtitle API failure while video works.

## Tests

- Startup network probe never blocks shell construction.
- Online resolve with offline snapshot suggests offline library and retry.
- Offline library remains warning-free until an online action is attempted.
- Provider health does not change after local network failures.
- Ambiguous single timeout records diagnostics without provider penalty.
