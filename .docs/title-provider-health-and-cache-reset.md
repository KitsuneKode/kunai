---
status: current
lastReviewed: "2026-11-27"
---

# Title provider health, cache layers, and reset

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Why a provider can feel “dead” even when another recovers, and what to reset / override.

---

## 1. Three different memory layers (easy to confuse)

| Layer                         | Storage                             | What it remembers                                             | Effect on next play                                                                                                                                                                       |
| ----------------------------- | ----------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Stream URL cache**       | `cacheStore` (resolve cache keys)   | Last working m3u8 URL per title/episode/provider              | May replay **stale/dead** URL until invalidated                                                                                                                                           |
| **B. Global provider health** | `provider_health` in cache DB       | `healthy` / `degraded` / **`down`** (5+ consecutive failures) | Effective **`down`** providers are **skipped** in auto-fallback until TTL heal or manual reset                                                                                            |
| **C. Title-scoped health**    | `title_provider_health` in cache DB | “On _this show_, provider X failed; provider Y worked”        | Orders the resolve in guided and fallback-first modes: the provider that worked starts, your selected provider follows; never for a provider you just chose, `/recompute`, or manual mode |

Recovery invalidation uses the same provider manifest as resolve-cache writes,
including each provider's key parts and the active source/stream selection. It
removes the base and selected keys for that episode while preserving unrelated
entries. The production-roster regression pins this for every provider.
Episode/title purge actions hydrate the saved episode override and title default
before computing those selected keys. Title purges keep provider-native episode
identities distinct even when their displayed season/episode numbers match.
Purging cache entries preserves the saved preferences themselves. Quarantine is
applied to each selection layer before merging: an unavailable episode override
falls back to a healthy title default, without carrying its old quality pin.

Caller cancellation produces no global provider-health observation. A total
resolve deadline may retain failure deltas already returned by attempts: a
provider timeout is evidence, unlike a user navigating away. The shared work
service forwards the final consumer's cancellation reason; an earlier consumer
leaving does not abort work still needed by another consumer.

`/clear-cache` now separates **layer A** from **layers B/C**. Use **Reset provider health** (`/reset-provider-health`) for scoped failure-memory clears without touching stream URLs.

---

## 2. Global provider health (layer B)

### 2.1 Auto-fallback skip policy

When building the fallback candidate list, providers with **effective** status `down` are omitted. Your **selected primary** provider is still attempted first.

Manual escape hatches:

- `/reset-provider-health` — scoped clear of layers B and/or C
- `/recompute` — sets `ignoreProviderHealth: true` for one resolve attempt

### 2.2 TTL auto-heal (read-time, no migration)

Effective status is computed from stored status + age since `checkedAt`:

| Stored status | Effective after TTL                             |
| ------------- | ----------------------------------------------- |
| `degraded`    | `healthy` after **1h**                          |
| `down`        | `degraded` after **4h**, `healthy` after **8h** |

Background prune default: **7 days** (`providerHealthRetentionDays`). Title-scoped normal retention: **12h** (severe/parse stays **7d**).

### 2.3 Visibility

- **Provider picker** — every row states where the provider stands; see §2.4
- **Runtime health line** — merges resolve traces with persisted memory for the active provider
- **Diagnostics panel** — **Provider memory** section lists lane providers with effective status and fallback eligibility
- **Resolve feedback** — when providers are skipped: `Miruro (down) skipped in auto-fallback — /reset-provider-health to retry`

### 2.4 What the provider picker says, and from what

`resolveProviderPickerStatus` (`apps/cli/src/app-shell/provider-picker-status.ts`)
turns evidence into a row state: a tone, a badge, and a one-line explanation.
No provider is named in UI code: a row reads broken only because a store
recorded a failure or its manifest declared a fault. `providerPickerSources`
(`apps/cli/src/app-shell/overlay-provider-picker.ts`) is the one place the
evidence is read.

| State (tone)          | Row badge                                              | Evidence                                                                                                                     |
| --------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| healthy (success)     | `healthy · 6m ago`                                     | Layer B: the last resolve succeeded and nothing below applies                                                                |
| failing (warning)     | `degraded · 3 failures · 5m ago`, `1 failure · 6m ago` | Layer B is `degraded`, or holds a failure streak the store still calls `healthy` (one failure does)                          |
| failing (warning)     | `failing on this title`, `2 endpoints quarantined`     | Layer C has a live streak for the title in hand; or `ProviderEndpointHealthService.countQuarantinedByProvider` is above zero |
| down (error)          | `down · 5 failures · 12m ago`                          | Layer B is effectively `down`; the detail leads with `skipped in auto-fallback`, except on the provider in use               |
| known issue (error)   | `known issue · 2026-11-27`                             | The manifest's `knownIssue`, when no local resolve has succeeded; the detail leads with its summary                          |
| not checked (neutral) | `not checked yet`, `not rechecked · failed 9h ago`     | No row at all; or a failure that TTL healing aged out, which lifts it out of fallback's way and is not a success             |

Rules that are easy to break:

- **Local success outranks the manifest.** A published binary cannot learn that
  an upstream recovered, so `knownIssue` is shown as a dated claim and only
  while this device has no successful resolve. A live local failure is reported
  first, with the claim as context.
- **The picker never re-sorts.** Rows keep the configured priority order; a down
  provider stays where the user put it and stays selectable. Fallback order is
  `ProviderCandidatePlanner`'s business and reads none of this.
