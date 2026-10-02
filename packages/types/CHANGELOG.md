# @kunai/types

## 0.1.1

### Patch Changes

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
