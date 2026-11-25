# Plan: Credible, Less Invasive Usage Numbers

## Status

- **Status:** ACCEPTED in part (2026-11-25): decisions 1 and 3 are made, so Phases 1 and 2 may
  start. Decisions 2 and 4 are still open.
- **Date:** 2026-11-24, rewritten 2026-11-25 after the maintainer asked for analytics that are
  less invasive yet still give exact, publishable numbers (downloads, updates, installs, active
  users, Android included).
- **Extends:** [usage-analytics-redesign.md](./usage-analytics-redesign.md) and
  [2026-08-26-analytics-series-and-social-cards.md](./2026-08-26-analytics-series-and-social-cards.md).
  It does not reopen [2026-09-11-analytics-ist-day-boundary.md](./2026-09-11-analytics-ist-day-boundary.md).
- **Maintainer decisions:** recorded in Section 8.

## Problem

The maintainer wants numbers that are **real** (good enough to put on a project page),
**predictable** (they mean the same thing every day), and **less invasive** than today.

Today:

- **Baseline:** 69 first-seen installs in 30 days; 2–10 active installs a day (median 6).
  `SMALL_CELL_FLOOR = 5` folds almost every version/OS/arch bucket into `other`.
- **Linkable over time.** The wire id is a fixed `sha256(installId)`, so one install can be
  followed day after day. `install_lifetime` keeps a durable first/last-seen row per install.
- **`lifetimeInstalls` is unreliable by its own contract:** it can fall, and it counts a
  returning install twice.
- **Android is invisible.** The client sends raw `process.platform`, and the ingest allows
  only `linux`, `darwin`, `win32` (`payload-validation.ts:17`). An Android build that reports
  `android` is rejected with 400 (and v0.3.0 then backs off 24h). One that reports `linux` is
  counted as Linux. Either way Android does not show up.
- **No distribution numbers at all**, even though GitHub and npm already count downloads
  without anyone sending us anything.
- **The consent screen pre-selects "on"** (`ANALYTICS_ON_INDEX = 0`). It needs a keystroke,
  but it nudges.

## Hard constraints (unchanged)

