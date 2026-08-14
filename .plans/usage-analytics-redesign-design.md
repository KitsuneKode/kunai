# Usage analytics redesign

Date: 2026-08-14
Status: approved design, not yet implemented
Supersedes: `.archive/superpowers/archive/specs/2026-07-25-telemetry-privacy-and-observability-design.md`

## Why

The opt-in ping subsystem never shipped. `v0.2.5` contains no
`services/telemetry/`, no `apps/telemetry-ingest`, and no `telemetry`,
`installId`, `lastTelemetryPingAt`, `telemetryRetryAfter`, or
`telemetryEndpoint` keys in config. Only the mpv and playback files carry the
word. Nothing is deployed, no install ids exist in the wild, and there is no
Redis data to preserve.

That makes every name, every config key, the endpoint hostname, and the storage
backend a free choice exactly once — before 0.3.0.

Six defects motivate the rewrite rather than a patch.

### 1. Three of five payload fields are dead

`payload-validation.ts` defends `version`, `os`, and `arch` with strict semver
and closed allowlists. `ingestTelemetryPing` then records only `installHash`
into the day set and the HyperLogLog, and `buildPublicMetricsSnapshot`
publishes only `activeInstalls` and `lifetimeInstallsApprox`. Nothing
aggregates by version or platform.

The privacy contract calls these "aggregation keys". They are transmitted,
validated, and discarded. This is the silent no-op failure mode named in
`CLAUDE.md`, and here the no-op is pure privacy surface: data collected for no
decision.

### 2. Consent policy exists in three places with three semantics

- `consent.ts` gates on `isTruthyEnv` — `1`, `true`, `yes`.
- `main.ts:892` re-derives the same decision as
  `Boolean(process.env.CI?.trim())`.
- `setup-workflows.ts:37` is a third copy that writes config keys directly,
  bypassing `TelemetryService.setStatus`.

With `CI=0` or `DO_NOT_TRACK=0`, `resolveTelemetryConsent` correctly reports
_not blocked_, but the `main.ts` copy reports _blocked_ and permanently
persists `telemetry: "disabled"`. An environment variable explicitly saying
"no" is read as "yes".

`main.ts:884` also fabricates `choice: "timeout"` so a prompt-shaped function
can be reused as an environment gate. The signature does not fit the call site.

### 3. Declining creates and persists a tracking identifier

`setStatus("disabled")` calls `ensureInstallId` and saves the result
(`TelemetryService.ts:85`). `previewPayload()` persists one too, and
`handleTelemetry` calls it merely to render the menu. Opening `/telemetry` on a
fresh install therefore writes a stable install UUID to disk.
`setup-workflows.ts:80` does the same on the skipped path.

The contract guarantees zero _network calls_ while unset. It says nothing about
not creating the identifier, and the code lives in that gap.

### 4. `previewPayload()` is a query that writes

Named and typed as a preview. Mutates and saves config.

### 5. Four ports that are Redis data structures, not domain concepts

`RateLimitStore`, `InstallDayGate`, `DailyDistinctStore`, and `LifetimeStore`
exist because Redis needed a TTL key, a SET, and a HyperLogLog respectively.
Under per-dimension aggregation this gets worse: a key per
`day × version × os × arch`, every combination decided in advance, nothing
answerable retroactively.

`lifetimeMethod: "hyperloglog"` in the public metrics contract is the same leak
reaching all the way into a published wire format.

### 6. The feature is inert for anyone who skips setup

`telemetry: "unset"` has no resolution path outside the setup wizard, and
`unset` never re-prompts.

## Decisions

| Question        | Decision                                                          |
| --------------- | ----------------------------------------------------------------- |
| Scope           | Installs **plus** version / os / arch, actually aggregated        |
| Naming          | Remote subsystem renamed to `analytics`; local names unchanged    |
| Backend         | Neon Postgres; rate limiting out of the database                  |
| Consent default | **On by default, opt out**, with explicit disclosure              |
| No TTY          | Stays off — disclosure cannot happen, so consent has not happened |
| Skip            | Keeps it on, and the hint says so                                 |
| Upgraders       | One-time non-blocking startup banner                              |

