# @kunai/core

## 0.1.1

### Patch Changes

- [#485](https://github.com/KitsuneKode/kunai/pull/485) [`068d9fc`](https://github.com/KitsuneKode/kunai/commit/068d9fcd269ba2c76fd8f0bf0ed1b0da48cb998a) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Fix the provider fallback cycle end to end: live progress, honest attempts, one semantic for ⇧F.

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

- Updated dependencies [[`8174aae`](https://github.com/KitsuneKode/kunai/commit/8174aae3c5e2effcdfcfa52e420393fc103debc9)]:
  - @kunai/types@0.1.1
