# Rich Details Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the string-scraped browse details with an AniList/IMDb-grade full-screen details sheet backed by the rich `TitleDetail` model — seeded instantly from data we already have, gap-filled with one consolidated call per source, trailer played in mpv.

**Architecture:** Extend `TitleDetail` + its AniList/TMDB resolvers with `score`/`trailerUrl`/`externalLinks` (pure, testable mappers for the new bits). A new pure `buildDetailsSheet` view-model merges an instant seed (from the browse option) with the optional fetched detail + history + availability into typed sections with `loading` flags. A `DetailsSheet` renderer (reusing `details-view.ts` helpers) draws it with skeletons. `browse-shell` opens it seeded, fires the cached `fetchTitleDetail` only for gaps, and dispatches actions (incl. `t` → trailer in mpv).

**Tech Stack:** Bun, Ink 7 (React 19), `bun run test:file <path>` / `bun run test`, `captureFrame` harness, `usePosterPreview`, AniList GraphQL + TMDB REST.

**Spec:** `docs/superpowers/specs/2026-06-16-rich-details-sheet-design.md`

**Working dir:** `cd …/apps/cli` for tests/typecheck/lint; `git -C …/kitsunesnipe` for commits. Single-file tests: `bun run test:file <path>`.

---

## File Structure

| File                                                   | Responsibility                                                             | Action |
| ------------------------------------------------------ | -------------------------------------------------------------------------- | ------ |
| `apps/cli/src/domain/catalog/title-detail.ts`          | `TitleLink` type + `score`/`trailerUrl`/`externalLinks` on `TitleDetail`   | Modify |
| `apps/cli/src/services/catalog/title-detail-extras.ts` | Pure helpers: `toTrailerUrl`, `aniListExternalLinks`, `tmdbExternalLinks`  | Create |
| `apps/cli/src/services/catalog/TitleDetailService.ts`  | AniList query+map (score/trailer); TMDB single `append_to_response` + map  | Modify |
| `apps/cli/src/app-shell/details-sheet.model.ts`        | Pure `buildDetailsSheet(input)` → `DetailsSheetModel` (sections + loading) | Create |
| `apps/cli/src/app-shell/details-sheet-ui.tsx`          | `DetailsSheet` renderer (poster hero, sections, skeletons, footer)         | Create |
| `apps/cli/src/app-shell/browse-shell.tsx`              | Open sheet seeded, gap-fill fetch, `s`/`t`/links/actions wiring            | Modify |
| `apps/cli/src/app/details-trailer.ts`                  | `playTrailerInMpv(container, url)` with browser fallback                   | Create |
| Test files under `apps/cli/test/unit/...`              | One per pure unit + frame snapshots                                        | Create |

**Render note:** the existing `DetailsSheetUI` (`details-pane-ui.tsx`) stays on the playback path untouched to avoid destabilising it; the new `DetailsSheet` consumes `DetailsSheetModel` and reuses the small pure helpers in `details-view.ts` (`wrapSynopsis`, `buildDetailCastLines`, `buildDetailFactRows`). Migrating playback onto the new component is a follow-up.

---

## Task 1: Extend the TitleDetail model

**Files:**

- Modify: `apps/cli/src/domain/catalog/title-detail.ts`

- [ ] **Step 1: Add the `TitleLink` type and three fields**

In `title-detail.ts`, add near the other exported types:

```ts
export type TitleLink = {
  readonly label: string;
  readonly url: string;
};
```

Then inside the `TitleDetail` type, after `readonly externalIds?: ProviderExternalIds;`, add:

```ts
  readonly score?: number;
  readonly trailerUrl?: string;
  readonly externalLinks?: readonly TitleLink[];
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS (pure additive type change).

- [ ] **Step 3: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add apps/cli/src/domain/catalog/title-detail.ts
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "feat(catalog): add score, trailerUrl, externalLinks to TitleDetail"
```

---

## Task 2: Pure trailer + external-link helpers

**Files:**

