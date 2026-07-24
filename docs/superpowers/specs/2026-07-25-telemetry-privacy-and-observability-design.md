# Telemetry: privacy, observability, and public metrics

Status: approved design, not yet implemented
Date: 2026-07-25
Supersedes: the ad-hoc issue list T01–T13 (verdicts in §12)

## 1. Purpose and non-goals

Telemetry in Kunai serves exactly three purposes:

1. **Reliability** — which providers fail, on which version and OS, so provider
   churn is fixed before users file issues.
2. **Public proof-of-life** — install and usage counts charted on the docs site.
3. **Anonymous error reports** — fingerprinted failures that locate a regression
   to a specific release.

**Non-goal: product analytics.** Feature-usage and per-user retention tracking are
explicitly out of scope. They are the only tier that requires a durable per-machine
identifier, and dropping them is what makes the rest of this design possible.

`version` is a required dimension on every record type. The question "which release
broke this" must be answerable by a direct lookup, not by inference.

## 2. Identity model

### 2.1 Rotating install id

Today `installId` is an immortal per-machine UUID. Server-side HMAC protects against
a database dump; it does not stop the secret holder from linking one machine across
every day forever. Adding event-level data on top of an immortal id is what turns a
counter into a profile.

The id rotates every **30 days** — long enough for a monthly retention cohort, short
enough that no identifier outlives a release cycle.

Config fields (none are ever transmitted raw):

| Field                 | Purpose               | Transmitted               |
| --------------------- | --------------------- | ------------------------- |
| `installId`           | rotating UUID         | yes (rotating value only) |
| `installIdRotatedAt`  | rotation clock        | no                        |
| `installFirstRunAt`   | derives age bucket    | no — only the bucket      |
| `installBeaconSentAt` | one-shot beacon guard | no                        |

Rotation is lazy, on the ping path: when `now - installIdRotatedAt > 30d`, mint a
fresh `crypto.randomUUID()` and reset the clock.

`ageBucket` is derived from `installFirstRunAt` and coarsened to one of
`new` (<7d), `1w-1mo`, `1-6mo`, `6mo+`. This preserves new-vs-returning and cohort
retention without any linkable identifier.

**What is lost:** exact lifetime distinct counts, and any per-machine journey longer
than 30 days. Both are acceptable; the first is recovered by §2.2.

### 2.2 First-run install beacon

An install beacon and a recurring heartbeat are fundamentally different objects. The
beacon fires **once, on first run**, with a one-shot UUID that is generated, sent,
and discarded — never written to config, never reused, never correlatable with any
subsequent ping.

This yields a truthful lifetime install count with no durable identifier existing
anywhere. `installBeaconSentAt` records only that it was sent.

If the beacon send fails it retries on the next run via the same `telemetryRetryAfter`
marker as the heartbeat (§3.3). Sharing one marker means a failed beacon also delays
that run's heartbeat by 15 minutes, which is harmless and keeps a single backoff path.

## 3. Consent model

### 3.1 Tiers

`KitsuneConfig.telemetry` becomes `"unset" | "off" | "basic" | "full"`.

| Tier    | Sends                                       |
| ------- | ------------------------------------------- |
| `unset` | nothing — not yet asked, zero network calls |
| `off`   | nothing                                     |
| `basic` | first-run beacon + daily heartbeat          |
| `full`  | basic + provider reliability aggregates     |

Error reports are **orthogonal to the tier** and governed by
`KitsuneConfig.errorReports: "ask" | "always" | "never"`, defaulting to `"ask"`.
A user on `basic` who chooses to send a crash report can do so; a user on `full`
who sets `never` sends none.

Rationale for two tiers rather than three independent toggles: three consent prompts
at setup would depress acceptance to the point of yielding no data at all. One
question with a sane default, plus a separate per-incident crash prompt, is the shape
that actually gets consented to.

### 3.2 Migration