## Non-goals

- Provider success/latency aggregates ("telemetry v2" in
  `.plans/kunai-beta-v1-scope-and-contracts.md:68`). The `extra` seam in §5
  exists so this lands later without re-architecture or re-consent.
- Renaming `mpv-telemetry.ts`, `PlaybackTelemetrySnapshot`, or the
  `domain/playback` snapshot. Accepted residue; see §1.
- Replacing `services/diagnostics/`. Local diagnostics stay local and stay the
  first-class support path.

---

## §1 Naming

| From                                                    | To                                                 |
| ------------------------------------------------------- | -------------------------------------------------- |
| `apps/cli/src/services/telemetry/`                      | `apps/cli/src/services/analytics/`                 |
| `TelemetryService`                                      | `UsageAnalyticsService`                            |
| `apps/telemetry-ingest`, `@kunai/telemetry-ingest`      | `apps/analytics-ingest`, `@kunai/analytics-ingest` |
| config `telemetry`                                      | `analytics`                                        |
| config `lastTelemetryPingAt`                            | `lastAnalyticsPingAt`                              |
| config `telemetryRetryAfter`                            | `analyticsRetryAfter`                              |
| config `telemetryEndpoint`                              | `analyticsEndpoint`                                |
| `KUNAI_TELEMETRY_URL`                                   | `KUNAI_ANALYTICS_URL`                              |
| `KUNAI_TELEMETRY_METRICS_URL`                           | `KUNAI_ANALYTICS_METRICS_URL`                      |
| `.docs/telemetry-privacy-contract.md`                   | `.docs/analytics-privacy-contract.md`              |
| `apps/docs/components/telemetry/opt-in-usage-panel.tsx` | `apps/docs/components/analytics/usage-panel.tsx`   |
| `apps/docs/components/home/opt-in-telemetry-line.tsx`   | `apps/docs/components/home/usage-line.tsx`         |
| `apps/docs/lib/telemetry-metrics.ts`                    | `apps/docs/lib/analytics-metrics.ts`               |

No config migration is required: no released version ever wrote these keys.
`ConfigServiceImpl` loads unknown keys defensively already, so a hand-edited
config carrying the old names degrades to defaults rather than crashing.

`/analytics` becomes the command id. `telemetry` and `telemetry show` stay
registered as aliases in `command-registry.ts` — aliases already exist there,
they cost nothing, and "telemetry" is the word users will type.

`app-shell` must not import `services/analytics` modules directly. It reaches
the service through the container, which the boundary test will assert.

**Accepted residue.** `mpv-telemetry.ts`, `PlaybackTelemetrySnapshot`, and
`domain/playback/playback-telemetry-snapshot.ts` keep the word "telemetry" for
local, never-transmitted playback data. This is a deliberate choice to keep the
release diff reviewable. The one edit: `ResolveTraceSink`'s doc comment says
"telemetry must never be able to fail a playback" — reworded, because after
this change "telemetry" names a specific subsystem that `ResolveTraceSink` is
not.

## §2 Consent

### States

```ts
type AnalyticsPreference = "unset" | "enabled" | "disabled";
```

- `unset` — the disclosure has never been shown. **Sends nothing.**
- `enabled` — disclosure shown; user accepted, skipped, or took no action.
- `disabled` — user explicitly turned it off.

### The first run never sends

Disclosure happens, the preference is persisted, and the first ping goes out on
the _next_ launch. This is the rule that makes "on by default, disclosed"
different from "collected before you were told", and it is what the .NET CLI
and Homebrew do. Without it the ping has already left the machine by the time
the notice renders.

### One policy module

`apps/cli/src/domain/analytics/consent-policy.ts` — pure, no `process.env`
default parameter, no I/O:

