# Plan 058: Trace the fractional `episodeCount` to its source

> **Drift check (run first):** `git diff --stat 51f19b633..HEAD -- apps/cli/src/services/catalog/TitleDetailService.ts packages/providers/src/anilist/ apps/cli/src/services/diagnostics/`
> Mismatch → re-read `readEpisodeCount` and the two ingestion points.

Closes #273 (the residual half — #271's display guard already landed).

## Status

- **Priority:** P3
- **Effort:** S (instrumentation + one reproduction pass)
- **Risk:** LOW — read-only investigation plus a bounded debug capture
- **Depends on:** none
- **Category:** investigation → then a one-line class of fix
- **Planned at:** `51f19b633`, 2026-09-19

## Why this matters

The details rail rendered `episodes 448.2` for Ozark. #271 (landed) added
`readEpisodeCount` guards at both ingestion points so a non-integer is dropped
— the wrong number no longer reaches the screen, but the field is still being
mis-populated somewhere upstream, and other consumers of `episodeCount` may
still read the bad value. The issue's own analysis: TMDB season sums can't
produce a fraction, AniList `media.episodes` is documented integer, and
`448.2` is _one_ field (not two colliding cells — Ozark has 44 episodes,
rating 8.2, which is suggestive but unproven).

## Current state

`apps/cli/src/services/catalog/TitleDetailService.ts`:

```ts
// :466 — TMDB path
episodeCount: readEpisodeCount(seasonMeta.episode_count),
// :829 — AniList path
const episodeCount = readEpisodeCount(media.episodes);
// :951 — the guard
function readEpisodeCount(value: unknown): number | undefined { ... }
```

The guard drops non-integers at ingestion — meaning the corruption happens
**at or before** those reads: either upstream payload, or the path that
_produces_ `seasonMeta.episode_count`/`media.episodes` (sums, merges, a
`+ rating` style concat in a field builder). Suspicion ranked by the issue:
TMDB detail/season aggregation first (Ozark is a TMDB-lane title), then any
code that mixes episode count with rating/vote fields.

## Commands

| Purpose   | Command                                                                  | Expected                     |
| --------- | ------------------------------------------------------------------------ | ---------------------------- |
| CLI unit  | `bun run --cwd apps/cli test:unit`                                       | all pass                     |
| Debug run | `KUNAI_LOG_LEVEL=debug bun run dev -- "Ozark"` (or `-i 46952 -t series`) | trace written under diag dir |

## Scope

**In scope:**

- A bounded debug capture of the raw upstream value when the guard rejects —
  one log/diagnostic record, never the whole payload to logs (redaction rules
  apply; log _field provenance_, not content)
- `TitleDetailService.ts` — likely one line of instrumentation at each guard
  site: when `readEpisodeCount` drops a value, record `typeof`, the raw value,
  and which ingestion point (tmdb vs anilist) — through the diagnostics/log
  seam, not `console.log`
- The actual fix once the source is identified (expected to be small)

**Out of scope:**

- Re-opening the display guard — keep it.
- Bulk refactors of the detail pipeline.

## Steps

### Step 1: Static elimination first (cheap)

Before instrumenting: grep every producer of `episodeCount`/`episode_count`/
`media.episodes` upstream of the two reads — the TMDB season-detail mapper,
the AniList media mapper, any `titleDetail`/`meta` merge. Look specifically
for: arithmetic on the field, spread-merges where a later object could carry
a float, or a field-name collision (e.g. `episodes` written by a rating
path). If the bug is visible statically, skip to Step 4.

**Verify:** you can name the exact line producing the fraction, or have
exhausted the producers and move to instrumentation.

### Step 2: Instrument the guard sites

Where `readEpisodeCount` returns `undefined` for a non-integer, emit one
diagnostics record (the service has a `diagnostics` dep pattern — find it;
fall back to `logger.debug`) containing: ingestion site, `typeof value`,
`String(value)`, and the title id — never the full upstream object.

**Verify:** `bun run --cwd apps/cli typecheck` → 0; a unit test feeding a
fractional fixture asserts the record fires.

### Step 3: Reproduce live

Run `bun run dev -- "Ozark"` (Ozark = `tmdb:46952`, `type: series`) and any
other title that showed a fraction. Read the trace/diag record — it names the
site and the raw value. Cross-check the raw TMDB `/tv/46952` +
`/season/{n}` responses (`curl` or the relay debug path) to see whether the
fraction arrives in the payload or is manufactured locally.

**Verify:** you have the upstream value + the site that saw it.

### Step 4: Fix + regression test

Whatever Step 3 found (most likely a field-collision or an aggregation
dividing where it shouldn't), fix it at the producer. Add a fixture test that
would have caught it.

## Test plan

- Unit: `readEpisodeCount` drop-path emits a provenance record.
- Regression: fixture reproducing the real source once found.

## Done criteria

- [ ] The source of `448.2` is named (file:line or upstream field), not inferred
- [ ] A regression test pins it
- [ ] Guard untouched; `bun run test --force` + `typecheck --force` green

## STOP conditions

- The value is genuinely in the TMDB/AniList payload (a real upstream
  corruption) — then the guard is the complete fix and the plan closes as
  "upstream data quality"; document the finding, don't normalize upstream data.
- Reproduction needs a specific title you can't reach from this environment
  (TMDB unreachable) — land the instrumentation (Step 2) only, and leave the
  plan at PARTIAL with the capture mechanism shipped.

## Maintenance notes

- If more provenance captures like this get added, they should share one
  record shape — don't grow per-site ad-hoc payloads.