- `"enabled"` → `"basic"`
- `"disabled"` → `"off"`
- `"unset"` → `"unset"` (unchanged; still prompts at setup)

Existing users are never silently upgraded to `full`. Reaching `full` requires an
explicit action in `/telemetry` or the setup wizard.

### 3.3 Hard gates and retry

`DO_NOT_TRACK` and `CI` continue to hard-block **all** tiers, both send and enable
paths, overriding config. Non-TTY resolves to `off`.

The existing failure handling is wrong: `lastTelemetryPingAt` is persisted before the
network call, so a transient network failure discards the day entirely. The fix is
**not** an in-process retry loop — a fire-and-forget task in a CLI process that often
exits within a second will have its backoff timers killed.

Instead: on failure, do not write `lastTelemetryPingAt`; write
`telemetryRetryAfter = now + 15min`. The next CLI launch retries naturally on a
working network. Zero timers, no loop, strictly better delivery, and the anti-spam
guarantee is preserved because `telemetryRetryAfter` still gates re-sends.

## 4. Wire contracts

Three endpoints with three shapes — deliberately not one payload. Each has different
validation, retention, and audience. Critically, this means `/api/ping` keeps its
existing strict exact-key parser completely untouched.

```jsonc
// POST /api/install — first run only.
// oneShotId is generated, sent, and discarded; never persisted.
{ "oneShotId": "<uuid>", "version": "0.3.0", "os": "linux", "arch": "x64", "ts": 0 }

// POST /api/ping — tier basic+. Exactly one field added to today's contract.
{ "installId": "<rotating uuid>", "ageBucket": "1-6mo",
  "version": "0.3.0", "os": "linux", "arch": "x64", "ts": 0 }

// POST /api/report — tier full, and/or an accepted error report.
{ "installId": "<rotating uuid>", "version": "0.3.0", "os": "linux", "arch": "x64",
  "ts": 0,
  "reliability": {
    "providers": {
      "allanime": { "ok": 41, "fail": 3, "byCode": { "geo_blocked": 2, "no_sources": 1 } }
    },
    "playback": { "eof": 12, "error": 1, "quit": 4 }
  },
  "errors": [
    { "fingerprint": "9f2a41c7e80b3d55", "count": 3, "kind": "provider",
      "errorName": "TypeError", "providerKind": "allanime",
      "frames": [
        { "module": "packages/providers/src/allmanga/api-client.ts", "line": 214 },
        { "module": "apps/cli/src/services/providers/resolve.ts", "line": 88 }
      ] }
  ]
}
```

All three reject unknown keys. All three validate `version` as strict semver and
`os`/`arch` against a closed allowlist.

## 5. Error fingerprinting

An opaque fingerprint alone is undebuggable — a hash cannot be fixed. The split that
makes reports both useful and safe:

**Stack frames are sent.** They are paths into Kunai's own open-source repository.
`packages/providers/src/allmanga/api-client.ts:214` is project source, not user data.
Absolute paths are normalized to repo-relative, which incidentally strips
`/home/<username>/` and any other machine-local prefix.

**Error messages are never sent.** Messages are where user content leaks — URLs,
titles, search queries, file paths. The fingerprint is computed over a _normalized_
message (digits, quoted strings, URLs, and paths replaced with placeholders) so that
identical errors group together, but the string itself never crosses the wire.

```
fingerprint = sha256(errorName + normalizedMessage + top5RepoRelativeFrames)[0..16]
```

Transmitted per error: `fingerprint`, `count`, `kind`, `errorName`, `providerKind`,
`frames`, plus the envelope's `version`. This is sufficient to locate and fix most
provider breakage.

### 5.1 Consent surface

With `errorReports: "ask"` (default), an unhandled error prompts:

```
Kunai hit an error. Send an anonymous report?

  TypeError  ·  allanime  ·  v0.3.0
  packages/providers/src/allmanga/api-client.ts:214
  apps/cli/src/services/providers/resolve.ts:88
  fingerprint 9f2a41c7e80b3d55  ·  no message, titles, queries, or paths

  [y] send   [n] skip   [v] view full JSON   [a] always send
```