```ts
type ConsentEnv = { readonly DO_NOT_TRACK?: string; readonly CI?: string };

type ConsentState =
  | { kind: "blocked-by-env"; flag: "DO_NOT_TRACK" | "CI" }
  | { kind: "undisclosed-non-interactive" }
  | { kind: "awaiting-disclosure" }
  | { kind: "enabled" }
  | { kind: "disabled" };

function resolveConsentState(inputs: {
  readonly env: ConsentEnv;
  readonly isInteractive: boolean;
  readonly stored: AnalyticsPreference;
}): ConsentState;

function canSend(state: ConsentState): boolean; // only "enabled"
function canPersistEnabled(state: ConsentState): boolean; // false when env-blocked
```

`isTruthyEnv` (`1` / `true` / `yes`, case-insensitive, trimmed) is the single
definition of a set flag. `0`, `false`, `no`, and empty string mean **not**
blocked. This removes the `CI=0` defect.

Environment gating and user choice no longer share a function signature. There
is no fabricated `choice: "timeout"`.

### Session start

`main.ts:875-903` collapses to `container.usageAnalytics.onSessionStart()`.
All branching moves inside the service:

| `resolveConsentState`         | Action                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `blocked-by-env`              | If stored is `enabled`, rewrite to `disabled`. Never send.                                    |
| `undisclosed-non-interactive` | Return. Write nothing, send nothing, stay `unset`.                                            |
| `awaiting-disclosure`         | Raise the disclosure (wizard slide or banner). Persist the outcome. **Do not send this run.** |
| `enabled`                     | `maybePing()` — unchanged 24h cadence and retry semantics.                                    |
| `disabled`                    | Return.                                                                                       |

The `undisclosed-non-interactive` row is a behavior change: today non-TTY
writes `disabled` permanently. Staying `unset` means a user who first runs
`kunai` in a pipe and later runs it interactively still gets the notice.

### One writer

`setup-workflows.ts` stops writing analytics config keys. The service exposes:

```ts
consentPatch(choice: "enabled" | "disabled"): Partial<KunaiConfig>  // pure
setConsent(choice): Promise<void>  // update(consentPatch(choice)) + save
```

Setup merges `consentPatch` into its existing single batched `config.update()`,
preserving one save. There is exactly one definition of what a consent choice
means in config, and no second writer.

## §3 Install id lifecycle

`ensureInstallId` is called from exactly one place: the enable path.

- `setConsent("disabled")` writes `{ analytics: "disabled", installId: "" }`.
- `previewPayload()` becomes `describePayload()`: pure, zero writes. For a user
  who is not enabled it renders `"installId": "<generated when you enable>"`
  instead of minting a real UUID.
- Opening `/analytics` creates no persistent state.

New guarantee, statable in the contract because it is now true:

> `installId` exists on disk **if and only if** analytics is enabled.

`install-id.ts` is otherwise unchanged. Its `isMacShaped` /
`looksLikeHostnameOrUsername` guards stay — they defend against a hand-edited
config, which remains possible.

## §4 Wire payload

```json
{
  "installId": "<uuid>",
  "version": "<semver>",
  "os": "<platform>",
  "arch": "<arch>",
  "ts": 0
}
```

Shape unchanged from today, but now fully consumed. `payload-validation.ts`
stays exactly as strict — exact key-set equality, so a payload carrying any
additional key is rejected. The difference is that the allowlists now guard
values that enter published aggregates, so the strictness has a purpose.

`ts` is retained for clock-skew rejection.

At release the wire format has exactly these five keys. The `extra` seam in §5
is a **database column only**; no wire field ships with it.

## §5 Storage — Neon Postgres

