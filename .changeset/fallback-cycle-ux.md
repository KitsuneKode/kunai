---
"@kitsunekode/kunai": patch
"@kunai/core": patch
---

Fix the provider fallback cycle end to end: live progress, honest attempts, one semantic for ⇧F.

The fallback audit found the cycle sound in `provider-engine` but nearly invisible
and partly misleading at the surfaces:

- **Live progress.** The loading shell now narrates `provider-fallback-started`,
  `provider-hedge-started`, and `provider-fallback-halted` as they happen instead
  of sitting on "Resolving via X" for the whole chain — including the
  "network looks offline, fallback paused" case that used to look like a hang.
- **Aborted attempts are recorded.** Candidates cancelled mid-flight (user
  cancel, deadline, or a hedged sibling winning) now land in `attempts` with an
  `aborted` marker and a dedicated `attempt-aborted` timeline event — no more
  silent gaps or fabricated provider failures where the last act used to vanish.
- **⇧F is session-scoped everywhere.** It hops to the next compatible provider
  without persisting a per-title preference (the `/provider` picker keeps that
  job) and without clearing the title's provider health memory. Each press walks
  forward through providers not yet tried this episode — no ping-ponging between
  the top two — and skips providers marked `down`. It is not offered during
  local file playback or when no eligible candidate exists.
- **Provider picker wins mid-resolve.** Confirming a pick while a resolve is in
  flight cancels the old resolve so its late result is discarded instead of
  playing the provider you just navigated away from.
- **Dead keys fixed.** Copy that said "press f for fallback" now says `⇧F`
  (bare `f` has never been bound), the hardcoded "VidKing" in failure copy uses
  the actual provider name, and `/recover` + `/recompute` during an in-flight
  resolve restart resolution instead of silently doing nothing.
- **Honest failure surfacing.** `buildProviderResolveProblem` classifies the
  last meaningful typed failure rather than regexing concatenated messages, and
  no longer recommends `pick-stream` when nothing resolved or
  `try-next-provider` when every candidate already ran.
- **Dead code removed.** `resolveProviderStreamWithRetries` was unreachable and
  retried every untyped error if revived; it is gone along with its test.