The user sees the exact bytes before pressing `y`. This is what makes the privacy
claim verifiable rather than promised, and it is the right default for a tool whose
users are privacy-sensitive by construction.

## 6. Server architecture

```
CLI ──> /api/install ─┐
        /api/ping ────┼──> Upstash Redis (hot: dedup, rate limit, HINCRBY counters)
        /api/report ──┘         kunai:day:<day>:<version>    installs, os, ageBuckets
                                kunai:hour:<day>:<hh>        actives per hour
                                kunai:rel:<day>:<version>    provider ok/fail/codes
                                kunai:err:<day>              fingerprint -> count
                                        │
                              daily rollup cron
                                        │
                                        v
                        Postgres (Neon) — durable record
                                        │
                        ┌───────────────┴───────────────┐
                        v                               v
              /metrics/series.json              /metrics/ops.json
              PUBLIC, k-anonymized              PRIVATE, bearer auth
              counts / versions / os            providers, error fingerprints
```

### 6.1 Why Redis and Postgres both

Redis is the write path: atomic counters, per-install-per-day claim gates, and rate
limiting at ingest speed with no connection pooling concerns in a serverless
function. Postgres is the durable record: append-only, queryable, backed up.

Redis keys carry a short TTL (48h) — they are a buffer, not a record. Postgres is the
source of truth for everything charted or queried.

### 6.2 Counters, not overwrites

Aggregate counters use `HINCRBY`. A per-day `SET` would mean the last install to
report overwrites every prior install's numbers for that day — not lossy data, but
arithmetically wrong data presented as a fleet metric.

`/api/report` is gated by a per-install-per-day claim, identical to the existing
`/api/ping` gate, so a single install cannot stuff counters.

### 6.3 Schema

```sql
CREATE TABLE metric_daily (
  day         date   NOT NULL,
  metric      text   NOT NULL,   -- active_installs | new_installs | install_beacons
  version     text   NOT NULL,   -- semver, or '' for all-versions rollup
  os          text   NOT NULL,   -- platform, or '' for all-os rollup
  value       bigint NOT NULL,
  sample_size bigint NOT NULL,
  PRIMARY KEY (day, metric, version, os)
);

CREATE TABLE metric_hourly (
  bucket timestamptz NOT NULL,
  metric text        NOT NULL,
  value  bigint      NOT NULL,
  PRIMARY KEY (bucket, metric)
);

CREATE TABLE provider_daily (
  day      date   NOT NULL,
  version  text   NOT NULL,
  provider text   NOT NULL,
  ok       bigint NOT NULL,
  fail     bigint NOT NULL,
  codes    jsonb  NOT NULL,
  PRIMARY KEY (day, version, provider)
);

CREATE TABLE error_daily (
  day           date      NOT NULL,
  version       text      NOT NULL,
  fingerprint   char(16)  NOT NULL,
  count         bigint    NOT NULL,
  error_name    text      NOT NULL,
  provider_kind text      NOT NULL,
  frames        jsonb     NOT NULL,
  PRIMARY KEY (day, version, fingerprint)
);
```

Empty string is the sentinel for "all", because `NULL` in a primary key does not
behave as an equality-comparable value in Postgres.

## 7. Data quality

Pollution defenses are a first-class layer, not a footnote.

1. **Strict semver on `version`, closed allowlist on `os`/`arch`.** Today
   `ingest.ts:61` accepts any string up to 64 characters, which flows unvalidated
   into the public snapshot. Since `version` is now a join key, a polluted value
   corrupts a dimension rather than merely a display string.
2. **k-anonymity floor of 10.** Any version or OS cohort below 10 reporting installs
   is suppressed from published output. This does double duty: it prevents
   small-cohort deanonymization, and it stops a single unusual install from producing
   a spike that reads as a trend.
