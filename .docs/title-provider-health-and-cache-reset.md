# Title provider health, cache layers, and reset

Why VidKing can feel “dead” even when Videasy recovers, and what to reset / override.

---

## 1. Three different “health” layers (easy to confuse)

| Layer                         | Storage                             | What it remembers                                         | Effect on next play                                                                   |
| ----------------------------- | ----------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **A. Stream URL cache**       | `cacheStore` (resolve cache keys)   | Last working m3u8 URL per title/episode/provider          | May replay **stale/dead** URL until invalidated                                       |
| **B. Global provider health** | `provider_health` in cache DB       | VidKing `healthy` / `degraded` / **`down`** (5+ failures) | Provider with `down` is **skipped** when building fallback list                       |
| **C. Title-scoped health**    | `title_provider_health` in cache DB | “On _this show_, VidKing failed; Rivestream worked”       | **Reorders resolve**: tries **suggested provider first**, then your selected provider |

Clear cache (`/clear-cache`) today only clears **layer A**. It does **not** clear B or C — that’s why “I cleared cache but it still won’t try VidKing” happens.

---

## 2. Title health behavior (2026-05-27)

### 2.1 Advisory only — no silent reorder

`titleScopedProviderOrder` keeps the user’s **selected provider first**. When title health has a `suggestedProviderId`, resolve does **not** prepend it; playback notes / Sources UI may show an advisory (“last time Rivestream worked on this title”).

`ignoreTitleHealthSuggestion` on resolve input suppresses that advisory for one attempt.

### 2.2 When the record is written

Title health is updated when:

- Resolve fails on primary and fallback succeeds elsewhere (`recordFailure` + `successfulFallbackProviderId`).
- Playback ends with **suspected dead stream** (`dead-stream` on that provider for that title).

Threshold for suggestion (from `TitleProviderHealthService`):

- `consecutiveFailures >= 2` and at least one successful fallback, **or**
- `failureCount >= 3` and at least one successful fallback.

Retention: **24h** normal, **7d** for `parse` class (`severeUntil`).

### 2.3 `recoveryMode: "manual"`

If config `recoveryMode` is **`manual`**, order is **only** `[primaryProviderId]` — title suggestion is ignored. Most users run **`guided`** (default), so suggestion applies.

### 2.4 Global `down` vs title health

If VidKing is **`down`** globally:

- It is still attempted as **primary** when selected.
- It is **omitted** from extra fallbacks added in the loop.
- Combined with title reorder, behavior feels inconsistent.

---

## 3. Weird behaviors checklist

| Symptom                                         | Likely cause                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| Note says try Rivestream but VidKing still runs | **C** is advisory only; check global **B** `down` or provider priority order |
| Clear cache didn’t help                         | Only layer **A** cleared; **B/C** remain                                     |
| VidKing never in fallback list                  | Global health **B** `status === "down"`                                      |
| Same bad stream again                           | Stale **A** until dead-stream invalidation or `preferFreshStream`            |
| “Struggled with this title” note every episode  | **C** still has `suggestedProviderId` until expiry or 2 clean successes      |
| Parse failures stick a week                     | **C** `severeUntil` / 7d retention for `parse`                               |

---

## 4. Reset: what to clear (after Videasy fix / when testing)

### 4.1 In-app today

```text
/clear-cache → "Clear stream cache only" (layer A)
/clear-cache → "Clear stream cache and provider memory" (layers A + B + C)
```

Title health is **advisory** — resolve order stays on your selected provider; suggestions appear in playback notes only.

### 4.2 Manual DB reset (cache sqlite)

Typical path: OS cache dir `kunai-cache.sqlite` (see diagnostics / config).

```sql
-- Title-scoped health (layer C)
DELETE FROM title_provider_health;

-- Global provider health (layer B)
DELETE FROM provider_health;

-- Optional: source inventory rows for a title
DELETE FROM source_inventory WHERE cache_key LIKE 'tmdb:92783%';
```

Stream keys are in the JSON/file cache store cleared by `/clear-cache`, not necessarily these tables.

### 4.3 Planned product resets (to implement)

| Action                                 | Clears                                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Clear stream cache** (existing)      | Layer A                                                                                      |
| **Clear provider memory** (new)        | Layers B + C (all titles or current title)                                                   |
| **Retry {provider} anyway** (per play) | Layer C for `(titleId, providerId)` only; sets `ignoreTitleHealthSuggestion` on that resolve |

After shipping Videasy fixes, run **Clear provider memory** once in dev so old timeout-based title health doesn’t keep forcing Rivestream-first order.

---

## 5. Override design (recommended)

### 5.1 Resolve input

```ts
ignoreTitleHealthSuggestion?: boolean;  // user pressed "Retry VidKing anyway"
forceProviderOrder?: ProviderId[];      // optional explicit order
```

When `ignoreTitleHealthSuggestion === true`:

- `titleScopedProviderOrder` returns `[primaryProviderId]` only (or user’s explicit list).
- Still respect global `down` only if we add `ignoreGlobalProviderHealth` for diagnostics.

### 5.2 TitleProviderHealthService API

```ts
clear(titleId: string, providerId?: string): void;
// providerId omitted → all providers for that title
```

Wire to:

- Sources panel → **Retry VidKing anyway**
- Settings / maintenance → **Forget title memory for this show**
- Extended clear-cache confirm: “Also clear provider memory?”

### 5.3 UI copy (see sources-overlay-mockup.html)

Banner when suggestion exists:

```text
VidKing struggled on this title before; Naruto worked.
[ Retry VidKing anyway ]  [ Use Naruto ]
```

Suggestion is **advisory**, not a hard block.

### 5.4 Source inventory failed rows

Failed lazy probes should **not** block manual retry of that source:

- Row shows **✕** + reason.
- User selects failed row → `preferFreshStream: true` + `ignoreTitleHealthSuggestion` + clear title health for that provider.

---

## 6. Acceptance criteria (health / override slice)

- [ ] `/clear-cache` optional checkbox clears `title_provider_health` + `provider_health`.
- [ ] `TitleProviderHealthService.clear(titleId, providerId?)` implemented.
- [ ] Resolve honors `ignoreTitleHealthSuggestion`.
- [ ] Sources UI offers **Retry {name} anyway** when suggestion or failed state exists.
- [ ] Docs: three layers A/B/C explained in diagnostics panel.

---

## 7. Related files

| File                                            | Role                                                  |
| ----------------------------------------------- | ----------------------------------------------------- |
| `TitleProviderHealthService.ts`                 | Suggestion + retention                                |
| `PlaybackResolveService.ts`                     | `titleScopedProviderOrder`, cache, health persistence |
| `PlaybackPhase.ts`                              | Post-play `dead-stream` → title health                |
| `workflows.ts` `handleClearCache`               | Layer A only                                          |
| `packages/storage/.../title-provider-health.ts` | SQLite persistence                                    |