1. **Keystroke-only consent** (AGENTS.md hazard #3). No skip, accept-all, non-TTY, `CI` or
   `DO_NOT_TRACK` path may enable analytics, create an id or send.
2. **Forbidden data stays forbidden:** titles, queries, providers, URLs, file paths, raw
   UUIDs, client IPs.
3. **Pinned endpoint** `https://analytics.kunai.kitsunekode.in/api/ping`.
4. **Lockstep:** `.docs/analytics-privacy-contract.md`, `docs/users/reliability-and-privacy.mdx`
   and `analytics-payload-drift.test.ts` change in the same PR as any wire or retention change.
5. **Old clients keep working.** v0.3.0 sends a 64-hex digest; older builds send a UUID; both
   treat any 4xx as permanent for 24h. The ingest must accept every new shape **before** a
   client ships it.
6. **Zero first-paint and exit cost.**

---

## The three tiers of numbers

| Tier              | What it counts                                                     | Needs consent?         | Exact?                             | Source                     |
| ----------------- | ------------------------------------------------------------------ | ---------------------- | ---------------------------------- | -------------------------- |
| A. Distribution   | Downloads, installs and updates, per platform including Android    | No: we collect nothing | Exact counts of downloads          | GitHub release assets, npm |
| B. Active use     | Unique active installs per day/week/month, new installs, retention | Yes, opt-in            | Exact **among those who opted in** | Opt-in ping, redesigned    |
| C. Public numbers | Badges and the `/analytics` page                                   | —                      | Labelled honestly                  | A + B                      |

Tier A is the big win: it is the "how many people use this" number most projects publish, it is
exact, and it costs users nothing.

---

## 1. Tier A: distribution counts (no client data)

**GitHub release assets.** Every binary install or update downloads a release asset from
`github.com/KitsuneKode/kunai/releases/download/…`. That covers `install.sh`, `install.ps1`,
the native auto-updater, and the Homebrew tap, Scoop bucket and AUR package, which all pull the
same assets. GitHub keeps a cumulative `download_count` per asset. Per release and per platform
(`kunai-linux-*`, `kunai-darwin-*`, `kunai-windows-*`, `kunai-android-arm64/x64`) that gives an
exact download count, and Android comes for free.

**npm.** `api.npmjs.org/downloads/range/<period>/<pkg>` gives daily downloads for
`@kitsunekode/kunai` and each platform package, including `@kitsunekode/kunai-android-*`.

**Installs versus updates.** A plain asset count mixes the two. To split them without any
identifier, add two tiny marker assets to every release: `install.marker`, fetched once by
`install.sh`/`install.ps1` on a fresh install, and `update.marker`, fetched once by the native
updater after a verified update. GitHub only counts them; nothing about the user is sent to us.
GitHub already sees these requests, because it serves the binary itself. _Decision 3._

**Implementation.**

- A daily cron in `apps/analytics-ingest` reads the GitHub Releases API and the npm downloads
  API with no client data involved.
- It stores aggregate snapshots in a new `distribution_daily(day, source, release, platform,
  cumulative)` table. Daily deltas come from consecutive cumulative snapshots.
- It publishes them as `/metrics/distribution.json`.
- Never scrape; use the documented APIs with a token scoped to public data. GitHub counts are
  cumulative from the first snapshot, so earlier history is one opening total.

**What it can't tell us:** whether a download was then run, and CI or mirror re-downloads. Say
so on the page: "downloads", not "users".

## 2. Tier B: the opt-in ping, redesigned to be less invasive

The aim: the server can no longer follow an install across months, and keeps no lasting
per-install record. Every count stays exact.

| Change                                                                                                                                                                       | Keeps                                                                                                              | Makes impossible                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| The wire id becomes `HMAC-SHA256(localSecret, "YYYY-MM")` and rotates every calendar month. `localSecret` is the existing local `installId`, which never leaves the machine. | Exact daily, month-aligned weekly and monthly unique actives                                                       | Linking one install from one month to the next       |
| The client sends `cohort: "YYYY-MM"`, the month analytics was enabled, stored locally and cleared on disable                                                                 | Exact new installs per month, exact cohort retention (M0…M6), a lifetime total that only goes up (Σ new per month) | Nothing new: the server could already see first-seen |
| `ts` is replaced by the client's local day label; the ingest checks it against its own clock (±1 day)                                                                        | Replay and skew protection                                                                                         | A precise client clock signature                     |
| `os` is sent as `android` when `isAndroidRuntime()` is true, and the ingest accepts it                                                                                       | Android active installs                                                                                            | Android hidden inside Linux                          |
| `install_lifetime` and `lifetime_retired` are dropped. `ping_day` keeps 35 days, as now                                                                                      | All published numbers (rebuilt from the cohort sums)                                                               | A durable per-install record                         |

**Weeks are month-aligned** (days 1–7, 8–14, 15–21, 22–28, 29–end). That keeps a weekly id
from bridging two months, which would let the two monthly ids be linked.

**Payload v2:** `{ id, cohort, day, version, os, arch }`. That's six keys, under the 512-byte
cap. Usage fields (Section 4) are optional extra keys, behind Decision 2.

**Re-enabling after a disable** clears `localSecret` and `cohort`, so it counts as a new
install, as it does today.

**Upgrade seam:** installs that upgrade are counted again once, in their upgrade month, because
no link to their old id is kept. This was accepted at `lifetimeInstalls = 2` for 0.3.0, and it
is cheap at today's numbers. Document it as a dated seam, not a fault.

## 3. Honest consent

- The setup screen gets **no pre-selection**. Both "Share anonymous usage" and "Don't share"
  need a keystroke. Copy is generated from `describePayload()`, so it can't drift from the
  wire. _Decision 1._
- `kunai analytics log` prints the last 50 pings exactly as sent, from a local file kept only
  while enabled and cleared on disable. Users can verify the claim instead of trusting it.
- `kunai analytics preview` prints the payload the next ping would send.

## 4. Coarse usage counters (optional, Decision 2)

These are only accumulated locally while enabled, cleared on disable, and sent as buckets,
never exact counts, once per month-aligned week:

- `lanes`: which of anime / series / movies / youtube were used, as a bitmask
- `plays`: `0`, `1-5`, `6-20`, `21+`
- `playOk`: the share of plays that reached a decoded frame, as `<50%`, `50-90%`, `>90%`
- `offline`: whether downloads were used, a boolean
- `channel`: the install method from the install manifest (`binary`, `npm`, `brew`, `scoop`,
  `aur`, `source`)

The existing 5-install floor applies to every published cell. Per-day publication of these is
dropped: weekly only.

## 5. Public numbers and badges (Tier C)

- **`/analytics` page:** distribution first (downloads per release and per platform, installs
  versus updates), then opt-in activity (weekly/monthly unique active installs, new installs,
  cohort retention), each with a one-line definition.
- **Badge endpoints** in shields.io endpoint format, on the existing ingest:
  - `/badges/downloads.json`: "downloads 12.3k"
  - `/badges/active.json`: "active (opted in, 30d) 140"
  - `/badges/installs.json`: "installs 2.1k", when the markers exist
    These go in the README and on project pages.
- **Never extrapolate** opt-in counts to "total users" on the page. If an estimate is wanted,
  show it separately as "est." with the method: active opt-in pings ÷ (update.marker
  downloads of the current release / its age).
- The small-cell floor and the window-wide suppression stay as they are.

## 6. Android specifics

- **Tier A:** `kunai-android-arm64/x64` assets plus the `@kitsunekode/kunai-android-*` npm
  packages, as their own row.
- **Tier B:** the `os: "android"` fix (client and ingest), with a test that an Android runtime
  sends `android`.
- **The mobile app (`apps/mobile`):** keep it out of scope until it ships through a store. If
  it does, store install counts (Play Console) are Tier A data with no client code.

## 7. Rollout order

1. **Ingest first:** accept v2 payloads, `os: android`, and the `day` field. Add the
   distribution cron, the `distribution_daily` table and the badge endpoints. Keep v1 working
   forever.
2. **Release N:** client v2 (rotating id, cohort, day, Android `os`), neutral consent screen,
   `analytics log` and `preview`. Add marker assets to the release workflow and the
   installers/updater (Decision 3).
3. **Release N+1:** the usage buckets, if Decision 2 is yes.
4. **After the v2 share passes about 80% of actives:** drop `install_lifetime` and
   `lifetime_retired` reads from the published numbers. The tables keep serving v1 pings until
   those pings stop.

**Gates and docs:**

- Update `analytics-payload-drift` with the v2 keys and the allowed OS list.
- Add a test that no monthly id is derivable from another month's.
- Add a test that `cohort` is cleared on disable.
- Update the contract doc and the user privacy page in the same PRs.

## 8. Decisions

1. **Consent default: DECIDED 2026-11-25, neutral.** There is no pre-selection; both choices
   need a keystroke.
2. **Usage buckets (Section 4): OPEN.** Ship nothing from Section 4 until this is decided.
3. **Install/update marker assets: DECIDED 2026-11-25, yes.** Release N adds `install.marker`
   and `update.marker`.
4. **Badge wording: OPEN.** The default until decided is "active (opted in, 30d)".

## 9. Dropped, as not worth the privacy cost

- Per-install history beyond the current month.
- Exact play counts, titles and providers, of any kind.
- Daily-stepping rolling windows (differencing risk).
- Laplace noise at the current N: it destroys the signal without adding real protection
  over the floor.
- IP-based uniqueness or geography.