3. **Per-install daily counter caps.** Reliability counters are clamped at 500
   resolves per install per day, so a runaway loop cannot dominate a fleet number.
4. **Container and ephemeral detection.** `/.dockerenv`, cgroup inspection, and `CI`.
   Ephemeral installs appear as `new` forever and would silently poison every
   retention cohort. They are counted but excluded from cohort trends.
5. **`sampleSize` published alongside every rate.** A 94% success rate over n=12 is
   noise; the chart must say so rather than draw a confident line.

**k-anonymity is applied at the publish boundary, not at write time.** Raw data is
stored complete; suppression happens on read. The threshold can then be tuned without
having destroyed data.

## 8. Local event store

Kunai already has `diagnostic_events` in SQLite with retention and pruning in
`packages/storage/src/maintenance.ts`. A parallel rotating-NDJSON event store with
its own retention would duplicate that entire mechanism — precisely the design smell
`CLAUDE.md` prohibits.

Analytics events are therefore written to `diagnostic_events` under a dedicated
`category = 'analytics'`, through a builder that accepts only the closed
`AnalyticsEvent` shape. Aggregation is a SQL query filtered to that category.
One store, one retention policy, one surface to audit for PII.

```ts
type AnalyticsEvent = {
  readonly name: AnalyticsEventName; // centrally registered union — audit trail
  readonly category: "provider" | "playback" | "runtime";
  readonly ts: number;
  readonly durationMs?: number;
  readonly outcome?: "success" | "failure" | "unknown";
  readonly providerKind?: string;
  readonly code?: string; // enum-constrained, never free text
};
```

No `titleId`, `sessionId`, `installId`, query string, URL, or filename is
representable in this type. That is enforced by the type, not by a redaction pass.

Capture points:

- **Provider resolve** — `provider.resolve.start`, `.end`, `.error`, `.fallback`
- **Playback lifecycle** — `playback.start`, `.end`, `.error` with outcome and end reason
- **mpv telemetry** — `mpv.end_file`, `mpv.stream_stall`, `mpv.process_exit` via an
  optional callback seam on `apps/cli/src/infra/player/mpv-telemetry.ts`, wired from
  the container layer so the infra module keeps zero imports from `services/` or
  `storage/`

With no sink configured, behaviour is unchanged.

## 9. Privacy invariants

These are tests, not prose:

1. Payload types are closed shapes of primitives. No `string` field accepts free text
   except allowlisted enums and semver.
2. Every payload builder is serialized against a fixture session containing known
   titles, queries, and file paths; the output is asserted to contain none of them.
3. All three endpoints reject unknown keys.
4. **Allowlist, never redaction.** Redaction is a denylist, and denylists leak.
5. The wire contract page in the docs is generated from the TypeScript types, so a
   privacy claim cannot drift from the code.

## 10. Setup wizard

`apps/cli/src/app-shell/setup-shell.tsx` is 825 lines with seven slides. Slide count
stays at seven — product values merge into `welcome` rather than adding an eighth.

| Slide                   | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `welcome`               | Add the product-values contract: local-first, no account, no cloud sync, everything opt-in, history never leaves the machine. Four lines that frame every consent ask that follows.                                                                                                                                                                                                                                                                                       |
| `system`                | **Detect → prescribe → verify.** Detect the platform package manager (`pacman`, `apt`, `dnf`, `brew`, `winget`, `scoop`) and render a copy-paste install command per missing dependency, with `r` to re-probe in place. `CapabilityIssue.remediation` in `apps/cli/src/ui.ts` becomes package-manager-aware. Separate **required** (`mpv`) from **optional** (`yt-dlp` → downloads, `chafa`/`magick` → posters) so a degraded poster renderer does not read as a blocker. |
| `telemetry` → `privacy` | Three tiers, error-report mode, and an inline preview of the literal payload on the same screen.                                                                                                                                                                                                                                                                                                                                                                          |