```sql
create table ping_day (
  day          date        not null,
  install_hash bytea       not null,          -- HMAC-SHA256(secret, installId)
  version      text        not null,
  os           text        not null,
  arch         text        not null,
  extra        jsonb       not null default '{}'::jsonb,
  first_seen   timestamptz not null default now(),
  primary key (day, install_hash)
);
create index ping_day_day_idx on ping_day (day);

create table install_lifetime (
  install_hash bytea primary key,
  first_seen   date not null
);

create table daily_rollup (
  day               date primary key,
  active_installs   integer     not null,
  by_version        jsonb       not null,     -- {"0.3.0": 42, ...}
  by_os             jsonb       not null,
  by_arch           jsonb       not null,
  lifetime_installs integer     not null,
  computed_at       timestamptz not null default now()
);
```

### Ingest is one statement, and that statement is the gate

```sql
insert into ping_day (day, install_hash, version, os, arch)
values ($1, $2, $3, $4, $5)
on conflict (day, install_hash) do nothing;
```

This replaces `InstallDayGate.claim` followed by `DailyDistinctStore.record`
and is atomic, which that pair never was. One install writes at most one row
per UTC day regardless of how many times it pings.

`install_lifetime` receives the same `on conflict do nothing` treatment.

### One port

```ts
type AnalyticsStore = {
  recordPing(input: {
    day: string;
    installHash: Buffer;
    version: string;
    os: string;
    arch: string;
  }): Promise<void>;
  computeRollup(day: string): Promise<DailyRollup>;
  readRollup(day: string): Promise<DailyRollup | null>;
  pruneRawBefore(day: string): Promise<number>;
};
```

Two implementations: `PostgresAnalyticsStore` (via `@neondatabase/serverless`,
HTTP driver, `DATABASE_URL`) and `MemoryAnalyticsStore` for tests. Four ports
become one.

### Retention

Cron at `5 0 * * *` computes yesterday's rollup with `GROUP BY`, upserts
`daily_rollup`, then:

```sql
delete from ping_day where day < current_date - interval '35 days';
```

Raw dimension rows live 35 days. `daily_rollup` is permanent and contains no
identity of any kind.

### Retention tradeoff to state plainly

`install_lifetime` holds one row per install, forever, containing an HMAC hash
and a first-seen date. This is a **durable pseudonymous record where the old
HyperLogLog design kept only a probabilistic sketch**. It is what an exact
lifetime count costs.

It is defensible — the hash is not reversible without `ANALYTICS_HASH_SECRET`,
nothing is joined to it, and it carries no dimension data — but it is a real
change in posture and must appear verbatim in
`.docs/analytics-privacy-contract.md` and the user-facing MDX. It must not be
described as equivalent to the sketch it replaces.

### Extension seam

`ping_day.extra jsonb` ships at release as an always-empty column. **No wire
field accompanies it** — §4's key-set check still rejects any payload with a
sixth key, so nothing can write to `extra` until a deliberate change opens it.

The column's purpose is that adding a future dimension is then an allowlist
entry, a wire-key addition, and a `GROUP BY` — never a migration on a table
that already holds production rows. Strict validation applies when that day
comes: `extra` keys are allowlisted individually and an unknown key is
rejected, exactly as `os` and `arch` are today.

**Metric intake rule**, recorded in the contract: before any field ships, write
down (a) the decision it will change, (b) the aggregate that answers it, and
(c) its k-anonymity floor. A field that cannot name a decision does not ship.
This is the mechanism that stops the payload from silently regrowing the
problem this document exists to fix.

## §6 Rate limiting leaves the code

`RateLimitStore` is deleted. The stated reason, which is also the honest one:
the current in-memory limiter is per-instance on serverless and resets on every
cold start, so it already provides far less than its presence implies.

Replacement, layered:

1. `MAX_BODY_BYTES = 512` — already present, retained.
2. Vercel platform DDoS mitigation — automatic.
3. `primary key (day, install_hash)` — a real install writes at most one row
   per day regardless of ping volume.

The residual abuse vector is minting many UUIDs, which per-IP limiting does not
stop either. If an explicit cap is wanted it is a Vercel Firewall rate-limit
rule on `/api/ping` — configuration, not application code.

