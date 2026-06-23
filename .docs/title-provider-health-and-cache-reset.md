# Title provider health, cache layers, and reset

Why a provider can feel “dead” even when another recovers, and what to reset / override.

---

## 1. Three different memory layers (easy to confuse)

| Layer                         | Storage                             | What it remembers                                             | Effect on next play                                                                                                         |
| ----------------------------- | ----------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **A. Stream URL cache**       | `cacheStore` (resolve cache keys)   | Last working m3u8 URL per title/episode/provider              | May replay **stale/dead** URL until invalidated                                                                             |
| **B. Global provider health** | `provider_health` in cache DB       | `healthy` / `degraded` / **`down`** (5+ consecutive failures) | Effective **`down`** providers are **skipped** in auto-fallback until TTL heal or manual reset                              |
| **C. Title-scoped health**    | `title_provider_health` in cache DB | “On _this show_, provider X failed; provider Y worked”        | **Advisory only** — playback notes / Sources UI may suggest another provider; resolve order stays on your selected provider |

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

- **Provider picker** — health badge per provider (`down`, `degraded`, failure count, skipped note)
- **Runtime health line** — merges resolve telemetry with persisted memory for the active provider
- **Diagnostics panel** — **Provider memory** section lists lane providers with effective status and fallback eligibility
- **Resolve feedback** — when providers are skipped: `Miruro (down) skipped in auto-fallback — /reset-provider-health to retry`

---

## 3. Title health behavior (layer C)

### 3.1 Advisory only — no silent reorder

`titleScopedProviderOrder` keeps the user’s **selected provider first**. When title health has a `suggestedProviderId`, resolve does **not** prepend it; playback notes / Sources UI may show an advisory (“last time Rivestream worked on this title”).

`ignoreTitleHealthSuggestion` on resolve input suppresses that advisory for one attempt.

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

- It is still attempted as **primary** when selected.
- It is **omitted** from extra fallbacks in the resolve loop.
- Title health (layer C) remains advisory and does not override that skip.

---

## 4. Weird behaviors checklist

| Symptom                                         | Likely cause                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| Note says try Rivestream but VidKing still runs | **C** is advisory only; check global **B** `down` or provider priority order |
| Clear cache didn’t help                         | Only layer **A** cleared; use `/reset-provider-health` for **B/C**           |
| Provider never in fallback list                 | Global health **B** effective `down` (or recently failed)                    |
| Same bad stream again                           | Stale **A** until dead-stream invalidation or `preferFreshStream`            |
| “Struggled with this title” note every episode  | **C** still has `suggestedProviderId` until expiry or clean successes        |
| Parse failures stick a week                     | **C** `severeUntil` / 7d retention for `parse`                               |
| Down provider works again after hours           | TTL auto-heal on layer **B** (8h to full eligibility)                        |

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
| `provider-health-reset.ts`                      | Scoped reset picker + apply                          |
| `TitleProviderHealthService.ts`                 | Suggestion + retention                               |
| `ProviderCandidatePlanner.ts`                   | Skips effective-`down` fallbacks                     |
| `PlaybackResolveService.ts`                     | Cache, health persistence, skipped-fallback feedback |
| `workflows.ts` `handleClearCache`               | Layer A vs B/C wizard                                |
| `packages/storage/.../provider-health.ts`       | SQLite persistence (`list`, `delete`)                |
| `packages/storage/.../title-provider-health.ts` | SQLite persistence                                   |