- Create: `apps/cli/src/services/catalog/title-detail-extras.ts`
- Test: `apps/cli/test/unit/services/catalog/title-detail-extras.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";

import {
  aniListExternalLinks,
  tmdbExternalLinks,
  toTrailerUrl,
} from "@/services/catalog/title-detail-extras";

describe("toTrailerUrl", () => {
  it("builds a youtube watch url", () => {
    expect(toTrailerUrl({ site: "youtube", id: "abc123" })).toBe(
      "https://www.youtube.com/watch?v=abc123",
    );
  });
  it("builds a dailymotion url", () => {
    expect(toTrailerUrl({ site: "dailymotion", id: "x99" })).toBe(
      "https://www.dailymotion.com/video/x99",
    );
  });
  it("returns undefined for unknown site or missing id", () => {
    expect(toTrailerUrl({ site: "vimeo", id: "1" })).toBeUndefined();
    expect(toTrailerUrl({ site: "youtube", id: "" })).toBeUndefined();
    expect(toTrailerUrl(null)).toBeUndefined();
  });
});

describe("aniListExternalLinks", () => {
  it("maps site/url links and appends a MAL link from idMal", () => {
    const links = aniListExternalLinks(
      [
        { site: "Official Site", url: "https://show.example" },
        { site: "Crunchyroll", url: "https://cr.example/show" },
      ],
      "5114",
    );
    expect(links).toEqual([
      { label: "Official Site", url: "https://show.example" },
      { label: "Crunchyroll", url: "https://cr.example/show" },
      { label: "MyAnimeList", url: "https://myanimelist.net/anime/5114" },
    ]);
  });
  it("dedupes, skips blanks, and omits MAL when no idMal", () => {
    expect(aniListExternalLinks([{ site: "", url: "" }], undefined)).toEqual([]);
  });
});

describe("tmdbExternalLinks", () => {
  it("builds homepage + imdb links", () => {
    expect(tmdbExternalLinks("https://site.example", "tt123")).toEqual([
      { label: "Website", url: "https://site.example" },
      { label: "IMDb", url: "https://www.imdb.com/title/tt123/" },
    ]);
  });
  it("returns only what exists", () => {
    expect(tmdbExternalLinks(undefined, undefined)).toEqual([]);
    expect(tmdbExternalLinks(undefined, "tt9")).toEqual([
      { label: "IMDb", url: "https://www.imdb.com/title/tt9/" },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test:file test/unit/services/catalog/title-detail-extras.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/cli/src/services/catalog/title-detail-extras.ts`:

```ts
import type { TitleLink } from "@/domain/catalog/title-detail";

/** Map a provider trailer { site, id } to a watchable URL (mpv/browser handle it). */
export function toTrailerUrl(
  trailer: { readonly site?: string | null; readonly id?: string | null } | null | undefined,
): string | undefined {
  const site = trailer?.site?.toLowerCase().trim();
  const id = trailer?.id?.trim();
  if (!site || !id) return undefined;
  if (site === "youtube") return `https://www.youtube.com/watch?v=${id}`;
  if (site === "dailymotion") return `https://www.dailymotion.com/video/${id}`;
  return undefined;
}

function dedupeLinks(links: readonly TitleLink[]): TitleLink[] {
  const seen = new Set<string>();
  const out: TitleLink[] = [];
  for (const link of links) {
    if (!link.label || !link.url || seen.has(link.url)) continue;
    seen.add(link.url);
    out.push(link);
  }
  return out;
}

/** AniList externalLinks (+ a MAL link derived from idMal) → TitleLink[]. */
export function aniListExternalLinks(
  externalLinks:
    | readonly { readonly site?: string | null; readonly url?: string | null }[]
    | undefined,
  idMal: string | undefined,
): TitleLink[] {
  const mapped = (externalLinks ?? []).map((link) => ({
    label: (link.site ?? "").trim(),
    url: (link.url ?? "").trim(),
  }));
  if (idMal) {
    mapped.push({ label: "MyAnimeList", url: `https://myanimelist.net/anime/${idMal}` });
  }
  return dedupeLinks(mapped);
}