`clientIpKey()` in `api/ping.ts` is deleted along with the limiter. The
function currently reads `x-forwarded-for`; removing it means the ingest code
never touches a client IP at all, which is a stronger claim than hashing one.

## §7 Public metrics — schemaVersion 2

```json
{
  "schemaVersion": 2,
  "day": "2026-08-13",
  "activeInstalls": 128,
  "lifetimeInstalls": 512,
  "byVersion": { "0.3.0": 96, "0.2.5": 32 },
  "byOs": { "linux": 80, "darwin": 40, "other": 8 },
  "byArch": { "x64": 96, "arm64": 32 },
  "updatedAt": "2026-08-14T00:05:00.000Z"
}
```

`lifetimeMethod` is dropped. It was a storage detail in a public contract, and
with Postgres the count is exact rather than approximate.

### k-anonymity floor

Any dimension bucket with fewer than **5** installs folds into `"other"`.

This is the one genuinely new privacy cost of aggregating dimensions:
`byVersion` + `byOs` + `byArch` published together identify a single user on an
unusual combination in a small population. The floor of 5 is the conventional
default; it is a knob, and it belongs in the contract as a stated number rather
than an implementation detail.

Suppression applies to the **public** JSON only. The private admin endpoint in
§8 reads unsuppressed rollups.

`parseDocsAnalyticsMetrics` in `apps/docs/lib/` moves to the v2 key set,
keeping the same strict exact-key-set check it uses today.

## §8 Docs page and observability

- The existing panel keeps its two hero numbers and gains three compact
  breakdown bars — version, os, arch. ISR stays at 3600s. Follow the `dataviz`
  conventions already used elsewhere in the docs app.
- `GET /api/metrics/admin` returns the last 30 days of unsuppressed rollups,
  guarded by a bearer token in `ANALYTICS_ADMIN_TOKEN`. No second platform,
  no dashboard to maintain — for anything beyond this, the backend is SQL.
- Cron health: `daily_rollup.computed_at` drives the public `updatedAt`. A
  stale `updatedAt` is itself the alarm; no separate monitor is needed.

## §9 Consent UI

### Setup wizard slide

Replaces `TelemetrySlide` in `setup-shell.tsx:482-548`.

```
  ❀  Anonymous usage ping                    ✿    ❀
  ─────────────────────────────────────────────────
  On by default. One ping per day. Turn it off
  right here, or anytime with /analytics.

  ▌ Keep it on                        ← default
    Shows me which versions and platforms to support

    Turn it off
    No network calls. No install id stored on disk.

  ┌ Exactly what is sent ──────────────────────────┐
  │ { "installId": "9f3a…", "version": "0.3.0",    │
  │   "os": "linux", "arch": "x64", "ts": 0 }      │
  └────────────────────────────────────────────────┘
  Never: titles · queries · providers · URLs · paths

  Enter confirm  ·  ↑↓ choose  ·  ←/b back
  s skip (keeps it on)
```

Changes from the current slide:

- Default selection is index 0 = **keep it on**. Today index 0 is "keep
  telemetry off (recommended default)".
- The exact payload is shown **inline**, not hidden behind `/telemetry show`.
  When the default is on, the payload must be visible at the moment of the
  decision.
- An explicit never-sent line.
- `s` now means _keep it on_, and the hint reads `s skip (keeps it on)` —
  never a bare `s skip`. With an opt-out default this single clause is the
  difference between disclosure and a dark pattern.
- `setup-shell.tsx:826`'s abort path currently returns
  `telemetryChoice: "disabled"`. It stays `disabled`: aborting the wizard is
  not disclosure.

### Motion

Restrained, and never underneath text being read.

- Flanking side petals (`✿`) drift on a slow beat and the corner bloom cycles
  `BLOOM_FRAMES`, both via the existing `SakuraPetal` frame primitives in
  `apps/cli/src/app-shell/primitives/SakuraPetal.tsx`.