```
❮ step 6/7 ❯   ●●●●●○○

  Privacy

  Kunai is local-first. Nothing below is on by default.

  Usage data      ( ) Off
                  (•) Basic      daily heartbeat — install count only
                  ( ) Full       + which providers fail, so churn gets fixed

  Error reports   (•) Ask me     prompt on crash, review before sending
                  ( ) Always     send automatically
                  ( ) Never

  ┌ exactly what a heartbeat sends ─────────────────────────┐
  │ { "installId": "8f3c…", "ageBucket": "new",             │
  │   "version": "0.3.0", "os": "linux", "arch": "x64" }    │
  │   id rotates every 30 days · no titles, queries, paths  │
  └─────────────────────────────────────────────────────────┘

  ↑↓ move · ←→ change · tab next field · enter continue
```

Showing the literal bytes beside the toggle is what earns the opt-in. Describing
telemetry is common; showing it is not.

**Structural change:** extract slides to `app-shell/setup/slides/*.tsx` behind a
registry, following the existing registry-driven pattern in `app-shell/settings/*`.
An 825-line file gaining three reworked slides needs the seam regardless of this
feature.

**`kunai doctor`** exposes the `system` slide's capability probe as a standalone
non-interactive command. The computation already exists; it is simply unreachable
after first run, which is exactly when it is needed.

## 11. Docs charts

`apps/docs` has the shadcn CLI in devDependencies and no chart library.
`bunx shadcn@latest add chart` provides Recharts wired to CSS variables, letting
`@kunai/design` tokens drive series colours — one theme, no hand-picked hex values.
evilcharts is shadcn-registry-compatible, so its animated line and glow variants can
be pulled into the same primitives for the hero chart. shadcn `chart` is the base;
evilcharts is used selectively.

| Chart                | Form                                 | Question answered                         |
| -------------------- | ------------------------------------ | ----------------------------------------- |
| Daily actives (hero) | Area + 7-day moving average, 90 days | Is this growing                           |
| Live actives         | Line over hourly buckets, 48 hours   | What is happening now                     |
| Version adoption     | 100% stacked area                    | Has everyone moved off the broken release |
| New vs returning     | Stacked area from `ageBucket`        | Retention                                 |
| OS / arch split      | Horizontal stacked bar               | Where to test                             |
| Lifetime installs    | Animated count-up from beacon totals | Headline number                           |

**On liveness:** with a once-daily ping, a live-updating line is theatre. An hourly
`HINCRBY` bucket costs nothing and produces a real 48-hour line that genuinely moves.
Liveness comes from hourly buckets; daily data is never animated to imply it is live.

Private ops page — same app, bearer auth, `noindex`: provider success rate over time
sliced by version, and a top-error-fingerprint table with first-seen and last-seen
version. A fingerprint present at 0.3.0 and absent at 0.2.9 is a located regression.

The `dataviz` skill is loaded before any chart code is written, so all six read as one
system rather than six separate widgets.

## 12. Verdicts on the T01–T13 proposal

