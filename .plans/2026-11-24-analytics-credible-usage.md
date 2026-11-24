# Plan: Credible Opt-In Usage Analytics

## Status

- **Status:** PROPOSED (design plan — no code changes in this PR).
- **Date:** 2026-11-24 (recorded decision in [2026-11-24-road-to-9-5.md](./2026-11-24-road-to-9-5.md)).
- **Supersedes in scope:** Extends [usage-analytics-redesign.md](./usage-analytics-redesign.md) and [2026-08-26-analytics-series-and-social-cards.md](./2026-08-26-analytics-series-and-social-cards.md) without reopening [2026-09-11-analytics-ist-day-boundary.md](./2026-09-11-analytics-ist-day-boundary.md).
- **Owner:** Unassigned; **Phase 0 requires one maintainer decision** (consent screen default, Section 4).

## Problem

On 2026-11-24 the maintainer decided to **keep and improve** opt-in usage analytics to get credible evidence of who uses Kunai and how. Today's system is privacy-solid but nearly blind at real traffic:

- **Observed baseline:** 69 first-seen installs in 30 days; 2–10 active installs/day (median 6).
- **Total breakdown collapse:** `SMALL_CELL_FLOOR = 5` plus `sealResidual` (binary `arch` collapses to 100% `other` whenever either `x64` or `arm64` is 1–4) and `windowPublishableBuckets` (any single day `< 5` suppresses a bucket across the entire 90-day series) fold every `version`, `os`, and `arch` bucket into `other`.
- **No usage or retention signal:** The 5-key ping (`{ installId, version, os, arch, ts }`) cannot answer which lanes are used, whether playback succeeds, whether offline/downloads are used, which install channel users came from, or whether new installs return in week 1–4.
- **Immutable clients:** Shipped v0.3.0 sends 5 keys (64-hex `sha256(installId)`) and treats any 4xx — including `400` and `410` — as `"permanent"` for 24h (`usage-analytics-service.ts:289`). Pre-0.3.0 installs still send raw UUIDs. Both must keep working against `POST /api/ping`.

## Hard constraints