/** TMDB homepage + IMDb id → TitleLink[]. */
export function tmdbExternalLinks(
  homepage: string | undefined,
  imdbId: string | undefined,
): TitleLink[] {
  const links: TitleLink[] = [];
  if (homepage?.trim()) links.push({ label: "Website", url: homepage.trim() });
  if (imdbId?.trim())
    links.push({ label: "IMDb", url: `https://www.imdb.com/title/${imdbId.trim()}/` });
  return dedupeLinks(links);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun run test:file test/unit/services/catalog/title-detail-extras.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add apps/cli/src/services/catalog/title-detail-extras.ts apps/cli/test/unit/services/catalog/title-detail-extras.test.ts
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "feat(catalog): pure trailer + external-link helpers"
```

---

## Task 3: Wire score/trailer/links into the AniList resolver

**Files:**

- Modify: `apps/cli/src/services/catalog/TitleDetailService.ts`

- [ ] **Step 1: Extend the GraphQL query**

In `ANILIST_DETAIL_QUERY`, add `averageScore` after `id`/`idMal`, and a `trailer { id site }` selection after `bannerImage`. The `externalLinks { site url type }` selection already exists. Result:

```graphql
    id
    idMal
    averageScore
    title { romaji english native }
    ...
    bannerImage
    trailer { id site }
    studios(isMain: true) { nodes { name } }
```

- [ ] **Step 2: Extend `AniListDetailResult` + the return mapping**

In `interface AniListDetailResult`, add:

```ts
  readonly score?: number;
  readonly trailerUrl?: string;
  readonly externalLinks?: readonly { readonly label: string; readonly url: string }[];
```

In `fetchAniListDetail`, before the `return {`, add (reusing Task 2 helpers + existing `media`/`readRecord`/`readString`):

```ts
const score =
  typeof media.averageScore === "number" ? Math.round(media.averageScore) / 10 : undefined;
const trailerNode = readRecord(media.trailer);
const trailerUrl = toTrailerUrl({
  site: readString(trailerNode.site),
  id: readString(trailerNode.id),
});
const externalLinksRaw = Array.isArray(media.externalLinks)
  ? media.externalLinks.map(readRecord).map((l) => ({
      site: readString(l.site),
      url: readString(l.url),
    }))
  : [];
const externalLinks = aniListExternalLinks(externalLinksRaw, malId);
```

Add `score, trailerUrl, externalLinks` to the returned object literal. Add the import at the top:

```ts
import { aniListExternalLinks, toTrailerUrl } from "./title-detail-extras";
```

- [ ] **Step 3: Merge into the final `TitleDetail`**

In the merge function (`mapToTitleDetail`, around line 176 — the one combining `tmdb`/`anilist` into `TitleDetail`), add `score`, `trailerUrl`, `externalLinks` to the produced object, preferring AniList for anime and TMDB otherwise. Use the existing source-preference pattern already in that function; e.g.:

```ts
    score: anilist?.score ?? tmdb?.score,
    trailerUrl: anilist?.trailerUrl ?? tmdb?.trailerUrl,
    externalLinks:
      (anilist?.externalLinks?.length ? anilist.externalLinks : undefined) ??
      (tmdb?.externalLinks?.length ? tmdb.externalLinks : undefined),
```

(Place these alongside the other merged fields; match the file's existing key ordering/style.)

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: PASS. (`TmdbDetailResult.score`/`trailerUrl`/`externalLinks` are added in Task 4; until then the `tmdb?.score` reads are `undefined`-typed — add the optional fields to `TmdbDetailResult` now as `readonly score?: number; readonly trailerUrl?: string; readonly externalLinks?: readonly { readonly label: string; readonly url: string }[];` so this typechecks.)

- [ ] **Step 5: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add apps/cli/src/services/catalog/TitleDetailService.ts
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "feat(catalog): AniList resolver maps score, trailer, external links"
```

---

## Task 4: Consolidate TMDB to one call + map extras

**Files:**

- Modify: `apps/cli/src/services/catalog/TitleDetailService.ts`

- [ ] **Step 1: Collapse the 3 main calls into one `append_to_response`**

In `fetchTmdbDetail`, replace the three-way `Promise.allSettled([detail, credits, external_ids])` with a single request and read the appended blocks off it:

```ts
const detailRes = await fetchJsonWithFallback(
  `/${mediaType}/${tmdbId}?append_to_response=credits,external_ids,videos`,
  signal,
).catch(() => null);
if (!detailRes) return null;
const d = readRecord(detailRes);
const credits = readRecord(d.credits);
const externalIds = readRecord(d.external_ids);
const videos = readRecord(d.videos);
```

(Keep the existing per-season `/${mediaType}/${tmdbId}/season/N` fetches unchanged — they are still needed for season posters/thumbnails.)

- [ ] **Step 2: Map score, trailer, links**

After computing `externalIds`, add (using Task 2 helpers + existing `readString`/`readRecord`):

```ts
const score = typeof d.vote_average === "number" ? Math.round(d.vote_average * 10) / 10 : undefined;
const videoResults = Array.isArray(videos.results) ? videos.results.map(readRecord) : [];
const ytTrailer = videoResults.find(
  (v) => readString(v.site).toLowerCase() === "youtube" && /trailer/i.test(readString(v.type)),
);
const trailerUrl = toTrailerUrl({ site: "youtube", id: readString(ytTrailer?.key) });
const externalLinks = tmdbExternalLinks(readString(d.homepage), readString(externalIds.imdb_id));
```

Add `score, trailerUrl, externalLinks` to the returned `TmdbDetailResult`. Add the import:

```ts
import { aniListExternalLinks, toTrailerUrl, tmdbExternalLinks } from "./title-detail-extras";
```

(Combine with the Task 3 import line — one import statement.)

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Sanity test the suite**

Run: `bun run test:file test/unit/services/catalog/`
Expected: PASS (existing TitleDetail tests still green).

- [ ] **Step 5: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add apps/cli/src/services/catalog/TitleDetailService.ts
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "perf(catalog): one TMDB call (append_to_response) + map score/trailer/links"
```

---

## Task 5: Pure `buildDetailsSheet` view-model

**Files:**

- Create: `apps/cli/src/app-shell/details-sheet.model.ts`
- Test: `apps/cli/test/unit/app-shell/details-sheet-model.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";

import { buildDetailsSheet } from "@/app-shell/details-sheet.model";
import type { TitleDetail } from "@/domain/catalog/title-detail";

const seed = {
  title: "Frieren",
  type: "series" as const,
  year: "2023",
  score: 8.9,
  posterUrl: "p.jpg",
};

describe("buildDetailsSheet", () => {
  it("renders the header from the seed with no detail (gap sections load)", () => {
    const sheet = buildDetailsSheet({ seed, detail: null, history: null, availability: null });
    expect(sheet.header.title).toBe("Frieren");
    expect(sheet.header.score).toBe(8.9);
    expect(sheet.synopsis.loading).toBe(true);
    expect(sheet.cast.loading).toBe(true);
  });

  it("fills gap sections from the fetched detail", () => {
    const detail = {
      id: "1",
      type: "series",
      title: "Frieren",
      synopsis: "An elf mage...",
      genres: ["Adventure", "Fantasy"],
      studios: ["Madhouse"],
      cast: [{ name: "Atsumi", kind: "voice" }],
      seasons: [{ season: 1, name: "S1", episodeCount: 28 }],
      trailerUrl: "https://yt/abc",
      externalLinks: [{ label: "MyAnimeList", url: "https://mal/1" }],
    } as unknown as TitleDetail;
    const sheet = buildDetailsSheet({ seed, detail, history: null, availability: null });
    expect(sheet.synopsis.loading).toBe(false);
    expect(sheet.synopsis.text).toContain("An elf mage");
    expect(sheet.facts.studio).toBe("Madhouse");
    expect(sheet.links.items).toEqual([{ label: "MyAnimeList", url: "https://mal/1" }]);
    expect(sheet.trailerUrl).toBe("https://yt/abc");
    expect(sheet.seasons.items).toHaveLength(1);
  });

  it("builds the your-progress block from history", () => {
    const sheet = buildDetailsSheet({
      seed,
      detail: null,
      history: {
        season: 1,
        episode: 5,
        positionSeconds: 600,
        durationSeconds: 1400,
        completed: false,
      },
      availability: { providers: ["videasy"], offline: true, subs: ["en"] },
    });
    expect(sheet.your.progressLabel).toContain("S01E05");
    expect(sheet.your.providers).toEqual(["videasy"]);
    expect(sheet.your.offline).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test:file test/unit/app-shell/details-sheet-model.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/cli/src/app-shell/details-sheet.model.ts`. Define the input + model and build it, reusing `details-view.ts` helpers where they fit:

```ts
import type { TitleDetail, TitleLink } from "@/domain/catalog/title-detail";

export type DetailsSheetSeed = {
  readonly title: string;
  readonly type: "movie" | "series";
  readonly year?: string;
  readonly score?: number;
  readonly posterUrl?: string;
  readonly genres?: readonly string[];
  /** Synopsis + episode count are already on SearchResult (overview / episodeCount),
   *  so they render with NO fetch — the gap-fill call is only for cast/seasons/etc. */
  readonly synopsis?: string;
  readonly episodeCount?: number;
};

export type DetailsSheetHistory = {
  readonly season?: number;
  readonly episode?: number;
  readonly positionSeconds: number;
  readonly durationSeconds?: number;
  readonly completed: boolean;
};

export type DetailsSheetAvailability = {
  readonly providers: readonly string[];
  readonly offline: boolean;
  readonly subs: readonly string[];
};

export type DetailsSheetModel = {
  readonly header: {
    readonly title: string;
    readonly posterUrl?: string;
    readonly metaLine: string; // "Series · 2023 · ★8.9 · ◉ airing"
    readonly score?: number;
    readonly genres: readonly string[];
    readonly statusLabel?: string;
  };
  readonly synopsis: { readonly loading: boolean; readonly text: string };
  readonly facts: {
    readonly loading: boolean;
    readonly studio?: string;
    readonly episodes?: string;
    readonly runtime?: string;
    readonly contentRating?: string;
  };
  readonly your: {
    readonly progressLabel?: string;
    readonly providers: readonly string[];
    readonly offline: boolean;
    readonly subs: readonly string[];
  };
  readonly cast: { readonly loading: boolean; readonly names: readonly string[] };
  readonly seasons: {
    readonly loading: boolean;
    readonly items: readonly { season: number; label: string }[];
  };
  readonly links: { readonly items: readonly TitleLink[] };
  readonly trailerUrl?: string;
};

function statusLabel(status: TitleDetail["status"] | undefined): string | undefined {
  if (!status || status === "unknown") return undefined;
  if (status === "airing") return "◉ airing";
  if (status === "upcoming") return "upcoming";
  return "finished";
}

function progressLabel(history: DetailsSheetHistory | null): string | undefined {
  if (!history) return undefined;
  const code =
    history.season && history.episode
      ? `S${String(history.season).padStart(2, "0")}E${String(history.episode).padStart(2, "0")}`
      : null;
  if (history.completed) return [code, "watched"].filter(Boolean).join(" · ");
  const pct =
    history.durationSeconds && history.durationSeconds > 0
      ? `${Math.min(100, Math.round((history.positionSeconds / history.durationSeconds) * 100))}%`
      : null;
  return [code, pct, "in progress"].filter(Boolean).join(" · ");
}

export function buildDetailsSheet(input: {
  readonly seed: DetailsSheetSeed;
  readonly detail: TitleDetail | null;
  readonly history: DetailsSheetHistory | null;
  readonly availability: DetailsSheetAvailability | null;
  readonly seasonsExpanded?: boolean;
}): DetailsSheetModel {
  const { seed, detail, history, availability } = input;
  const score = detail?.score ?? seed.score;
  const genres = detail?.genres ?? seed.genres ?? [];
  const status = statusLabel(detail?.status);
  const typeLabel = seed.type === "movie" ? "Movie" : "Series";
  const metaLine = [
    typeLabel,
    seed.year,
    typeof score === "number" ? `★${score.toFixed(1)}` : undefined,
    status,
  ]
    .filter(Boolean)
    .join(" · ");

  const episodeCount = detail?.episodeCount ?? seed.episodeCount;
  const episodes =
    episodeCount !== undefined
      ? `${episodeCount} eps${detail?.seasonCount ? ` · ${detail.seasonCount} seasons` : ""}`
      : undefined;
  // Synopsis is on the seed (SearchResult.overview) — only "loading" when neither the
  // seed nor a fetched detail has it. Same idea keeps facts un-skeletoned when seeded.
  const synopsisText = detail?.synopsis ?? seed.synopsis ?? "";

  return {
    header: {
      title: seed.title,
      posterUrl: detail?.artwork?.poster ?? seed.posterUrl,
      metaLine,
      score,
      genres: genres.slice(0, 4),
      statusLabel: status,
    },
    synopsis: { loading: detail === null && !seed.synopsis, text: synopsisText },
    facts: {
      loading: detail === null,
      studio: detail?.studios?.slice(0, 2).join(" · ") || undefined,
      episodes,
      runtime: detail?.runtimeMinutes ? `${detail.runtimeMinutes} min` : undefined,
      contentRating: detail?.contentRating || undefined,
    },
    your: {
      progressLabel: progressLabel(history),
      providers: availability?.providers ?? [],
      offline: availability?.offline ?? false,
      subs: availability?.subs ?? [],
    },
    cast: {
      loading: detail === null,
      names: (detail?.cast ?? []).slice(0, 8).map((c) => c.name),
    },
    seasons: {
      loading: detail === null,
      items: (detail?.seasons ?? []).map((s) => ({
        season: s.season,
        label: s.name ?? `Season ${s.season}`,
      })),
    },
    links: { items: detail?.externalLinks ? [...detail.externalLinks] : [] },
    trailerUrl: detail?.trailerUrl,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun run test:file test/unit/app-shell/details-sheet-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add apps/cli/src/app-shell/details-sheet.model.ts apps/cli/test/unit/app-shell/details-sheet-model.test.ts
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "feat(details): pure buildDetailsSheet view-model with skeleton loading"
```

---

## Task 6: `DetailsSheet` renderer

**Files:**

- Create: `apps/cli/src/app-shell/details-sheet-ui.tsx`
- Test: `apps/cli/test/unit/app-shell/details-sheet-ui.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from "bun:test";
import React from "react";

import { DetailsSheet } from "@/app-shell/details-sheet-ui";
import { buildDetailsSheet } from "@/app-shell/details-sheet.model";
import type { TitleDetail } from "@/domain/catalog/title-detail";
import { captureFrame } from "../../harness/render-capture";

const seed = { title: "Frieren", type: "series" as const, year: "2023", score: 8.9 };

describe("DetailsSheet", () => {
  it("shows skeletons before the detail loads", () => {
    const model = buildDetailsSheet({ seed, detail: null, history: null, availability: null });
    const frame = captureFrame(<DetailsSheet model={model} seasonsExpanded={false} width={90} />, {
      columns: 100,
    });
    expect(frame).toContain("Frieren");
    expect(frame).toContain("★8.9");
    expect(frame).toContain("░"); // skeleton glyph
  });

  it("renders synopsis, facts, links and actions once loaded", () => {
    const detail = {
      id: "1",
      type: "series",
      title: "Frieren",
      synopsis: "An elf mage journeys.",
      genres: ["Adventure"],
      studios: ["Madhouse"],
      episodeCount: 28,
      cast: [{ name: "Atsumi", kind: "voice" }],
      externalLinks: [{ label: "MyAnimeList", url: "https://mal/1" }],
      trailerUrl: "https://yt/abc",
    } as unknown as TitleDetail;
    const model = buildDetailsSheet({ seed, detail, history: null, availability: null });
    const frame = captureFrame(<DetailsSheet model={model} seasonsExpanded={false} width={90} />, {
      columns: 100,
    });
    expect(frame).toContain("An elf mage journeys.");
    expect(frame).toContain("Madhouse");
    expect(frame).toContain("MyAnimeList");
    expect(frame).toContain("trailer");
    expect(frame).not.toContain("░");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test:file test/unit/app-shell/details-sheet-ui.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/cli/src/app-shell/details-sheet-ui.tsx`. Render the model sections with `Box`/`Text`; use `usePosterPreview` (non-embedded, Kitty hero) for the poster; render `░░░░░░` for `loading` sections; reuse `wrapSynopsis` from `details-view.ts` for the synopsis text. Reference the existing `details-pane-ui.tsx` for the poster + layout idiom. Section order: header (poster + title + metaLine + genres), synopsis, facts row, your-block, cast, seasons (only when `seasonsExpanded`, else a "▸ N seasons (s)" affordance), links, trailer line, actions footer:

```tsx
<Text color={palette.dim}>
  ▶ play · + queue · w follow · d download · e episodes{model.trailerUrl ? " · t trailer" : ""} · s
  seasons · esc
</Text>
```

(Match the project's `palette` + primitives. Keep the file focused on rendering — all derivation lives in the model.)

- [ ] **Step 4: Run to verify it passes**

Run: `bun run test:file test/unit/app-shell/details-sheet-ui.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add apps/cli/src/app-shell/details-sheet-ui.tsx apps/cli/test/unit/app-shell/details-sheet-ui.test.tsx
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "feat(details): DetailsSheet renderer with skeletons + sections"
```

---

## Task 7: Trailer-in-mpv action

**Files:**

- Create: `apps/cli/src/app/details-trailer.ts`
- Test: `apps/cli/test/unit/app/details-trailer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";

import { playTrailer } from "@/app/details-trailer";

describe("playTrailer", () => {
  it("plays the url through the player port", async () => {
    const calls: string[] = [];
    await playTrailer(
      {
        playUrl: async (url) => {
          calls.push(url);
          return true;
        },
        openInBrowser: async () => {},
      },
      "https://yt/abc",
    );
    expect(calls).toEqual(["https://yt/abc"]);
  });

  it("falls back to the browser when the player cannot play", async () => {
    const opened: string[] = [];
    await playTrailer(
      {
        playUrl: async () => false,
        openInBrowser: async (url) => {
          opened.push(url);
        },
      },
      "https://yt/abc",
    );
    expect(opened).toEqual(["https://yt/abc"]);
  });

  it("no-ops on an empty url", async () => {
    let touched = false;
    await playTrailer(
      {
        playUrl: async () => {
          touched = true;
          return true;
        },
        openInBrowser: async () => {
          touched = true;
        },
      },
      undefined,
    );
    expect(touched).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test:file test/unit/app/details-trailer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/cli/src/app/details-trailer.ts`:

```ts
export type TrailerPlaybackPort = {
  /** Play a URL in mpv (yt-dlp). Returns false if it could not start. */
  readonly playUrl: (url: string) => Promise<boolean>;
  readonly openInBrowser: (url: string) => Promise<void>;
};

/** Play a trailer in mpv, falling back to the browser when mpv/yt-dlp cannot. */
export async function playTrailer(
  port: TrailerPlaybackPort,
  url: string | undefined,
): Promise<void> {
  if (!url) return;
  let played = false;
  try {
    played = await port.playUrl(url);
  } catch {
    played = false;
  }
  if (!played) await port.openInBrowser(url);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun run test:file test/unit/app/details-trailer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add apps/cli/src/app/details-trailer.ts apps/cli/test/unit/app/details-trailer.test.ts
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "feat(details): playTrailer (mpv with browser fallback)"
```

---

## Task 8: Wire the sheet into browse-shell

**Files:**

- Modify: `apps/cli/src/app-shell/browse-shell.tsx`

- [ ] **Step 1: Read the current details-open path**

Read `browse-shell.tsx` around `companionDetails`, `openDetailsOverlay`, `buildDetailsPanelDataFromBrowseOption`, and where `DetailsSheetUI`/`detailData` overlay is rendered (the `i` / `^O` handler). Identify the overlay render branch and the `i` keybinding.

- [ ] **Step 2: Replace the data path with the new model**

- Add state: `const [sheetDetail, setSheetDetail] = useState<TitleDetail | null>(null);` and `const [seasonsExpanded, setSeasonsExpanded] = useState(false);`
- Build the seed from the selected option's `SearchResult` (`option.value`): `{ title, type, year, score: value.rating ?? undefined, posterUrl: option.previewImageUrl, synopsis: value.overview || undefined, episodeCount: value.episodeCount }`. This makes the header **and synopsis** render with **no network call** (anime search already enriches `overview`/`rating` from AniList; series gets them from `/search/multi`).
- On opening details: set `sheetDetail` to `peekTitleDetail(id, type)` (import from `@/services/catalog/TitleDetailService`). Fire the gap-fill **only when something is still missing** — i.e. skip the fetch when `peek` already returned a detail (cached): `const cached = peekTitleDetail(id, type); setSheetDetail(cached); if (!cached) void fetchTitleDetail(id, type).then(setSheetDetail).catch(() => {});`. Do this in the open **event handler** (the keypress), not a render effect. `fetchTitleDetail` itself rides the shared `fetchTmdbJsonCached` session cache + in-flight dedup, so even a cold fetch reuses any TMDB request another surface already made.
- Render the new `DetailsSheet` with `model={buildDetailsSheet({ seed, detail: sheetDetail, history, availability, seasonsExpanded })}` in the overlay branch (replace the old `DetailsSheetUI`/`detailData` render for browse).
- Keybindings while the sheet is open: `s` → `setSeasonsExpanded((v) => !v)`; `t` → trailer; `e` → episodes; the existing play/queue/download/follow keys already work. For `t`, call the container-provided trailer handler (Step 3).

- [ ] **Step 3: Provide the trailer handler**

`browse-shell` is parented by `SearchPhase`. Add a prop `onPlayTrailer?: (url: string) => void` to `BrowseShell` (mirror `onFollowSelected`), wired in `SearchPhase` to:

```ts
onPlayTrailer: (url) =>
  void playTrailer(
    {
      playUrl: (u) => container.playerService.playExternalUrl(u),
      openInBrowser: (u) => container.shellService.openUrl(u),
    },
    url,
  ),
```

If `playerService.playExternalUrl` / `shellService.openUrl` do not exist, grep for the existing mpv launch + URL-open helpers and use those exact methods; adapt the port lambdas to whatever the container already exposes (do NOT invent new player methods — reuse the real launch path used by normal playback, passing the trailer URL as the media URL).

- [ ] **Step 4: Typecheck + targeted tests**

Run: `bun run typecheck && bun run test:file test/unit/app-shell/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add apps/cli/src/app-shell/browse-shell.tsx apps/cli/src/app/SearchPhase.ts
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "feat(details): open the rich sheet from browse (seed + gap-fill + trailer)"
```

---

## Task 9: Retire the string-scrape path + full gate

**Files:**

- Modify: `apps/cli/src/app-shell/details-panel.ts`, callers in `overlay-panel.tsx` / post-play / playback (only if they used the browse path)

- [ ] **Step 1: Find remaining consumers**

Run: `cd apps/cli && grep -rn "buildDetailsPanelDataFromBrowseOption\|DetailsPanelData\|resolveBrowseDetailsSecondary" src/`
For each consumer that is NOT the browse path just rewired: leave playback's own `DetailsSheetUI` usage untouched. If `details-panel.ts` has zero remaining consumers after Task 8, delete it and its test; if a non-browse caller remains, keep only what they use and remove the now-dead exports.

- [ ] **Step 2: Apply the smallest change that removes dead code**

Delete `details-panel.ts` + `test/unit/app-shell/details-panel.test.ts` if unused; otherwise trim. Update imports.

- [ ] **Step 3: Full gate**

```bash
cd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli
bun run typecheck
bun run lint
bun run test
cd /home/kitsunekode/Projects/hacking/kitsunesnipe
bun run build
```

Expected: typecheck clean, lint clean (watch `no-shadow` on new `detail`/`link`/`season` locals), all tests pass, build succeeds.

- [ ] **Step 4: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add -A
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "refactor(details): retire string-scrape details panel; full gate green"
```

---

## Network / redundancy notes (why this adds no duplicate calls)

The codebase already routes TMDB through ONE cached, in-flight-deduped client
(`fetchTmdbJsonCached` in `tmdb-proxy.ts`, used by search, catalog, and
`TitleDetailService`), and the AniList detail is already a single GraphQL query. This
plan reduces calls rather than adding them:

- **Header + synopsis: zero fetch** — seeded from the `SearchResult` the browse list
  already loaded (`overview`, `rating`, `posterPath`, `episodeCount`; anime is
  AniList-enriched at search time).
- **TMDB detail: 3 calls → 1** — Task 4 collapses detail+credits+external_ids+videos
  into one `append_to_response` request (the old code made three).
- **Gap-fill only, and only when cold** — Task 8 skips `fetchTitleDetail` entirely when
  `peekTitleDetail` is already cached; when it does fetch, it shares the session cache,
  so a title the calendar/reconciliation/search already pulled is not re-fetched.
- **Videasy `db.videasy.to` mirror** is the provider's own resolve-time TMDB fetch inside
  `@kunai/providers`; we intentionally do NOT couple the details sheet to provider
  internals — the `SearchResult` seed + the single shared cached detail call already
  cover the sheet without crossing that boundary or duplicating data.
- **AniList (anime)**: detail stays one query; score/trailer/links are added to the
  EXISTING selection set (Task 3), not a second request.

## Self-Review notes (for the executor)

- **Score precision:** AniList `averageScore` is 0–100 → `/10`; TMDB `vote_average` is 0–10 → use as-is. Both rounded to 1 decimal in the model (`★8.9`).
- **One-image budget:** the sheet's poster is the only Kitty image while it is open; row mini-posters are not on this surface, so no conflict.
- **Seed score source:** browse `SearchResult.rating` is already on a 0–10 scale (see `formatRating` in `browse-option-mappers.ts`) — pass it straight as `seed.score`.
- **Trailer reuse:** Task 8 Step 3 must reuse the real mpv launch path, not a new player method. Confirm the exact container method by grep before writing the lambda.
- **`details-view.ts` reuse:** prefer its `wrapSynopsis` / `buildDetailCastLines` for shared formatting rather than re-implementing in the renderer.
- **No render-effect fetch:** the `fetchTitleDetail` call fires from the open keypress handler (react-doctor: side effects in event handlers, not render effects).
