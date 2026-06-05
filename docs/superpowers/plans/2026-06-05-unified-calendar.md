# Unified Content-Kind Calendar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the calendar's lossy string round-trip with one structured `CalendarItem` model the renderer consumes directly, and make `/calendar` content-kind aware across anime + series + movies in a single unified window.

**Architecture:** A new pure domain model (`CalendarItem`) and builder (`buildCalendarItem`) become the single source of truth. `calendar-results.ts` builds `CalendarItem`s and attaches them structurally to `SearchResult`/`BrowseShellOption`; the renderer (`calendar-ui.tsx`, `calendar-view.ts`) reads the model instead of parsing `metadataSource`/`previewGroup` strings. `CatalogScheduleService` gains a TMDB `/movie/upcoming` source; `loadCalendarResults` loads anime+series+movie windows concurrently and merges.

**Tech Stack:** Bun, TypeScript, Ink (React), `bun:test`. Design tokens via `@kunai/design` / `palette` in `apps/cli/src/app-shell/shell-theme.ts`.

**Spec:** `docs/superpowers/specs/2026-06-05-unified-calendar-and-shell-ux-design.md`

**Conventions:**

- Focused test run: `bun run --cwd apps/cli test -t "<name substring>"`
- Full gate: `bun run --cwd apps/cli test` then `bun run typecheck && bun run lint && bun run fmt` (repo root)
- Do NOT call `bun test` directly per CLAUDE.md; always go through `bun run … test`.
- Branch: `feat/unified-calendar-ux` (already created).

---

## File Structure

- **Create** `apps/cli/src/domain/calendar/calendar-item.ts` — `CalendarItem` type + `buildCalendarItem` pure builder + small pure formatters (day/group/time/episode-code/status copy + reason classification). One responsibility: turn a `CatalogScheduleItem` (+ context) into a render-ready structured item.
- **Create** `apps/cli/test/unit/domain/calendar/calendar-item.test.ts` — builder unit tests (fixed clock).
- **Modify** `apps/cli/src/services/catalog/CatalogScheduleService.ts` — add TMDB `/movie/upcoming` loader + `loadMovieReleaseWindow`.
- **Modify** `apps/cli/src/services/catalog/TimelineService.ts` — passthrough `loadMovieReleaseWindow`.
- **Create** `apps/cli/test/unit/services/catalog/movie-release-window.test.ts` — movie loader normalization test.
- **Modify** `apps/cli/src/domain/types.ts` — add `calendar?: CalendarItem` to `SearchResult`.
- **Modify** `apps/cli/src/app-shell/types.ts` — add `calendar?: CalendarItem` to `BrowseShellOption`.
- **Modify** `apps/cli/src/app/calendar-results.ts` — build `CalendarItem`s, attach structurally, unified concurrent load, updated subtitle copy.
- **Modify** `apps/cli/src/app/browse-option-mappers.ts` — `toCalendarBrowseOption` copies `calendar`; `isCalendarSearchResult` → `result.calendar != null`.
- **Modify** `apps/cli/src/app-shell/calendar-ui.tsx` — read `option.calendar.*`; per-kind color; delete string-parsing helpers.
- **Modify** `apps/cli/src/app-shell/calendar-view.ts` — read `option.calendar.*` for sort/group/episode-code/state.
- **Modify** `apps/cli/test/unit/app/calendar-results.test.ts` + `apps/cli/test/unit/app-shell/calendar-ui.test.ts` — assert on structured `calendar` item.
- **Modify** snapshot captures under `apps/cli/test/__captures__/calendar-*.txt` (regenerate).

---

## Task 1: `CalendarItem` model + `buildCalendarItem` builder

**Files:**