1. **Keystroke-only consent (AGENTS.md hazard #3):** Only an explicit keystroke on the consent screen or in `/settings` / `/analytics` may enable analytics or mint `installId`. No skip (`s`), accept-all (`S`), non-interactive/non-TTY run, `DO_NOT_TRACK`, or `CI` path may enable it, create an id, accumulate local usage counters, or send.
2. **Forbidden data stays forbidden:** Never collect, accept, or store titles, queries, provider IDs, provider results, stream URLs, file paths, raw UUIDs (on new clients), or client IPs.
3. **Pinned endpoint:** `DEFAULT_ANALYTICS_ENDPOINT` stays `https://analytics.kunai.kitsunekode.in/api/ping` (gated by `analytics-endpoint-pin.test.ts`).
4. **Lockstep contract and gates:** Any wire, retention, or suppression change lands with `.docs/analytics-privacy-contract.md`, `docs/users/reliability-and-privacy.mdx`, and `analytics-payload-drift.test.ts` in one PR.
5. **Backward compatibility:** Ingest accepts v1 (5-key) and v2 (10-key) payloads permanently; `/metrics/daily.json` keeps its 8-key `schemaVersion: 2` contract untouched.
6. **Zero first-paint cost:** Analytics never queries SQLite or touches the network before first paint, and never delays CLI exit.

---

## 1. Breakdowns that survive the floor

| Option                                                    | Verdict                          | Reasoning                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Non-overlapping ISO weekly + calendar monthly rollups** | **Adopt (primary)**              | Aggregates distinct `install_hash` over 7d (N≈15–30) and calendar months (N≈35–70) from `ping_day` (35d retention). Clears `SMALL_CELL_FLOOR = 5` and `sealResidual` on `os`, `arch`, `version`, and `channel` without lowering the floor. Non-overlapping periods prevent day-to-day sliding-window differencing.                                            |
| **Coarser version bucketing**                             | **Adopt (prerelease fold only)** | Fold prerelease/build tags (`0.4.0-rc.1+abc` → `0.4.0-pre`) in rollups while keeping `major.minor.patch` so biweekly hotfix adoption stays legible at monthly N≥25. Do **not** publish `major.minor` alongside `major.minor.patch` in the same period: subtracting them leaks sub-floor patch cells.                                                          |
| **Calibrated noise (Differential Privacy / Laplace)**     | **Reject (for now)**             | At DAU=6, `ε = 1.0` adds `Lap(1)` (`σ ≈ 1.41`, 95% interval `±3`), turning `{ linux: 4, darwin: 1, win32: 1 }` into random rankings. Annual composition (`ε_annual ≤ 4`) pushes per-day `σ` to 7–28, destroying signal. Also adds seeded-noise state and harms auditability on a trust surface. Revisit only if Kunai needs high-cardinality cuts at N > 500. |

**Why not daily-stepping 28-day rolling windows?** Publishing `[D-27..D]` and `[D-26..D+1]` daily lets anyone subtract adjacent snapshots to recover single-day changes of size 1. Fixed **closed ISO weeks (Mon–Sun, IST)** and **closed calendar months (`YYYY-MM`, IST)** share zero rows between adjacent periods.

**Rules kept intact:** `SMALL_CELL_FLOOR = 5` and `sealResidual` apply unchanged to every weekly/monthly breakdown. `daily_rollup` and `/metrics/daily.json` continue powering the daily `activeInstalls` / `newInstalls` / `lifetimeInstalls` pulse; per-day breakdown suppression stays on `daily.json` / `series.json` for compatibility, while the public dashboard moves its breakdown charts to weekly/monthly rollups.

---

## 2. Coarse usage counters ("how" Kunai is used)

Add **five fixed, bounded top-level fields** to the wire payload (v2), raising the key count from 5 to 10 while staying under `MAX_BODY_BYTES = 512` (~235 bytes worst case):

| Field          | Type / Closed bounds                                                                    | Answers                                                  | Contract justification                                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `channel`      | Closed enum (8): `npm`, `bun`, `brew`, `scoop`, `binary`, `system`, `source`, `unknown` | Which distribution channels carry active users (W4).     | Maps 1:1 from existing `detectInstallMethod()` (`install-method.ts`); no paths sent. Same sensitivity class as `os`/`arch`.                |
| `lanes`        | Sorted unique array, subset of `["anime", "series", "youtube"]` (0–3 items)             | Which product lanes (`ProviderLane`) are actually used.  | At most 3 bits/period. No titles, queries, or providers. Published only as per-lane marginal distinct-install counts (`floor = 5`).        |
| `playAttempts` | Integer `0..20`                                                                         | How often playback is attempted; denominator for health. | Local counter stops incrementing past 20 per period (unbiased sample, prevents binge fingerprinting and single-ping inflation).            |
| `playSuccess`  | Integer `0..20`, invariant `playSuccess <= playAttempts`                                | Real-world playback reliability across users.            | Published only as aggregate install-level success rate (`>= 5` attempting installs) and capped attempt rate (`>= 20` attempts).            |
| `offlineUsed`  | Boolean                                                                                 | Whether offline playback / downloads see real use.       | 1 bit/period (`offlineAsset` play or download job queued/completed). Published as distinct installs (`floor = 5` + binary `sealResidual`). |

**Timing & local accumulation (critical for avoiding a silent no-op):**

- Kunai pings **once per 24h at startup** (`main.ts:1274`), before the current session plays anything.
- Therefore, v2 counters summarize **completed activity since the previous successful ping** — never the in-flight session. This keeps pings at 1/24h, decouples network timing from watch actions, and never sends on exit.
- Counters are recorded in a 1-row table (`analytics_pending`) in `kunai-data.sqlite` **if and only if `config.analytics === "enabled"`** (and env is not blocked). Disabling analytics or calling `rotateInstallId()` immediately wipes `analytics_pending`.
- A successful (`outcome === "permanent"`) ping clears only the counters snapshotted for that send (preserving any activity recorded while the HTTP request was in flight, matching the completion-fence discipline in `.docs/analytics-privacy-contract.md`).
- **Rollout denominator hygiene:** v1 (v0.3.0) rows store `NULL` (not `0`/`false`) in the new `ping_day` columns. Weekly/monthly rollups record `reporting_installs` (distinct installs that sent v2 fields) so partial-rollout adoption never dilutes usage percentages.

---

## 3. Retention by first-seen cohort week (and month)

**Zero new client fields, zero new identity tables.** `install_lifetime` already stores `(install_hash, first_seen, last_seen)` for 400 days, and `ping_day` stores `(day, install_hash)` for 35 days.

- **Materialization before prune:** At each closed ISO week `W` (Monday cron after Sunday midnight IST), join `ping_day` for week `W` against `install_lifetime.first_seen` to compute `retained_installs` for every cohort week `C` with `week_offset = (W - C) / 7` in `0..12` (13 rows/week, permanent aggregate-only table `cohort_week_retention`).
- **Monthly cohorts too:** At each closed calendar month `M`, materialize `cohort_month_retention` for `month_offset` in `0..6`. At ~16 new installs/week today, weekly cohorts hover near the floor, whereas monthly cohorts (N≈40–70) are immediately publishable.
- **Cohort privacy floor (complementary-cell safe):**
  - Suppress an entire cohort row if `cohort_size < 10`.
  - Inside a qualifying cohort (`cohort_size >= 10`), publish exact `retained_installs` only when `5 <= retained_installs <= cohort_size - 5`. Cells `< 5` or `> cohort_size - 5` serialize as `retained: null, suppressed: true` (rendered as `"< 5"` or `"> N-5"`, never `0%` or `100%`), preventing churn-subtraction leaks.
- **Explicit caveats:** `Rotate install id` and disable→re-enable mint a new UUID, counting as churn in the old cohort and a new install in the later cohort. Retention is therefore an honest **lower bound** on returning installs.

---

## 4. Honest consent copy & neutral recommendation on the setup default

### Copy improvements (no dark patterns)

1. **Single source of truth for payload preview:** Replace the hardcoded 5-key string in `apps/cli/src/app-shell/setup/AnalyticsScreen.tsx` with a formatter driven by `usageAnalytics.describePayload()` (still side-effect free; uses `"<sha256 of a local id>"` when `unset`, never minting an id).
2. **Explain why it helps the user (plainly, without guilt):**
   - Headline: `Help keep Kunai working on your platform`
   - Detail: `One daily startup ping tells us which OS, install channels, and lanes are used — and whether playback actually succeeds. Public results: kunai.kitsunekode.in/analytics`
   - Preview caption: `Exact JSON sent (usage fields summarize prior sessions, capped at 20 plays):`
   - Negative guarantee line (kept verbatim): `Never: titles · queries · providers · URLs · paths · your IP`
   - Reversibility line: `Raw id stays on this machine. Off in /settings or /analytics deletes it and clears local counters.`
3. **Fix existing copy drift:** Update `/analytics` (`apps/cli/src/app-shell/workflows/shell-workflows.ts:1614`, which still says `"Off by default"` despite setup pre-selecting On), Settings (`apps/cli/src/app-shell/settings/registry/privacy.ts:9`), and the one-time upgrader banner (`ink-shell.tsx:530`) to list all 10 fields accurately.

### Setup default (`ANALYTICS_ON_INDEX = 0`) — Maintainer decision required

`AnalyticsScreen.tsx` currently pre-selects `"Turn it on"` with badge `"← recommended"`, while `s` selects off and `S` (accept all) stops on the screen. **This plan does not change that default unilaterally**; the maintainer must choose one option before Phase 3 merges:

| Option                                                                     | Behavior                                                                                 | Trade-off                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Keep "Turn it on" pre-selected, drop `"← recommended"` badge**        | Cursor starts on `"Turn it on"`, Enter confirms; `s` still selects off, `S` still stops. | Preserves opt-in sample size while active base is <200, so weekly cohorts clear floor 5 sooner. Still draws skepticism from privacy-strict CLI users who hit Enter quickly, especially now that coarse usage counters are included.                                                       |
| **B. Default cursor to "Keep it off" (or require un-preselected `y`/`n`)** | Enter leaves analytics off; enabling requires moving cursor or pressing `y`.             | Eliminates dark-pattern critique completely, matches the higher sensitivity of v2 behavioral counters, and resolves the open privacy-review note in `2026-11-24-road-to-9-5.md`. Likely lowers opt-in rate 2–4× until W4 distribution (Homebrew/Scoop/AUR + v0.4.0) grows total installs. |

**Neutral recommendation:** Because v2 expands from passive system metadata (5 keys) to coarse usage behavior (10 keys), **Option B** is the cleaner long-term trust posture — especially once W4 distribution ships. If the maintainer prefers **Option A** during v0.4.x to keep weekly cells above the floor, removing the `"← recommended"` badge and showing the full 10-key JSON above the fold is the minimum honesty bar. Record the decision in `.docs/analytics-privacy-contract.md` before Phase 3.

---

## 5. Public `/analytics` dashboard changes

Updates to `apps/docs/app/analytics/page.tsx` and `apps/docs/components/analytics/`:

1. **Headline KPI row (`SectionCards`):** Replace `"Below the floor: 100%"` with **Active (last closed month)** (distinct installs) alongside **Active (last closed week)**, **Active yesterday**, and **Lifetime installs** (with non-monotonic retirement note). Keep suppression transparency as a subtle footnote per card.
2. **Working breakdowns (`BreakdownSection` + `ShareSection`):** Read from `/metrics/monthly.json` (default) with a **Month / Week** toggle (`/metrics/weekly.json`), showing `byVersion`, `byOs`, `byArch`, and `byChannel`. Display denominator explicitly (`N distinct opted-in installs`; for v2-only fields, `M of N reporting v0.4+`).
3. **New "How Kunai is used" section (v2):**
   - **Lanes:** Horizontal bars for Anime, Movies & TV (`series`), YouTube as `% of reporting installs` (explicitly noting installs can use multiple lanes so percentages need not sum to 100%).
   - **Playback reliability:** Install-level success rate + capped attempt success rate (hidden behind an honest `"below floor"` note until `>= 5` attempting installs and `>= 20` attempts).
   - **Offline / downloads:** `% of reporting installs` using offline/downloads (gated by floor 5 + binary `sealResidual`).
4. **New "Cohort retention" section:** Reads `/metrics/cohorts.json`. Defaults to monthly cohorts when weekly cohorts have `< 10` installs; shows weekly `W0..W12` once weeks clear 10. Suppressed cells show `< 5`, never `0%`.
5. **Independent downloads next to opt-in pulse:** Keep `NpmSection` on its own axis and add a sibling **GitHub Release downloads** card (fetched at ISR time in `apps/docs/lib/analytics-github.ts` from the public Releases API, cached 1h, zero user tracking). Frame both under a concise **"Opt-in pulse vs. independent downloads"** callout explaining self-selection bias: opt-in telemetry is a **lower bound** (excludes opt-outs, non-TTY, CI, `DO_NOT_TRACK`), while download counters are an **upper-ish channel pulse** (includes reinstalls, upgrades, mirrors).
6. **Trust section & `HowToRead`:** Update `PayloadContractCard` to the 10-key v2 JSON (noting v0.3.0's 5-key compatibility), and document weekly/monthly windows, cohort floors, and rotation caveats.

---

## 6. First-paint & exit cost

Measured architecture review of `apps/cli/src/main.ts:1267-1284` and `usage-analytics-service.ts:181-296`:

1. **Keep pre-paint `onSessionStart` purely in-memory:** Only inspect `config.getRaw()` + `env` + `isInteractive` to settle `analyticsDisclosurePending` before Ink mounts (zero SQLite, zero network, `< 1 ms`; the rare `DO_NOT_TRACK` wipe of a stale `enabled` config remains awaited so the id is cleared immediately).
2. **Defer `pingInBackground` strictly past first paint:** Trigger the background ping from a post-mount effect / `setImmediate` after Ink renders frame 1, never before `render(...)`.
3. **Lazy counter read:** Only read `analytics_pending` from `kunai-data.sqlite` inside `maybePing()` **after** passing the 24h cadence and retry-backoff checks — so 95%+ of sessions do **0 extra SQLite reads**.
4. **Reuse `detectedInstall`:** Pass the `InstallMethodKind` already resolved in `apps/cli/src/container/bootstrap-services.ts:499` into `UsageAnalyticsService` (zero extra `realpathSync` or filesystem probes).
5. **Never block exit:** Call `timer.unref?.()` on the `2_500 ms` `AbortController` timeout (`usage-analytics-service.ts:277` currently lacks `.unref()`, which can keep the event loop alive up to 2.5s on quick exit) and abort any in-flight ping on shell unmount.
6. **Guardrail:** Add a unit/startup test asserting `onSessionStart` triggers 0 store reads and 0 fetches before first paint, and a hung 10s fetch adds 0 ms to mount or process exit.

---

## 7. Exact wire payload schema diff (v1 → v2)

```diff
 {
   "installId": "<sha256-hex>",
   "version": "0.4.0",
   "os": "linux",
   "arch": "x64",
-  "ts": 1795478400000
+  "ts": 1795478400000,
+  "channel": "binary",
+  "lanes": ["anime", "series"],
+  "playAttempts": 4,
+  "playSuccess": 4,
+  "offlineUsed": false
 }
```

- **Key-set validation (`apps/analytics-ingest/src/ingest.ts`):** Accept **either** exact v1 5-key set (`["arch","installId","os","ts","version"]`) **or** exact v2 10-key set (`["arch","channel","installId","lanes","offlineUsed","os","playAttempts","playSuccess","ts","version"]`). Reject any partial subset (6–9 keys) or extra key (`>= 11` keys, or 6th key on v1) with `400 invalid_payload`.
- **Field validators (`payload-validation.ts`):**
  - `channel`: closed allowlist `["npm","bun","brew","scoop","binary","system","source","unknown"]`.
  - `lanes`: array of 0–3 unique strings from `["anime","series","youtube"]`, strictly sorted ascending (`lanes[i] > lanes[i-1]`) to reject duplicates/arbitrary order.
  - `playAttempts`, `playSuccess`: safe integers, `0 <= playSuccess <= playAttempts <= 20`.
  - `offlineUsed`: strict `typeof === "boolean"`.
- **Body limit:** Keep `MAX_BODY_BYTES = 512` unchanged (worst-case v2 JSON is ~235 bytes).

---

## 8. Ingest schema migration, endpoints & retention

**New idempotent migration `apps/analytics-ingest/sql/004_credible_usage.sql`:**

1. **`ping_day` (raw, 35-day retention unchanged):** Add nullable typed columns with `CHECK` constraints (keeping `extra jsonb` empty):
   - `channel text check (channel in ('npm','bun','brew','scoop','binary','system','source','unknown'))`
   - `used_anime boolean`, `used_series boolean`, `used_youtube boolean`
   - `play_attempts smallint check (play_attempts between 0 and 20)`
   - `play_success smallint check (play_success between 0 and play_attempts)`
   - `offline_used boolean`
   - Add covering index `ping_day_day_v2_idx on ping_day (day, install_hash, channel)` for weekly/monthly distinct aggregation.
2. **Permanent aggregate-only tables (no identity, never pruned):**
   - `weekly_rollup (week_start date primary key, active_installs int, new_installs int, reporting_installs int, by_version jsonb, by_os jsonb, by_arch jsonb, by_channel jsonb, lane_installs jsonb, play_attempting_installs int, play_succeeding_installs int, play_attempts_sum int, play_success_sum int, offline_installs int, computed_at timestamptz)`
   - `monthly_rollup (month_start date primary key, ...same aggregate columns...)`
   - **Per-install rollup semantics:** Dimension counts (`by_version`, `by_os`, `by_arch`, and `by_channel` over non-null v2 rows) take each install's latest ping in the period (`DISTINCT ON (install_hash) ORDER BY install_hash, day DESC`) so every breakdown sums cleanly to its denominator (`active_installs` or `reporting_installs`). Boolean usage metrics (`lane_installs`, `offline_installs`) take `bool_or(...)` per `install_hash` across the period and apply complementary binary suppression (`5 <= count <= reporting_installs - 5`). `play_attempting_installs` / `play_succeeding_installs` count installs with `sum(play_attempts) > 0` / `sum(play_success) > 0`.
   - `cohort_week_retention (cohort_week date, week_offset smallint check (week_offset between 0 and 12), cohort_size int, retained_installs int, computed_at timestamptz, primary key (cohort_week, week_offset))`
   - `cohort_month_retention (cohort_month date, month_offset smallint check (month_offset between 0 and 6), cohort_size int, retained_installs int, computed_at timestamptz, primary key (cohort_month, month_offset))`
3. **Retention unchanged:** `ping_day` + `ingest_budget` stay **35 days**; `install_lifetime` stays **400 days** (`lifetime_retired` permanent). No new pseudonymous tables.
4. **Cron (`/api/cron/snapshot`):** Continues running daily at `0 19 * * *`. After `rollUpDay`:
   - On Mondays (or backfill of missed closed ISO weeks inside the 35d raw window, capped at 4 weeks/run), materialize `weekly_rollup` + `cohort_week_retention` (`week_offset 0..12`).
   - On the 1st of each IST month (or missed closed month inside 35d raw window), materialize `monthly_rollup` + `cohort_month_retention` (`month_offset 0..6`).
   - Prune runs strictly **after** weekly/monthly/cohort rollups commit, preserving the existing separate-transaction `deferred` reporting contract.
5. **New public read endpoints (`vercel.json` rewrites + same `PUBLIC_METRICS_CACHE_CONTROL`):**
   - `GET /metrics/weekly.json` (`schemaVersion: 1`, last 26 closed weeks, per-period small-cell suppression + `sealResidual`)
   - `GET /metrics/monthly.json` (`schemaVersion: 1`, last 12 closed months, same suppression rules)
   - `GET /metrics/cohorts.json` (`schemaVersion: 1`, weekly + monthly cohort matrices with `cohort_size >= 10` and `5 <= retained <= cohort_size - 5` cell guards)
   - `GET /metrics/daily.json` and `GET /metrics/series.json` remain **unchanged** (`schemaVersion: 2`).

---

## 9. Contract-doc & gate/test changes

Land together in Phase 1 (ingest/rollup clauses) and Phase 3 (wire payload + CLI consent clauses):

- **`.docs/analytics-privacy-contract.md` & `docs/users/reliability-and-privacy.mdx`:**
  - Document the 10-key v2 wire payload alongside permanent v1 (5-key) ingest support, local `analytics_pending` storage (enabled-only, cleared on disable/rotate), and prior-period startup reporting.
  - Document non-overlapping weekly/monthly rollups, `cohort_week_retention` / `cohort_month_retention` (`cohort_size >= 10`, complementary cell guard `5 <= retained <= cohort_size - 5`), and GitHub release downloads alongside npm.
  - Record the maintainer's Phase 0 decision on the setup default.
- **`apps/cli/test/unit/architecture/analytics-payload-drift.test.ts`:**
  - Update `ANALYTICS_PAYLOAD_KEYS` length assertion from `5` to `10` and `sample: AnalyticsPayload` to all 10 keys.
  - Keep checking that both contract and user doc name every key in `ANALYTICS_PAYLOAD_KEYS`, keystroke-only consent, floor of 5 without joint anonymity, reversible Settings control, id deletion on disable, and IST cutover.
  - Add assertions that both docs state local usage counters clear on disable/rotate and that weekly/monthly + cohort floors are documented.
- **`apps/cli/test/unit/architecture/analytics-disclosure-once.test.ts`:**
  - Keep all 5 existing assertions; add assertions that `AnalyticsScreen.tsx` renders its preview via `describePayload()` / shared payload formatter (never a hardcoded key list) and that `analytics_pending` writes are gated on `analytics === "enabled"`.
- **`apps/cli/test/unit/architecture/analytics-endpoint-pin.test.ts`:** Unchanged — remains green.
- **Additional test suites:**
  - `apps/analytics-ingest/test/`: v1+v2 `payload-validation` & `ingest` tests (rejecting 6–9 and 11+ keys), `weekly-monthly-rollup.test.ts` (including `NULL` denominator isolation for v1 pings), `cohort-retention.test.ts` (including `cohort_size < 10` and complementary-cell `cohort_size - retained < 5` suppression), and real-Postgres `test:pg` lifecycle coverage for `004_credible_usage.sql`.
  - `apps/cli/test/unit/`: `UsageAnalyticsService` counter accumulation/cap-at-20/fence-on-send/clear-on-disable-and-rotate, zero pre-paint reads/fetches, and `.unref()` exit-safety test.
  - `apps/docs/test/`: parser & UI tests for weekly/monthly/cohort views, GitHub downloads (`analytics-github.test.ts`), and `analytics-clarity.test.tsx` updates.

---

## 10. Rollout order across releases

Deployment order is a **hard constraint** because published CLI binaries are immutable and v0.3.0 treats `400`/`410` as permanent for 24h:

1. **Phase 0 — Maintainer sign-off:** Decide consent-screen default (Section 4 Option A vs Option B).
2. **Phase 1 — Ingest deploy FIRST (`apps/analytics-ingest`, independent of CLI):**
   - Run `004_credible_usage.sql` against Neon; deploy ingest accepting v1 (5-key) + v2 (10-key) pings and serving `/metrics/{weekly,monthly,cohorts}.json`.
   - Backfill the last 4 closed ISO weeks + last closed month + cohorts immediately from existing `ping_day` + `install_lifetime`. **OS, arch, version, and cohort retention become readable immediately from existing v0.3.0 traffic.**
3. **Phase 2 — Docs `/analytics` deploy (`apps/docs`, independent of CLI):**
   - Ship weekly/monthly breakdowns, cohort table, GitHub release downloads alongside npm, and opt-in vs. download caveats. Usage cards render conditionally once v2 `reporting_installs >= 5`.
4. **Phase 3 — CLI release (`v0.4.0` or `v0.4.1`, single atomic PR with contract + gates):**
   - Ship v2 10-key payload, `analytics_pending` SQLite store, post-first-paint deferred send + `.unref()`, dynamic `AnalyticsScreen.tsx` preview + copy fixes, updated contract/user docs, and updated drift/disclosure gates.
5. **Phase 4 — Verification:** Run `bun run test:live:analytics` against local disposable Postgres verifying v1 5-key (`204`), v2 10-key (`204`), and 6-key / 11-key extra-field probes (`400`); verify first prod Monday cron populates `weekly_rollup` and `cohort_week_retention` with empty `deferred`.

---

## 11. Dropped as not worth the privacy cost

| Candidate signal                                                               | Why dropped                                                                                                                                                |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Provider IDs** (`allmanga`, `miruro`, `vidrock`, …)                          | Explicitly forbidden by contract; reveals which third-party host a user contacted. Provider health belongs in synthetic sweeps (W1), never user telemetry. |
| **Error codes, stack traces, failure messages**                                | High risk of leaking URLs, paths, or titles; unbounded cardinality. Diagnostics stay strictly local until explicit `/export-diagnostics`.                  |
| **Session duration, watch minutes, episode counts, hour-of-day**               | Behavioral viewing profile; high fingerprinting risk with little engineering payoff beyond `lanes` + capped `playAttempts`/`playSuccess`.                  |
| **Tracker/presence posture** (AniList, TMDB OAuth, Discord RPC)                | Reveals linked third-party accounts; erodes trust for low product value.                                                                                   |
| **Terminal emulator / graphics protocol** (`kitty`, `iterm2`, `sixel`, `tmux`) | High-entropy fingerprint when combined with `os`/`arch`/`channel`.                                                                                         |
| **Country, timezone, locale, audio/sub language**                              | Geolocation/identity proxy in a small user base.                                                                                                           |
| **Relay URL, Stremio addons, custom TMDB key flags**                           | Sensitive user infrastructure posture; stays local.                                                                                                        |
| **Per-event / playback-triggered / exit pings**                                | Breaks the 1/24h contract, correlates network timing with watching, and risks slowing exit.                                                                |