- **The state is words, in the badge.** The badge is reserved before the row is
  truncated and reads the same under `NO_COLOR` and in plain mode. Below 72
  columns it shrinks to one or two words (`down`, `not checked`).
- **One footer.** The count is the context strip's. The footer's text line is
  the highlighted row's state as a sentence, and its chips are every key the
  picker answers to. A chip the row has no room for is named at the start of
  the text line, so no key goes unadvertised at any width.
- **The other entry point draws no badge.** The picker offered while a stream is
  resolving (`openProviderPicker`) is a list shell with a label and a detail, so
  `providerOptionsForListShell` moves the state to the front of the detail.

---

## 3. Title health behavior (layer C)

### 3.1 The provider that worked starts, visibly

`planProviderCandidates` (`apps/cli/src/services/playback/ProviderCandidatePlanner.ts`)
puts a title's `suggestedProviderId` first when the suggestion is about the
selected provider and the suggested one is an eligible fallback here; the
selected provider follows it, then the rest by health and priority. The loading
line says so (`orderNote`: "Trying Rivestream first: it worked for this title
before."), so the reorder is never silent.

It does not apply when the user just chose the provider (a switch), on
`/recompute`, or in manual mode: `keepPrimaryFirst` (from
`resolvePlaybackResolvePolicy`) keeps the selected provider first, and
`ignoreTitleHealthSuggestion` drops the suggestion entirely for provider-only
requests.

### 3.2 When the record is written

Title health is updated when:

- Resolve fails on primary and fallback succeeds elsewhere (`recordFailure` + `successfulFallbackProviderId`).
- Playback ends with **suspected dead stream** (`dead-stream` on that provider for that title).

Threshold for suggestion (from `TitleProviderHealthService`):

- `consecutiveFailures >= 2` and at least one successful fallback, **or**
- `failureCount >= 3` and at least one successful fallback.

Retention: **12h** normal, **7d** for `parse` class (`severeUntil`).

### 3.3 `recoveryMode: "manual"`

If config `recoveryMode` is **`manual`**, order is **only** `[primaryProviderId]` — title suggestion is ignored. Most users run **`guided`** (default).

### 3.4 Global `down` vs title health

If a provider is **`down`** globally (layer B):

- As the selected provider it is tried **last**, not first, with a loading note
  ("VidKing is down (3 failures), so it is tried last."). It is still tried, so
  a recovered provider is noticed; health heals by TTL.
- A provider the user just chose (`keepPrimaryFirst`) leads even when `down`.
- As a fallback it is **omitted** from the resolve loop.
- A title suggestion never re-admits a `down` fallback.

---

## 4. Weird behaviors checklist

| Symptom                                               | Likely cause                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| VidKing still runs before Rivestream despite the note | You just switched to VidKing, used `/recompute`, or are in manual mode (`keepPrimaryFirst`) |
| Clear cache didn’t help                               | Only layer **A** cleared; use `/reset-provider-health` for **B/C**                          |
| Provider never in fallback list                       | Global health **B** effective `down` (or recently failed)                                   |
| Same bad stream again                                 | Stale **A** until dead-stream invalidation or `preferFreshStream`                           |
| “Struggled with this title” note every episode        | **C** still has `suggestedProviderId` until expiry or clean successes                       |
| Parse failures stick a week                           | **C** `severeUntil` / 7d retention for `parse`                                              |
| Down provider works again after hours                 | TTL auto-heal on layer **B** (8h to full eligibility)                                       |

---

## 5. Reset: what to clear

### 5.1 In-app commands

```text
/clear-cache
  → Purge episode/title stream cache (layer A)
  → Clear entire stream cache (layer A)
  → Reset provider health memory… (opens scoped picker — layers B/C)
  → Clear stream cache + all provider memory (layers A + B + C)

/reset-provider-health  (aliases: clear-provider-memory, forget-provider-failures)
  → Current provider global health (layer B)
  → Current title memory (layer C)
  → Current title + one provider (layer C)
  → All anime / all series provider health (layer B)
  → All provider memory (layers B + C)
```

### 5.2 Manual DB reset (cache sqlite)

Typical path: OS cache dir `kunai-cache.sqlite` (see diagnostics / config).

```sql
-- Title-scoped health (layer C)
DELETE FROM title_provider_health;

-- Global provider health (layer B)
DELETE FROM provider_health;
```

Stream keys are in the JSON/file cache store cleared by `/clear-cache` stream options, not necessarily these tables.

---

## 6. Related files

| File                                            | Role                                                 |
| ----------------------------------------------- | ---------------------------------------------------- |
| `provider-health-policy.ts`                     | Effective status TTL, fallback eligibility, badges   |
| `app-shell/provider-picker-status.ts`           | Evidence → picker row state (§2.4)                   |
| `app-shell/overlay-provider-picker.ts`          | Picker evidence readers and footer                   |
| `provider-health-reset.ts`                      | Scoped reset picker + apply                          |
| `TitleProviderHealthService.ts`                 | Suggestion + retention                               |
| `ProviderCandidatePlanner.ts`                   | Skips effective-`down` fallbacks                     |
| `PlaybackResolveService.ts`                     | Cache, health persistence, skipped-fallback feedback |
| `workflows.ts` `handleClearCache`               | Layer A vs B/C wizard                                |
| `packages/storage/.../provider-health.ts`       | SQLite persistence (`list`, `delete`)                |
| `packages/storage/.../title-provider-health.ts` | SQLite persistence                                   |