- Create: `apps/cli/src/domain/calendar/calendar-item.ts`
- Test: `apps/cli/test/unit/domain/calendar/calendar-item.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/cli/test/unit/domain/calendar/calendar-item.test.ts
import { expect, test } from "bun:test";

import { buildCalendarItem } from "@/domain/calendar/calendar-item";
import type { CatalogScheduleItem } from "@/services/catalog/CatalogScheduleService";

const NOW = new Date("2026-06-05T12:00:00.000Z").getTime();

function scheduleItem(overrides: Partial<CatalogScheduleItem>): CatalogScheduleItem {
  return {
    source: "anilist",
    titleId: "21",
    titleName: "Frieren",
    type: "anime",
    releaseAt: "2026-06-05T18:30:00.000Z",
    releasePrecision: "timestamp",
    status: "upcoming",
    ...overrides,
  };
}

test("anime airing today maps to airing-today reason with time + episode code", () => {
  const item = buildCalendarItem(scheduleItem({ episode: 29 }), { nowMs: NOW });
  expect(item.contentKind).toBe("anime");
  expect(item.releaseStatus).toBe("upcoming");
  expect(item.reason).toBe("airing-today");
  expect(item.providerConfirmed).toBe(false);
  expect(item.display.episodeCode).toBe("E29");
  expect(item.display.statusLabel).toContain("airs today");
  expect(item.display.time).not.toBeNull();
});

test("anime released in the past maps to catalog-only", () => {
  const item = buildCalendarItem(
    scheduleItem({ releaseAt: "2026-06-01T10:00:00.000Z", status: "released", episode: 28 }),
    { nowMs: NOW },
  );
  expect(item.releaseStatus).toBe("released");
  expect(item.reason).toBe("catalog-only");
});

test("series next episode keeps S/E code and date precision", () => {
  const item = buildCalendarItem(
    scheduleItem({
      source: "tmdb",
      titleId: "tv-1",
      titleName: "Slow Horses",
      type: "series",
      season: 5,
      episode: 3,
      episodeTitle: "Signals",
      releaseAt: "2026-06-07",
      releasePrecision: "date",
      status: "upcoming",
    }),
    { nowMs: NOW },
  );
  expect(item.contentKind).toBe("series");
  expect(item.display.episodeCode).toBe("S05E03");
  expect(item.releasePrecision).toBe("date");
  expect(item.reason).toBe("upcoming-episode");
});

test("movie release item has no episode and movie-release reason", () => {
  const item = buildCalendarItem(
    scheduleItem({
      source: "tmdb",
      titleId: "m-9",
      titleName: "Dune: Part Three",
      type: "movie",
      releaseAt: "2026-06-09",
      releasePrecision: "date",
      status: "upcoming",
      episode: undefined,
    }),
    { nowMs: NOW },
  );
  expect(item.contentKind).toBe("movie");
  expect(item.display.episodeCode).toBe("");
  expect(item.reason).toBe("movie-release");
  expect(item.display.statusLabel.toLowerCase()).toContain("releases");
});

test("today date-only stays upcoming and is not confirmed", () => {
  const item = buildCalendarItem(
    scheduleItem({
      source: "tmdb",
      type: "series",
      season: 1,
      episode: 4,
      releaseAt: "2026-06-05",
      releasePrecision: "date",
      status: "upcoming",
    }),
    { nowMs: NOW },
  );
  expect(item.releaseStatus).toBe("upcoming");
  expect(item.providerConfirmed).toBe(false);
});

test("unknown release date never renders as confirmed", () => {
  const item = buildCalendarItem(
    scheduleItem({ releaseAt: null, releasePrecision: "unknown", status: "unknown" }),
    { nowMs: NOW, providerConfirmed: true },
  );
  expect(item.releaseStatus).toBe("unknown");
  expect(item.providerConfirmed).toBe(false);
  expect(item.reason).toBe("catalog-only");
  expect(item.display.statusLabel.toLowerCase()).toContain("unknown");
});

test("provider-confirmed available item is marked confirmed", () => {
  const item = buildCalendarItem(
    scheduleItem({ releaseAt: "2026-06-04T10:00:00.000Z", status: "released", episode: 28 }),
    { nowMs: NOW, providerConfirmed: true },
  );
  expect(item.providerConfirmed).toBe(true);
  expect(item.reason).toBe("provider-confirmed");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run --cwd apps/cli test -t "buildCalendarItem|airing today|movie release item"`
Expected: FAIL — `Cannot find module '@/domain/calendar/calendar-item'`.

- [ ] **Step 3: Write the builder**

