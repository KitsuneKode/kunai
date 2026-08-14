---
status: current
lastReviewed: "2026-07-29"
---

# Telemetry Privacy Contract

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Read this before touching `apps/cli/src/services/telemetry/*` or
`apps/telemetry-ingest/*`. These are **contract invariants**, not preferences:
each one is enforced on both sides, and breaking one silently converts an
anonymous counter into user tracking.

Owner: `apps/cli/src/services/telemetry/` (`TelemetryService.ts`, `consent.ts`,
`install-id.ts`) and `apps/telemetry-ingest/src/payload-validation.ts`.

## Consent

- Telemetry is **opt-in**. A fresh install is `telemetry: "unset"` and performs
  **zero** network calls for the usage ping.
- Decline, timeout, non-TTY, `CI=true`, and `DO_NOT_TRACK=1` all resolve to
  **disabled** (`consent.ts` — `resolveTelemetryConsent`).
- `DO_NOT_TRACK=1` and `CI=true` hard-block both **sending and enabling**, even
  when config already says `enabled`. This gate must stay ahead of any send
  path; it is not merely a default.
- `/telemetry` shows status and toggles consent. `/telemetry show` prints the
  exact JSON that would be sent — keep that honest if you change the payload.

## Payload

At most one ping per 24 hours. The payload is exactly:

```json
{ "installId": "<uuid>", "version": "<semver>", "os": "<platform>", "arch": "<arch>", "ts": 0 }
```

- `installId` is a random UUID stored in config. Never hostname, MAC, IP,
  username, or anything derived from them.
- **No title, query, provider, provider result, URL, or file path is ever
  transmitted.** Adding a field here is a product decision, not a refactor.
- A failed send does **not** consume the 24h cadence — it writes a 15-minute
  retry marker so the next launch retries rather than losing the day.
- Failures are silent and never block startup or playback.

## Ingest

`apps/telemetry-ingest` is a minimal user-owned Vercel function.

- POST only. Validates payload shape **and every dimension value**: strict
  semver `version`, closed allowlists for `os` and `arch`. A hostile client
  cannot inject a fabricated dimension into published aggregates.
- Rejects clock skew; rate-limits per IP hash.
- Counts at most once per HMAC-hashed install id per UTC day.
- Durable storage (Upstash Redis) keeps only hashed ids in short-TTL daily sets,
  a lifetime HyperLogLog, and aggregate day counts — never raw install UUIDs,
  titles, queries, or durable IPs.
- A cron job publishes a small public metrics JSON (yesterday actives, lifetime
  approximate) for the docs site.

## Known limits

State these plainly rather than implying stronger guarantees:

- Platform access logs can still correlate IP ↔ body unless scrubbed at the
  edge. That is outside the application's control.
- Abuse can inflate counters. It cannot expose a user's watch history — the
  payload has nothing to expose.

## Changing this

Any change that adds a field, widens an allowlist, weakens a gate, or lengthens
a retention window needs an updated row here **and** in
`docs/users/reliability-and-privacy.mdx` in the same change set. The user-facing
page and this contract must not drift.