| Issue                          | Verdict                 | Reason                                                                                                                                                                                                 |
| ------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T01 diagnostics export         | **Keep, revised**       | Reframe from redaction to allowlist. The same builder renders the crash-report preview (§5.1).                                                                                                         |
| T02 HTTP retry with backoff    | **Replace**             | Backoff timers die with a short-lived CLI process. Use the `telemetryRetryAfter` marker (§3.3) instead — smaller and more reliable.                                                                    |
| T03 persist mpv telemetry      | **Keep, folded**        | Callback seam is right; destination is `diagnostic_events`, not a new store.                                                                                                                           |
| T04 `kunai telemetry status`   | **Drop**                | `/telemetry` and `/telemetry show` already exist (`shell-workflows.ts:1370-1432`). Only tier-awareness needs updating.                                                                                 |
| T05 NDJSON analytics sink      | **Partially keep**      | Keep `AnalyticsEvent` and the sink interface; reject the NDJSON store as duplicating `diagnostic_events` + `maintenance.ts`.                                                                           |
| T06 provider resolve events    | **Keep**                | §8.                                                                                                                                                                                                    |
| T07 playback lifecycle events  | **Keep**                | §8.                                                                                                                                                                                                    |
| T08 aggregate on daily ping    | **Replace**             | "Last-writer-wins on the server" is arithmetically wrong, not lossy. Separate `/api/report` endpoint with `HINCRBY` (§6.2).                                                                            |
| T09 relax ping parser          | **Reject**              | The ping parser stays strict. A new endpoint carries the new shape.                                                                                                                                    |
| T10 stale-while-revalidate     | **Keep**                | Correct and trivial.                                                                                                                                                                                   |
| T11 `timingSafeEqual` for cron | **Drop**                | The issue text concedes `===` is already constant-time, and naive `timingSafeEqual` throws on length mismatch — introducing a crash path. If adopted, both sides must be hashed to equal length first. |
| T12 consent tier "analytics"   | **Keep, revised**       | Becomes `off`/`basic`/`full` plus an orthogonal `errorReports` mode (§3).                                                                                                                              |
| T13 stale install ids          | **Mostly already done** | `ensureInstallId` already validates and regenerates on every ping path. The real remaining work is rotation (§2.1), which is different work.                                                           |

Net: 5 keep, 4 revise or replace, 3 drop, 1 trivial.

## 13. Build order

Each phase is independently shippable and gets its own implementation plan. This
document is the design of record for all of them; it is deliberately larger than a
single plan's worth of work.

- **Phase 0 — Correctness and pollution fixes.** Semver and allowlist validation on
  ingest, `telemetryRetryAfter`, stale-while-revalidate header. No schema change, no
  migration; ships immediately.
- **Phase 1 — Identity and consent.** Rotating id, age bucket, first-run beacon,
  `/api/install`, config migration to the tier model.
- **Phase 2 — Setup wizard.** Slide registry extraction, values in `welcome`,
  package-manager-aware `system` slide, `privacy` slide, `kunai doctor`.
- **Phase 3 — Durable store.** Neon Postgres, schema, rollup cron, public
  `/metrics/series.json` with k-anonymity suppression.
- **Phase 4 — Docs charts.** shadcn chart primitives on design tokens, six public
  charts, hourly live line.
- **Phase 5 — Local analytics and reliability.** `AnalyticsEvent` into
  `diagnostic_events`, provider and playback capture points, mpv telemetry seam,
  `/api/report`, private ops page.
- **Phase 6 — Error reporting.** Fingerprinting, crash prompt, diagnostics export.
- **Phase 7 — Regression alerting.** Cron diffs each fingerprint's rate against the
  prior release; new-in-version or 3× worse opens a GitHub issue via `gh`. Turns
  telemetry from a dashboard someone remembers to check into a thing that pages.

## 14. Testing

- Consent matrix: every tier × `DO_NOT_TRACK` × `CI` × TTY combination.
- Config migration: `enabled`/`disabled`/`unset` map correctly and idempotently.
- Rotation: id changes at the 30-day boundary and not before; `ageBucket` derivation
  at each threshold.
- Beacon: fires exactly once; a failed send retries next run; never persists its id.
- Retry: failure leaves `lastTelemetryPingAt` untouched and sets
  `telemetryRetryAfter`; success sets both.
- Fingerprinting: identical errors with differing dynamic content produce identical
  fingerprints; messages never appear in output.
- PII fixtures: known titles, queries, and paths absent from every payload builder's
  output (§9.2).
- Ingest validation: non-semver versions, unknown os/arch, unknown keys, and clock
  skew all rejected on all three endpoints.
- Aggregation: `HINCRBY` accumulates across installs; empty stores yield valid
  zero-count aggregates rather than crashes.
- k-anonymity: cohorts below 10 are suppressed on read while remaining intact in
  storage.