```ts
// apps/cli/src/domain/calendar/calendar-item.ts
import type { CatalogScheduleItem } from "@/services/catalog/CatalogScheduleService";

export type CalendarContentKind = "anime" | "series" | "movie";
export type CalendarReleasePrecision = "timestamp" | "date" | "unknown";
export type CalendarReleaseStatus = "released" | "upcoming" | "unknown";
export type CalendarReleaseReason =
  | "airing-today"
  | "upcoming-episode"
  | "movie-release"
  | "provider-confirmed"
  | "catalog-only";

export type CalendarItem = {
  readonly source: "anilist" | "tmdb";
  readonly titleId: string;
  readonly title: string;
  readonly contentKind: CalendarContentKind;
  readonly season?: number;
  readonly episode?: number;
  readonly episodeTitle?: string;
  readonly releaseAt: string | null;
  readonly releasePrecision: CalendarReleasePrecision;
  readonly releaseStatus: CalendarReleaseStatus;
  readonly providerConfirmed: boolean;
  readonly reason: CalendarReleaseReason;
  readonly dayKey: string | null;
  readonly poster?: string | null;
  readonly popularity?: number;
  readonly averageScore?: number;
  readonly newEpisodeCount?: number;
  readonly inWatchlist?: boolean;
  readonly display: {
    readonly time: string | null;
    readonly statusLabel: string;
    readonly episodeCode: string;
    readonly badge?: string;
    readonly groupLabel: string;
  };
};

export type CalendarItemContext = {
  readonly nowMs: number;
  readonly inWatchlist?: boolean;
  readonly newEpisodeCount?: number;
  readonly providerConfirmed?: boolean;
};

export function buildCalendarItem(
  item: CatalogScheduleItem,
  ctx: CalendarItemContext,
): CalendarItem {
  const contentKind: CalendarContentKind =
    item.type === "movie" ? "movie" : item.type === "anime" ? "anime" : "series";
  const releaseStatus = item.status;
  const releasedToday = isSameLocalDay(item.releaseAt, ctx.nowMs);
  // Unknown precision/date can never be provider-confirmed (spec invariant).
  const providerConfirmed =
    releaseStatus !== "unknown" && Boolean(ctx.providerConfirmed) && Boolean(item.releaseAt);
  const reason = classifyReason({ contentKind, releaseStatus, releasedToday, providerConfirmed });
  const episodeCode = formatEpisodeCode(item);
  const time = formatTime(item);
  const dayKey = formatDayKey(item.releaseAt);

  return {
    source: item.source,
    titleId: item.titleId,
    title: item.titleName,
    contentKind,
    season: item.season,
    episode: item.episode,
    episodeTitle: item.episodeTitle,
    releaseAt: item.releaseAt,
    releasePrecision: item.releasePrecision,
    releaseStatus,
    providerConfirmed,
    reason,
    dayKey,
    poster: item.posterPath ?? null,
    popularity: item.popularity,
    averageScore: item.averageScore,
    newEpisodeCount: ctx.newEpisodeCount,
    inWatchlist: ctx.inWatchlist,
    display: {
      time,
      statusLabel: formatStatusLabel({ item, reason, releaseStatus, releasedToday, time }),
      episodeCode,
      badge: formatBadge({ item, ctx, episodeCode }),
      groupLabel: formatGroupLabel(item.releaseAt, ctx.nowMs),
    },
  };
}

function classifyReason(input: {
  readonly contentKind: CalendarContentKind;
  readonly releaseStatus: CalendarReleaseStatus;
  readonly releasedToday: boolean;
  readonly providerConfirmed: boolean;
}): CalendarReleaseReason {
  if (input.releaseStatus === "unknown") return "catalog-only";
  if (input.providerConfirmed) return "provider-confirmed";
  if (input.contentKind === "movie") return "movie-release";
  if (input.releasedToday) return "airing-today";
  if (input.releaseStatus === "upcoming") return "upcoming-episode";
  return "catalog-only";
}

function formatEpisodeCode(item: CatalogScheduleItem): string {
  if (item.type === "movie") return "";
  if (typeof item.season === "number" && typeof item.episode === "number") {
    return `S${String(item.season).padStart(2, "0")}E${String(item.episode).padStart(2, "0")}`;
  }
  if (typeof item.episode === "number") return `E${String(item.episode).padStart(2, "0")}`;
  return "";
}

function formatTime(item: CatalogScheduleItem): string | null {
  if (!item.releaseAt || item.releasePrecision !== "timestamp") return null;
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    new Date(item.releaseAt),
  );
}

function formatStatusLabel(input: {
  readonly item: CatalogScheduleItem;
  readonly reason: CalendarReleaseReason;
  readonly releaseStatus: CalendarReleaseStatus;
  readonly releasedToday: boolean;
  readonly time: string | null;
}): string {
  const { item, reason, releaseStatus, releasedToday, time } = input;
  if (releaseStatus === "unknown" || !item.releaseAt) return "release unknown";
  if (reason === "provider-confirmed") return "available";
  if (reason === "movie-release") return `releases ${formatShortDate(item.releaseAt)}`;
  if (releasedToday) {
    return releaseStatus === "released"
      ? time
        ? `released today · ${time}`
        : "new today"
      : time
        ? `airs today · ${time}`
        : "airs today";
  }
  if (releaseStatus === "released") return "available";
  return time
    ? `airs ${formatShortDate(item.releaseAt)} · ${time}`
    : `airs ${formatShortDate(item.releaseAt)}`;
}

function formatBadge(input: {
  readonly item: CatalogScheduleItem;
  readonly ctx: CalendarItemContext;
  readonly episodeCode: string;
}): string | undefined {
  const { item, ctx, episodeCode } = input;
  if (ctx.newEpisodeCount && ctx.newEpisodeCount > 0) return `${ctx.newEpisodeCount} new`;
  if (ctx.inWatchlist) return "wl";
  if (item.type !== "movie" && typeof item.episode === "number") {
    return episodeCode || `E${item.episode}`;
  }
  return undefined;
}

function formatGroupLabel(releaseAt: string | null, nowMs: number): string {
  if (!releaseAt) return "DATE TBA";
  const release = new Date(releaseAt);
  if (Number.isNaN(release.getTime())) return "DATE TBA";
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" })
    .format(release)
    .toUpperCase();
  const day = new Intl.DateTimeFormat(undefined, { day: "numeric" }).format(release);
  const base = `${weekday} ${day}`;
  if (isSameLocalDay(releaseAt, nowMs)) return `${base} · Today`;
  const tomorrow = new Date(nowMs);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (isSameLocalDay(releaseAt, tomorrow.getTime())) return `${base} · Tomorrow`;
  return base;
}

function formatShortDate(releaseAt: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(releaseAt),
  );
}

function formatDayKey(releaseAt: string | null): string | null {
  if (!releaseAt) return null;
  const release = new Date(releaseAt);
  if (Number.isNaN(release.getTime())) return null;
  const y = release.getFullYear();
  const m = String(release.getMonth() + 1).padStart(2, "0");
  const d = String(release.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isSameLocalDay(releaseAt: string | null, nowMs: number): boolean {
  if (!releaseAt) return false;
  const release = new Date(releaseAt);
  if (Number.isNaN(release.getTime())) return false;
  const now = new Date(nowMs);
  return (
    release.getFullYear() === now.getFullYear() &&
    release.getMonth() === now.getMonth() &&
    release.getDate() === now.getDate()
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run --cwd apps/cli test -t "buildCalendarItem|airing today|movie release item|date-only stays upcoming|unknown release date|provider-confirmed available|series next episode|catalog-only"`
Expected: PASS (all 7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/domain/calendar/calendar-item.ts apps/cli/test/unit/domain/calendar/calendar-item.test.ts
git commit -m "feat(calendar): add structured CalendarItem model + buildCalendarItem"
```

---

## Task 2: TMDB movie release source + service window

**Files:**

- Modify: `apps/cli/src/services/catalog/CatalogScheduleService.ts`
- Modify: `apps/cli/src/services/catalog/TimelineService.ts`
- Test: `apps/cli/test/unit/services/catalog/movie-release-window.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/cli/test/unit/services/catalog/movie-release-window.test.ts
import { expect, test } from "bun:test";

import {
  CatalogScheduleService,
  type CatalogScheduleLoaders,
} from "@/services/catalog/CatalogScheduleService";

const NOW = new Date("2026-06-05T12:00:00.000Z").getTime();

function serviceWithMovieLoader(): CatalogScheduleService {
  const loaders: CatalogScheduleLoaders = {
    nextRelease: async () => null,
    releasingToday: async () => [],
    movieWindow: async () => [
      {
        source: "tmdb",
        titleId: "m-9",
        titleName: "Dune: Part Three",
        type: "movie",
        posterPath: "/dune3.jpg",
        releaseAt: "2026-06-09",
        releasePrecision: "date",
        status: "unknown",
      },
    ],
  };
  return new CatalogScheduleService(loaders, () => NOW);
}

test("loadMovieReleaseWindow normalizes movie items and classifies status", async () => {
  const items = await serviceWithMovieLoader().loadMovieReleaseWindow(7);
  expect(items).toHaveLength(1);
  expect(items[0]?.type).toBe("movie");
  expect(items[0]?.titleId).toBe("m-9");
  // 2026-06-09 is after 2026-06-05 → upcoming once normalized through classifyReleaseStatus.
  expect(items[0]?.status).toBe("upcoming");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run --cwd apps/cli test -t "loadMovieReleaseWindow"`
Expected: FAIL — `movieWindow` not in `CatalogScheduleLoaders` / `loadMovieReleaseWindow` is not a function.

- [ ] **Step 3: Add the loader type, default loader, and method**

In `apps/cli/src/services/catalog/CatalogScheduleService.ts`:

Add to the `CatalogScheduleLoaders` type (after `releasingToday`):

```ts
  readonly movieWindow?: (
    window: CatalogScheduleWindow,
    signal?: AbortSignal,
  ) => Promise<readonly CatalogScheduleItem[]>;
```

Add a method to the `CatalogScheduleService` class (next to `loadReleaseWindow`):

```ts
  async loadMovieReleaseWindow(
    days: number,
    signal?: AbortSignal,
  ): Promise<readonly CatalogScheduleItem[]> {
    const window = buildLocalWindow(this.now(), days);
    const key = `movie-window:${window.dateKey}:${Math.max(1, Math.trunc(days))}`;
    return this.loadCached(key, RELEASING_TODAY_TTL_MS, signal, { source: "tmdb" }, async () => {
      const load = this.loaders.movieWindow ?? loadTmdbMovieUpcoming;
      const items = await load(window, signal);
      return items.map((item) => normalizeScheduleItem(item, this.now()));
    });
  }
```

Add the default loader near `loadTmdbAiringToday`:

```ts
async function loadTmdbMovieUpcoming(
  window: CatalogScheduleWindow,
  signal?: AbortSignal,
): Promise<readonly CatalogScheduleItem[]> {
  const data = await fetchJson(`${VIDEASY_TMDB_URL}/movie/upcoming?language=en-US&page=1`, signal);
  const resultPayload = readRecord(data).results;
  const results = Array.isArray(resultPayload) ? resultPayload.map(readRecord) : [];
  const startKey = formatWindowDateKey(window.start);
  const endKey = formatWindowDateKey(window.end);
  return results.flatMap((item) => {
    const id = item.id;
    if (id === null || id === undefined) return [];
    const releaseAt = readString(item.release_date) || null;
    // Keep only releases that fall inside the requested window (date-key compare).
    if (releaseAt && (releaseAt < startKey || releaseAt >= endKey)) return [];
    const titleName = readString(item.title) || readString(item.original_title) || "Unknown";
    return [
      {
        source: "tmdb",
        titleId: String(id),
        titleName,
        type: "movie",
        posterPath: readString(item.poster_path) || readString(item.backdrop_path) || null,
        popularity: typeof item.popularity === "number" ? item.popularity : undefined,
        releaseAt,
        releasePrecision: releaseAt ? "date" : "unknown",
        status: "unknown",
      } satisfies CatalogScheduleItem,
    ];
  });
}

function formatWindowDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
```

Add `movieWindow: loadTmdbMovieUpcoming,` to the `defaultCatalogScheduleLoaders` object.

- [ ] **Step 4: Add the TimelineService passthrough**

In `apps/cli/src/services/catalog/TimelineService.ts`, widen the constructor `schedule` type to include `loadMovieReleaseWindow` and add:

```ts
  async loadMovieReleaseWindow(
    days: number,
    signal?: AbortSignal,
  ): Promise<readonly CatalogScheduleItem[]> {
    return this.schedule.loadMovieReleaseWindow
      ? this.schedule.loadMovieReleaseWindow(days, signal)
      : [];
  }
```

Update the constructor param type union to:

```ts
    private readonly schedule: Pick<
      CatalogScheduleService,
      "getNextRelease" | "loadReleasingToday"
    > &
      Partial<
        Pick<CatalogScheduleService, "loadReleaseWindow" | "loadMovieReleaseWindow">
      >,
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun run --cwd apps/cli test -t "loadMovieReleaseWindow"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/services/catalog/CatalogScheduleService.ts apps/cli/src/services/catalog/TimelineService.ts apps/cli/test/unit/services/catalog/movie-release-window.test.ts
git commit -m "feat(calendar): add TMDB movie release window source"
```

---

## Task 3: Attach `CalendarItem` structurally to result + option

**Files:**

- Modify: `apps/cli/src/domain/types.ts:128` (after `popularity`)
- Modify: `apps/cli/src/app-shell/types.ts:208` (in `BrowseShellOption`)

- [ ] **Step 1: Add the import + field to `SearchResult`**

In `apps/cli/src/domain/types.ts`, add near the top imports:

```ts
import type { CalendarItem } from "@/domain/calendar/calendar-item";
```

Add inside `SearchResult` (right before `readonly displayGroup?`):

```ts
  /** Structured calendar item — the single source of truth for calendar rows. */
  readonly calendar?: CalendarItem;
```

- [ ] **Step 2: Add the field to `BrowseShellOption`**

In `apps/cli/src/app-shell/types.ts`, add the import:

```ts
import type { CalendarItem } from "@/domain/calendar/calendar-item";
```

Add inside `BrowseShellOption<T>` (right before `previewGroup?`):

```ts
  /** Structured calendar item — calendar renderer reads this instead of strings. */
  calendar?: CalendarItem;
```

- [ ] **Step 3: Verify it typechecks**

Run: `bun run --cwd apps/cli typecheck`
Expected: PASS (no usages yet; fields are optional).

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/domain/types.ts apps/cli/src/app-shell/types.ts
git commit -m "feat(calendar): carry structured CalendarItem on result and option"
```

---

## Task 4: Build `CalendarItem`s in `calendar-results.ts` + unified load

**Files:**

- Modify: `apps/cli/src/app/calendar-results.ts`
- Test: `apps/cli/test/unit/app/calendar-results.test.ts` (migrated in Task 7)

This task rewrites the producer. The key changes:

1. Load anime + series + movie windows concurrently (resilient).
2. Build a `CalendarItem` per schedule item (with watchlist + new-episode context) and set it on `SearchResult.calendar`.
3. Keep `previewImageUrl`/poster + title via the existing mapper; stop encoding semantics into `metadataSource`.

- [ ] **Step 1: Replace the window loader with a unified loader**

In `apps/cli/src/app/calendar-results.ts`, replace `loadCalendarWindow` with:

```ts
async function loadUnifiedCalendarWindow(
  timelineService: CalendarContainer["timelineService"],
  days: number,
  signal?: AbortSignal,
): Promise<readonly CatalogScheduleItem[]> {
  const tasks: Promise<readonly CatalogScheduleItem[]>[] = [
    loadWindowForMode(timelineService, "anime", days, signal),
    loadWindowForMode(timelineService, "series", days, signal),
    "loadMovieReleaseWindow" in timelineService &&
    typeof timelineService.loadMovieReleaseWindow === "function"
      ? timelineService.loadMovieReleaseWindow(days, signal)
      : Promise.resolve([] as readonly CatalogScheduleItem[]),
  ];
  const settled = await Promise.allSettled(tasks);
  return settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

async function loadWindowForMode(
  timelineService: CalendarContainer["timelineService"],
  mode: CatalogScheduleMode,
  days: number,
  signal?: AbortSignal,
): Promise<readonly CatalogScheduleItem[]> {
  if (
    "loadReleaseWindow" in timelineService &&
    typeof timelineService.loadReleaseWindow === "function"
  ) {
    return timelineService.loadReleaseWindow(mode, days, signal);
  }
  return timelineService.loadReleasingToday(mode, signal);
}
```

Note: this means `Promise.allSettled` swallows a single failed source so the calendar still renders the others. If ALL fail, callers see an empty result (existing error surface in the shell still applies when the whole load throws — keep `loadCalendarResults` non-throwing for partial failure).

- [ ] **Step 2: Switch `loadCalendarResults` to the unified loader + build CalendarItems**

Replace the body that computes `items`/`sorted` and `toCalendarSearchResult` mapping. The new flow:

```ts
const days = 7;
const items = await loadUnifiedCalendarWindow(container.timelineService, days, signal);
const sorted = [...items].sort(compareCalendarItems);
// ... existing historyMatches + releaseProgress projection block stays unchanged ...
const results = sorted.map((item) => {
  const progress = releaseProgress.get(item.titleId);
  const calendar = buildCalendarItem(item, {
    nowMs: Date.now(),
    inWatchlist: isInWatchlist(item.titleId),
    newEpisodeCount: activeNewEpisodeCount(progress),
    providerConfirmed: false,
  });
  return toCalendarSearchResult(item, calendar);
});
```

Add the import at the top:

```ts
import { buildCalendarItem } from "@/domain/calendar/calendar-item";
```

- [ ] **Step 3: Rewrite `toCalendarSearchResult` to attach the structured item**

Replace `toCalendarSearchResult` with:

```ts
function toCalendarSearchResult(item: CatalogScheduleItem, calendar: CalendarItem): SearchResult {
  const year = item.releaseAt ? String(new Date(item.releaseAt).getFullYear()) : "";
  return {
    id: item.titleId,
    type: item.type === "movie" ? "movie" : "series",
    title: item.titleName,
    year,
    overview: calendar.display.episodeCode
      ? `${calendar.display.episodeCode} · ${calendar.display.statusLabel}`
      : calendar.display.statusLabel,
    posterPath: item.posterPath ?? null,
    metadataSource: `${item.source === "anilist" ? "AniList" : "TMDB"} calendar`,
    rating: typeof item.averageScore === "number" ? item.averageScore / 10 : undefined,
    popularity: item.popularity,
    calendar,
    episodeCount: item.episode,
  };
}
```

Add the `CalendarItem` import:

```ts
import type { CalendarItem } from "@/domain/calendar/calendar-item";
```

Delete now-dead helpers: `describeCalendarRelease`, `describeCalendarBadge`, `describeCalendarDay`, `describeCalendarGroup`, `describeCalendarDayKey`, `describeCalendarTime`, `formatReleaseDayPhrase`, `formatCalendarEpisodeCode`, `formatCalendarEpisodeLine` (all replaced by `buildCalendarItem`). Keep `compareCalendarItems`, `isSameLocalDay`, `activeNewEpisodeCount`, the history/projection block, and `matchCalendarHistory`.

- [ ] **Step 4: Update the subtitle copy (unified, not per-mode)**

Replace the subtitle/emptyMessage block with:

```ts
const releasedCount = sorted.filter((item) => item.status === "released").length;
const airingTodayCount = sorted.filter(
  (item) => item.status !== "released" && isSameLocalDay(item.releaseAt, Date.now()),
).length;
const newEpisodeCount = [...releaseProgress.values()].reduce(
  (total, projection) => total + activeNewEpisodeCount(projection),
  0,
);
const newEpisodeSuffix = newEpisodeCount > 0 ? ` · ${newEpisodeCount} new for you` : "";

return {
  results,
  subtitle:
    results.length > 0
      ? `${results.length} this week · ${airingTodayCount} airing today · ${releasedCount} released${newEpisodeSuffix}`
      : "No releases found for the next week",
  emptyMessage:
    "No releases found for the next week. Search and recommendations still work normally.",
};
```

- [ ] **Step 5: Update `isCalendarSearchResult`**

Replace with:

```ts
export function isCalendarSearchResult(result: SearchResult): boolean {
  return result.calendar != null;
}
```

- [ ] **Step 6: Run typecheck (tests migrated in Task 7)**

Run: `bun run --cwd apps/cli typecheck`
Expected: PASS. (Calendar-results tests will fail until Task 7 — that's expected; do not run them yet.)

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/app/calendar-results.ts
git commit -m "feat(calendar): build CalendarItems and load anime+series+movies unified"
```

---

## Task 5: Map `calendar` onto the browse option

**Files:**

- Modify: `apps/cli/src/app/browse-option-mappers.ts:23-61` (`toCalendarBrowseOption`)

- [ ] **Step 1: Attach `calendar` and drop string-encoded preview fields**

Rewrite `toCalendarBrowseOption` to:

```ts
function toCalendarBrowseOption(
  result: SearchResult,
  listService?: ListService,
): BrowseShellOption<SearchResult> {
  const calendar = result.calendar;
  const inWatchlist = calendar?.inWatchlist ?? listService?.isInWatchlist(result.id) ?? false;
  const posterUrl = toPosterUrl(result.posterPath);
  return {
    value: result,
    label: result.title,
    detail: result.overview?.trim() ?? "",
    calendar,
    previewTitle: result.title,
    previewMeta: [
      calendar ? kindLabel(calendar.contentKind) : result.type === "series" ? "Series" : "Movie",
      result.year || undefined,
      calendar?.display.time ?? undefined,
    ].filter((value): value is string => Boolean(value)),
    previewDayKey: calendar?.dayKey ?? undefined,
    previewTime: calendar?.display.time ?? undefined,
    previewBadge: inWatchlist ? "wl" : calendar?.display.badge,
    previewImageUrl: posterUrl,
    previewBody: result.overview || "No schedule details available.",
    previewNote: "Press Enter to open this release.",
  };
}

function kindLabel(kind: CalendarItem["contentKind"]): string {
  return kind === "anime" ? "Anime" : kind === "movie" ? "Movie" : "Series";
}
```

Add the import:

```ts
import type { CalendarItem } from "@/domain/calendar/calendar-item";
```

- [ ] **Step 2: Run typecheck**

Run: `bun run --cwd apps/cli typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/app/browse-option-mappers.ts
git commit -m "feat(calendar): attach structured calendar item to browse option"
```

---

## Task 6: Renderer consumes the model (delete string parsing)

**Files:**

- Modify: `apps/cli/src/app-shell/calendar-ui.tsx`
- Modify: `apps/cli/src/app-shell/calendar-view.ts`
- Test: `apps/cli/test/unit/app-shell/calendar-ui.test.ts` (migrated in Task 7)

- [ ] **Step 1: Replace string-based derivations in `calendar-ui.tsx`**

Replace these functions to read `option.calendar`:

```ts
export function isCalendarBrowseOption<T>(option: BrowseShellOption<T> | undefined): boolean {
  return Boolean(option?.calendar);
}

export function isCalendarTrackedOption<T>(option: BrowseShellOption<T>): boolean {
  return option.calendar?.inWatchlist === true || option.previewBadge === "wl";
}

function calendarItemOf<T>(option: BrowseShellOption<T>) {
  return option.calendar;
}

export function deriveCalendarReleaseState<T>(
  option: BrowseShellOption<T>,
  nowMs: number = Date.now(),
): CalendarReleaseState {
  const item = calendarItemOf(option);
  if (!item) return "upcoming";
  if (item.providerConfirmed) return "available";
  if (item.releaseStatus === "unknown") return "upcoming";
  if (item.reason === "movie-release" || item.reason === "upcoming-episode") {
    if (item.releasePrecision === "timestamp" && item.releaseAt) {
      return Date.parse(item.releaseAt) > nowMs ? "countdown" : "resolving";
    }
    return "upcoming";
  }
  if (item.reason === "airing-today") {
    if (item.releasePrecision === "timestamp" && item.releaseAt) {
      return Date.parse(item.releaseAt) > nowMs ? "countdown" : "resolving";
    }
    return "resolving";
  }
  // catalog-only with a known release: aired today → resolving, else missed.
  return item.dayKey && isSameDayKey(item.dayKey, nowMs) ? "resolving" : "missed";
}

export function hasProviderConfirmedAvailability<T>(option: BrowseShellOption<T>): boolean {
  return option.calendar?.providerConfirmed === true;
}

function isSameDayKey(dayKey: string, nowMs: number): boolean {
  const now = new Date(nowMs);
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return dayKey === key;
}
```

Replace `formatCalendarReleaseStateLabel` to prefer the structured status label, falling back to state copy:

```ts
export function formatCalendarReleaseStateLabel<T>(
  state: CalendarReleaseState,
  option: BrowseShellOption<T>,
  nowMs: number = Date.now(),
): string {
  const item = option.calendar;
  if (state === "countdown" && item?.releaseAt) {
    return formatReleaseCountdown(Date.parse(item.releaseAt) - nowMs);
  }
  if (state === "resolving") return "aired · resolving";
  if (state === "missed") return "aired · not available";
  if (state === "failed") return "schedule unavailable";
  if (item) return item.display.statusLabel;
  return "upcoming";
}
```

Replace `matchesCalendarType` to read the kind:

```ts
function matchesCalendarType(result: SearchResult, tab: CalendarTypeTab): boolean {
  const kind = result.calendar?.contentKind;
  if (tab === "Movies") return kind === "movie";
  if (tab === "Anime") return kind === "anime";
  if (tab === "TV") return kind === "series";
  return true;
}
```

Delete `isCalendarGroupToday` and the old text-scan body of `hasProviderConfirmedAvailability`. Keep `calendarReleaseRowPresentation`, `buildCalendarPreviewRailModel`, the state/glyph palette mapping, day-strip helpers — but switch `buildCalendarDaysFromOptions`, `filterCalendarOptionsByDay`, `calendarDayKeyFromGroup` callers to use `option.calendar?.dayKey` and `option.calendar?.display.groupLabel` where they currently parse `previewGroup`.

- [ ] **Step 2: Per-kind row color in `CalendarScheduleRow`**

In `CalendarScheduleRow`, derive a kind color and use it for the episode-code column:

```ts
const kind = option.calendar?.contentKind;
const kindColor =
  kind === "anime" ? palette.typeAnime : kind === "movie" ? palette.typeMovie : palette.typeSeries;
```

Pass `kindColor` to `listRowEpColumn(ep, epWidth, kindColor)` if that column accepts a color; otherwise wrap the episode-code cell `<Text color={kindColor}>`. (Check `listRowEpColumn` signature in `primitives/ListRow`; add an optional color param if missing, defaulting to the current color.)

- [ ] **Step 3: Replace `episodeCode`/sort helpers in `calendar-view.ts`**

```ts
function episodeCode(option: BrowseShellOption<SearchResult>): string {
  return option.calendar?.display.episodeCode ?? "";
}

function mediaTypeSortRank(option: BrowseShellOption<SearchResult>): number {
  const kind = option.value.calendar?.contentKind;
  if (kind === "anime") return 0;
  if (kind === "movie") return 2;
  return 1;
}

function sortTimestampMs(option: BrowseShellOption<SearchResult>, _nowMs: number): number {
  const releaseAt = option.value.calendar?.releaseAt;
  if (releaseAt) {
    const ms = Date.parse(releaseAt);
    if (Number.isFinite(ms)) return ms;
  }
  return Number.MAX_SAFE_INTEGER;
}
```

In `buildCalendarView`/`buildCalendarRenderRows`, replace `calendarDayKeyFromGroup(option.previewGroup)` with `option.calendar?.dayKey ?? null` for the day-header label and use `option.calendar?.display.groupLabel` for display.

- [ ] **Step 4: Update the dim hint footer to match real bindings**

In `browse-shell.tsx:1028`, ensure the calendar hint line reads exactly:
`  ·  ← → day  ·  ⇥ type  ·  enter open  ·  / commands`

- [ ] **Step 5: Typecheck**

Run: `bun run --cwd apps/cli typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/app-shell/calendar-ui.tsx apps/cli/src/app-shell/calendar-view.ts apps/cli/src/app-shell/browse-shell.tsx
git commit -m "feat(calendar): renderer reads structured CalendarItem; per-kind color"
```

---

## Task 7: Migrate tests + regenerate captures

**Files:**

- Modify: `apps/cli/test/unit/app/calendar-results.test.ts`
- Modify: `apps/cli/test/unit/app-shell/calendar-ui.test.ts`
- Modify: `apps/cli/test/__captures__/calendar-*.txt`

- [ ] **Step 1: Update `calendar-results.test.ts` assertions to structured fields**

Replace `metadataSource` substring assertions with `calendar` assertions. Example for the first test (`maps releasing-today items`):

```ts
expect(requestedDays).toBe(7);
expect(results.subtitle).toContain("airing today");
expect(results.results[0]).toMatchObject({
  id: "21",
  title: "Frieren",
  posterPath: "https://img.example/frieren.jpg",
});
expect(results.results[0]?.calendar).toMatchObject({
  contentKind: "anime",
  reason: "airing-today",
  providerConfirmed: false,
});
expect(results.results[0]?.calendar?.display.episodeCode).toBe("E29");
expect(results.results[0]?.calendar?.display.statusLabel).toContain("airs today");
```

Apply the same pattern to the other tests: assert on `result.calendar.contentKind / reason / releaseStatus / providerConfirmed / display.*` and the `displayBadge`→`calendar.display.badge` (e.g. `"3 new"`). The unified loader now also calls anime+series+movie windows — in the existing single-mode mocks, the missing `loadMovieReleaseWindow` returns `[]` and the unused mode returns the same mocked window; adjust mocks so each mode loader returns its fixture only once and movie returns `[]`. Use `Promise.allSettled`-safe mocks (no throw).

- [ ] **Step 2: Update `calendar-ui.test.ts` to build options with `calendar`**

Where tests construct `BrowseShellOption` fixtures, set `option.calendar = buildCalendarItem(scheduleItem, { nowMs })` instead of `previewGroup`/`metadataSource` strings. Import `buildCalendarItem` and a fixed `nowMs`.

- [ ] **Step 3: Run the calendar unit tests**

Run: `bun run --cwd apps/cli test -t "calendar"`
Expected: PASS.

- [ ] **Step 4: Regenerate snapshot captures**

The capture harness is `apps/cli/test/harness/capture-calendar.tsx`. Regenerate and review the diff:

Run: `bun run --cwd apps/cli test -t "capture"` (or the project's capture-update path if the harness writes on a flag — check the harness header for the update command).
Expected: captures under `test/__captures__/calendar-*.txt` update to the new per-kind/structured rows; eyeball that columns still align and copy is honest.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/test/unit/app/calendar-results.test.ts apps/cli/test/unit/app-shell/calendar-ui.test.ts apps/cli/test/__captures__/calendar-*.txt
git commit -m "test(calendar): assert structured CalendarItem; regenerate captures"
```

---

## Task 8: Full verification gate

- [ ] **Step 1: Run the full CLI test suite**

Run: `bun run --cwd apps/cli test`
Expected: PASS (no calendar regressions; movie window + builder green).

- [ ] **Step 2: Typecheck, lint, format (repo root)**

Run: `bun run typecheck && bun run lint && bun run fmt`
Expected: all PASS / clean.

- [ ] **Step 3: Manual smoke (optional but recommended)**

Run: `bun run dev -- --debug`, open `/calendar`, confirm: all three kinds appear in one window, Tab/Shift+Tab cycle type tabs with the active pill highlighted, Movies tab shows `releases <date>` rows, ←/→ move days, unknown-date rows read `release unknown`, today date-only rows read as upcoming (not released).

- [ ] **Step 4: Final commit (if captures/lint changed anything)**

```bash
git add -A
git commit -m "chore(calendar): verification gate green"
```

---

## Self-Review notes (addressed)

- **Spec coverage:** `CalendarItem` (Task 1) · structural carry (Task 3, 5) · renderer consumes model + delete parsing (Task 6) · unified anime+series+movie load (Task 4) · movie source (Task 2) · honest precision/reason + today-date-only + unknown-not-confirmed (Task 1 tests) · per-kind color / tabs / footer (Task 6) · test list (Task 1, 7). All present.
- **Type consistency:** `buildCalendarItem(item, ctx)` signature, `CalendarItem.display.{time,statusLabel,episodeCode,badge,groupLabel}`, `CatalogScheduleLoaders.movieWindow`, and `loadMovieReleaseWindow(days, signal)` are used identically across tasks.
- **Open verification during execution:** confirm `listRowEpColumn` accepts a color param (Task 6 Step 2) and the capture-update command in the harness header (Task 7 Step 4) — both are check-then-adapt, not blockers.

```

```
