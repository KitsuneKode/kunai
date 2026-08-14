# Analytics Privacy Contract

Read this before touching `apps/cli/src/services/analytics/*`,
`apps/cli/src/domain/analytics/*`, or `apps/analytics-ingest/*`. These are
**contract invariants**, not preferences: each one is enforced on both sides,
and breaking one silently converts an anonymous counter into user tracking.

Owner: `apps/cli/src/domain/analytics/consent-policy.ts`,
`apps/cli/src/services/analytics/` (`UsageAnalyticsService.ts`,
`install-id.ts`), and `apps/analytics-ingest/src/payload-validation.ts`.

## Consent

- Analytics is **on by default and opt-out** — but never before the user has
  been told.
- A fresh install is `analytics: "unset"` and performs **zero** network calls.
  `unset` means the disclosure has not been shown yet, not that the user
  declined.
- **The first run never sends.** Disclosure is raised (setup wizard slide, or a
  one-time startup notice for upgraders), the preference is persisted, and the
  first ping goes out on the _next_ launch. This is the rule that separates
  "on by default, disclosed" from "collected before you were told".
- **No TTY → stays `unset`.** Piped or scripted output cannot show a notice, so
  consent has not happened: write nothing, send nothing. A later interactive run
  still discloses.
- `DO_NOT_TRACK=1` and `CI=true` hard-block both **sending and enabling**, even
  when config already says `enabled`; a stale `enabled` is rewritten to
  `disabled`. `0`, `false`, `no`, and empty **do not** block — one
  `isTruthyEnv` in `consent-policy.ts` is the only definition, because three
  divergent copies once made `CI=0` persist a permanent decline.
- `/analytics` shows status and toggles consent. `/analytics show` prints the
  exact JSON that would be sent — keep that honest if you change the payload.
  `telemetry` remains a command alias.

## Identifier

- `installId` exists on disk **if and only if** analytics is enabled. Turning
  analytics off deletes it.
- It is a random UUID. Never hostname, MAC, IP, username, or anything derived
  from them.
- Rendering a preview must never create one. `describePayload()` is a query
  with no writes; a user who has not enabled analytics sees a placeholder
  rather than a freshly minted UUID.

## Payload

At most one ping per 24 hours. The payload is exactly:

```json
{ "installId": "<uuid>", "version": "<semver>", "os": "<platform>", "arch": "<arch>", "ts": 0 }
```

- Exact key-set equality. A sixth key is rejected.
- **No title, query, provider, provider result, URL, or file path is ever
  transmitted.** Adding a field here is a product decision, not a refactor.
- A failed send does **not** consume the 24h cadence — it writes a 15-minute
  retry marker so the next launch retries rather than losing the day.
- Failures are silent and never block startup or playback.

## Ingest

`apps/analytics-ingest` is a minimal maintainer-owned Vercel function on Neon
Postgres.

- POST only. Validates payload shape **and every dimension value**: strict
  semver `version`, closed allowlists for `os` and `arch`. A hostile client
  cannot inject a fabricated dimension into published aggregates. Unlike the
  previous revision, these three are actually stored and grouped — a field that
  is validated and then discarded is collected for no decision.
- Rejects clock skew beyond ±24h. Body capped at 512 bytes.
- **The ingest never reads a client IP.** There is no rate-limit key derived
  from one. The prior in-memory limiter was per-instance on serverless and
  reset on every cold start, so it bought little while making this claim
  untrue.
- `ping_day` holds `(day, HMAC(installId), version, os, arch)` with
  `(day, install_hash)` as the primary key — that key **is** the
  once-per-install-per-day gate, atomic in one statement. Rows are deleted
  after **35 days**.
  - The insert is `ON CONFLICT DO NOTHING`, so within a single UTC day the
    **first** ping's dimensions win. The 24h client cadence means a second
    same-day ping only happens on a retry after a failed send, where the
    dimensions have not changed — but if that ever stops being true, a
    version upgraded mid-day would be attributed to the old version until
    the next day.
- `install_lifetime` holds **one permanent row per install**: an HMAC hash and
  a first-seen date, retained for the life of the project. This is a durable
  pseudonymous record where the previous design kept only a HyperLogLog sketch.
  It is what an exact lifetime count costs. Do not describe it as equivalent to
  the sketch it replaced.
- `daily_rollup` is permanent and contains no identity of any kind.
- Raw install UUIDs are never stored. Redis is gone.

## Public aggregates

A cron job publishes a small public metrics JSON (`schemaVersion: 2`) for the
docs site: yesterday's active installs, lifetime installs, and version / os /
arch breakdowns.

- **k-anonymity floor: any dimension bucket with fewer than 5 installs folds
  into `other`.** Published together, version × os × arch identify a single
  user on an unusual combination in a small population. Totals are preserved —
  suppressed counts move into `other`, they are not dropped.
- Suppression applies to the **public** JSON only. The token-guarded
  `/api/metrics/admin` endpoint reads unsuppressed rollups.
- `lifetimeMethod` was removed in v2: it was a storage detail leaking into a
  public wire format, and the count is now exact rather than approximate.

## Adding a metric

Before any field ships, write down:

1. the decision it will change,
2. the aggregate that answers it,
3. its k-anonymity floor.

**A field that cannot name a decision does not ship.** This rule exists because
the previous revision shipped three dimensions that nothing consumed.

`ping_day.extra jsonb` is a seam for future dimensions, and it ships empty. No
wire field accompanies it — the payload key-set check rejects a sixth key —
so nothing can write to it until a deliberate change opens it.

## Known limits

State these plainly rather than implying stronger guarantees:

- Platform access logs can still correlate IP ↔ body unless scrubbed at the
  edge. That is outside the application's control.
- Abuse can inflate counters by minting install ids. It cannot expose a user's
  watch history — the payload has nothing to expose.

## Changing this

Any change that adds a field, widens an allowlist, weakens a gate, lowers the
k-anonymity floor, or lengthens a retention window needs an updated row here
**and** in `docs/users/reliability-and-privacy.mdx` in the same change set. The
user-facing page and this contract must not drift;
`apps/cli/test/unit/architecture/analytics-payload-drift.test.ts` enforces it.