- Title, options, and the payload block are **static**. No `GlimmerLabel`
  sweep on this surface — a shimmer running under a consent decision is
  motion for its own sake.
- `reducedMotionEnabled()` collapses everything to `STATIC_PETAL`, delegated
  to the same primitives so there is one motion policy across the app.
- Slow cadence: the bloom beat here is deliberately longer than
  `BLOOM_INTERVAL_MS = 150` used for in-flight loaders. This screen is not
  loading anything, and loader-speed motion would say it is.

### Startup banner for upgraders

Users at `analytics: "unset"` who never see the wizard get one non-blocking
banner on next interactive launch: what is sent, that it is on, and
`/analytics` to turn it off. It carries the same `SakuraPetal` identity as the
slide.

The preference persists as `enabled` on dismiss, or on the following launch if
the session ends without a dismissal. **That run still sends nothing** — the
first-run rule in §2 applies to the banner exactly as it does to the wizard.

Shown once. Never again.

## §10 Documents that must change in the same change set

These four contradict the code the moment opt-out lands. The contract already
mandates that the first two move together; this list extends it.

1. `CLAUDE.md` — the non-negotiable currently reads "Telemetry is opt-in and
   payload-bounded" and points at `.docs/telemetry-privacy-contract.md`.
   Becomes: analytics is **on by default, opt-out, disclosed before first
   send**, and payload-bounded.
2. `.docs/telemetry-privacy-contract.md` → `.docs/analytics-privacy-contract.md`
   — consent section rewritten; new rows for the `install_lifetime` retention
   tradeoff (§5), the k-anonymity floor (§7), the
   `installId`-iff-enabled guarantee (§3), and the metric intake rule (§5).
3. `docs/users/reliability-and-privacy.mdx` — user-facing wording.
4. `.docs/feature-map.md:120` — path and doc-link update.

`CLAUDE.md` also carries "Kunai must never ship a shared public relay URL",
immediately above the telemetry line. Analytics deliberately does ship a
default endpoint. Add one clause naming the distinction — relay carries user
traffic and must stay user-owned; analytics carries a bounded anonymous
aggregate and ships a maintainer-owned default — so the two rules do not read
as contradictory to the next person.

Run `bun run verify:doc-paths` after these edits.

## §11 Tests

**Consent policy** — truth table across
`{DO_NOT_TRACK, CI} × {unset, "0", "1", "false", "true", "yes", ""} ×
{interactive, non-interactive} × {unset, enabled, disabled}`. Explicitly
asserts `CI=0` and `DO_NOT_TRACK=0` are **not** blocking.

**First run never sends** — `onSessionStart()` from `unset` persists a
preference and performs zero fetches. The launch after it does send.

**Identifier lifecycle** — `setConsent("disabled")` leaves `installId` empty;
`describePayload()` performs zero config writes; opening `/analytics` writes
nothing.

**Non-interactive** — stays `unset`, writes nothing, sends nothing; a later
interactive run still discloses.

**Single writer** — setup produces exactly one `config.save()`.

**Ingest** — two pings from the same install on the same day yield one row;
k-anonymity suppression folds buckets under 5 into `other`; `pruneRawBefore`
deletes only rows older than the cutoff; `install_lifetime` is idempotent.

**Drift** — the wire payload key set matches the JSON documented in both
`.docs/analytics-privacy-contract.md` and `docs/users/reliability-and-privacy.mdx`.
Extends the existing `apps/docs/test/drift.test.ts` approach so the contract
cannot silently diverge from the code.

**Boundary** — `app-shell` imports no `services/analytics` module directly.

**Reduced motion** — the consent slide renders `STATIC_PETAL` and no frame
ticks when `reducedMotionEnabled()` is true.

## Open knob

The k-anonymity floor of **5** (§7) is the conventional default and was not
explicitly confirmed. It is a one-line constant; changing it later costs
nothing but a contract edit.
