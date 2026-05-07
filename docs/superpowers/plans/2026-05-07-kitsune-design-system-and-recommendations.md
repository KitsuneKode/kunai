# Kitsune Design System + Recommendations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a shared design token package (`@kunai/design`) that formalises the fox-amber palette with hot-pink anime accent, a minimal display mode, then build a lazy-loaded Discover screen and post-playback recommendation nudge powered by TMDB.

**Architecture:** Token values live in `packages/design/src/tokens.ts`; both the CLI (`shell-theme.ts`, `design.ts`) and future web consume them in their native format. The `RecommendationService` fetches from TMDB `/recommendations` and `/trending` on demand, caches results to a JSON file in the Kunai config dir, and surfaces via a new `openDiscoverShell` Ink component and a post-playback nudge when a series is fully watched. A shared `buildDiscoverSections` helper eliminates the duplication between the browse and post-playback flows.

**Principles applied throughout:**
- **Single source of truth**: `KitsuneConfig` is the only config type; no nested sub-objects — all new fields are flat (e.g. `discoverShowOnStartup`, `minimalMode`).
- **DRY**: `buildDiscoverSections` is defined once in `app/discover-sections.ts` and called from both `main.ts` and `PlaybackPhase.ts`.
- **Non-additive**: `effectiveFooterHints` already exists as the right abstraction for footer density — we fix its stub implementation rather than adding a parallel mechanism.
- **Naming**: component names describe what they render (`DiscoverSectionView`, not `SectionList`); helpers describe what they return (`buildDiscoverSections`, not `getSections`).

**Tech Stack:** Bun, TypeScript, Ink (React), TMDB REST API (existing key), `@kunai/storage` for paths, `writeAtomicJson` for cache persistence.

**Spec:** `docs/superpowers/specs/2026-05-07-kitsune-design-system-and-recommendations.md`

---

## File Map

**Created:**
- `packages/design/package.json`
- `packages/design/tsconfig.json`
- `packages/design/src/tokens.ts`
- `packages/design/src/index.ts`
- `apps/cli/src/services/recommendations/RecommendationService.ts`
- `apps/cli/src/services/recommendations/RecommendationServiceImpl.ts`
- `apps/cli/src/app/discover-sections.ts` — shared helper, used by both `main.ts` and `PlaybackPhase.ts`
- `apps/cli/src/app-shell/discover-shell.tsx`
- `apps/cli/test/unit/services/recommendations/recommendation-service.test.ts`

**Modified:**
- `packages/design` added to `apps/cli/package.json` dependencies
- `apps/cli/src/app-shell/shell-theme.ts` — import tokens, update palette values, add `pink`
- `apps/cli/src/design.ts` — add `clr.pink`, `clr.teal`; update `box` to rounded corners
- `apps/cli/src/domain/session/command-registry.ts` — add `"discover"` to `AppCommandId` and `COMMANDS`
- `apps/cli/src/app-shell/types.ts` — add `"discover"` to `ShellAction`, add `showDiscoverNudge` to `PlaybackShellState`
- `apps/cli/src/app-shell/command-router.ts` — handle `"discover"` action
- `apps/cli/src/app-shell/ink-shell.tsx` — add `openDiscoverShell`, update `PlaybackShellState` usage for nudge
- `apps/cli/src/app/PlaybackPhase.ts` — pass `showDiscoverNudge` + `"discover"` command to post-playback
- `apps/cli/src/services/persistence/ConfigService.ts` — add `discover` config block to `KitsuneConfig`
- `apps/cli/src/services/persistence/ConfigServiceImpl.ts` — add defaults
- `apps/cli/src/container.ts` — wire `RecommendationService`

---

## Phase 1 — Design Token System

---

### Task 1: Create `packages/design` token package

**Files:**
- Create: `packages/design/package.json`
- Create: `packages/design/tsconfig.json`
- Create: `packages/design/src/tokens.ts`
- Create: `packages/design/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
// packages/design/package.json
{
  "name": "@kunai/design",
  "version": "0.1.0",
  "private": true,
  "description": "Kitsune design token primitives — shared by CLI and web.",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "bun tsc --noEmit",
    "lint": "oxlint .",
    "fmt": "oxfmt --write .",
    "fmt:check": "oxfmt --check ."
  },
  "devDependencies": {
    "@types/bun": "latest"
  },
  "peerDependencies": {
    "typescript": "^6.0.3"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
// packages/design/tsconfig.json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleDetection": "force",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `src/tokens.ts`**

```ts
// packages/design/src/tokens.ts

export const tokens = {
  // Backgrounds — 4-step warm-black surface scale
  bg:              "#0e0b08",
  surface:         "#181310",
  surfaceElevated: "#221c16",
  surfaceActive:   "#2c231a",
  border:          "#2e2520",
  borderDim:       "#1e1a15",

  // Primary brand — fox amber
  amber:     "#ff9c3a",
  amberSoft: "#ffb870",
  amberDim:  "#7a4600",
  amberGlow: "rgba(255,156,58,0.11)",

  // Anime / secondary accent — hot pink
  pink:     "#ff3d82",
  pinkSoft: "#ff7aaa",
  pinkDim:  "#7a1038",
  pinkGlow: "rgba(255,61,130,0.11)",

  // Status
  teal:     "#3de0c4",
  tealDim:  "#1a5a4c",
  green:    "#7fd46b",
  greenDim: "#2a5a22",
  red:      "#ff5a5a",
  yellow:   "#f5c842",

  // Text scale — 5 steps for hierarchy
  text:    "#f0e6d9",
  textDim: "#c4b5a5",
  muted:   "#8a7d70",
  dim:     "#5a504a",
  faint:   "#3a322c",
} as const;

export type TokenName = keyof typeof tokens;
export type TokenValue = (typeof tokens)[TokenName];
```

- [ ] **Step 4: Create `src/index.ts`**

```ts
// packages/design/src/index.ts
export { tokens } from "./tokens";
export type { TokenName, TokenValue } from "./tokens";
```

- [ ] **Step 5: Verify the package typechecks**

```bash
cd packages/design && bun run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/design/
git commit -m "feat: add @kunai/design token package"
```

---

### Task 2: Wire CLI to `@kunai/design`

**Files:**
- Modify: `apps/cli/package.json` (add `@kunai/design` dependency)
- Modify: `apps/cli/src/app-shell/shell-theme.ts`
- Modify: `apps/cli/src/design.ts`

- [ ] **Step 1: Add dependency to CLI package.json**

Open `apps/cli/package.json`. In the `"dependencies"` block, add after the last `@kunai/*` entry:

```json
"@kunai/design": "workspace:*",
```

- [ ] **Step 2: Install**

```bash
bun install
```

Expected: lock file updated, no errors.

- [ ] **Step 3: Replace `shell-theme.ts` content**

Replace the entire file `apps/cli/src/app-shell/shell-theme.ts` with:

```ts
import { tokens } from "@kunai/design";

import type { ShellStatus } from "./types";

// palette maps token values to the property names used throughout app-shell.
// Keys are stable for backward compatibility; values come from @kunai/design.
export const palette = {
  bg:              tokens.bg,
  surface:         tokens.surface,
  surfaceElevated: tokens.surfaceElevated,
  surfaceActive:   tokens.surfaceActive,

  amber: tokens.amber,
  pink:  tokens.pink,

  // teal replaces cyan — callers using palette.cyan still work via alias
  cyan:  tokens.teal,
  teal:  tokens.teal,

  green: tokens.green,
  red:   tokens.red,
  rose:  tokens.amberSoft,

  // gray kept as alias for dim — callers using palette.gray still work
  gray:  tokens.dim,

  text:  tokens.text,
  muted: tokens.muted,
  dim:   tokens.dim,
} as const;

export const APP_LABEL = "🥷 Kunai beta";

export function statusColor(tone: ShellStatus["tone"] = "neutral"): string {
  switch (tone) {
    case "success": return palette.green;
    case "warning": return palette.amber;
    case "error":   return palette.red;
    default:        return palette.teal;
  }
}

export function hotkeyLabel(key: string): string {
  return `[${key}]`;
}
```

- [ ] **Step 4: Update `design.ts` — add `pink`, `teal`; switch to rounded box corners**

Open `apps/cli/src/design.ts`. Make these changes:

**4a.** In the `clr` object, add two entries after `clr.fox`:

```ts
// Hot pink — anime badge, discover highlight
pink: (s: string) => `\x1b[38;2;255;61;130m${s}\x1b[0m`,
// Teal — status, input cursor, info (replaces cyan semantically)
teal: (s: string) => `\x1b[38;2;61;224;196m${s}\x1b[0m`,
```

**4b.** Update the `box` object to use rounded Unicode corners:

```ts
export const box = {
  tl: "╭",
  tr: "╮",
  bl: "╰",
  br: "╯",
  h: "─",
  v: "│",
  ml: "├",
  mr: "┤",
  mt: "┬",
  mb: "┴",
};
```

- [ ] **Step 5: Typecheck**

```bash
cd apps/cli && bun run typecheck
```

Expected: no errors. If `palette.cyan` callers break, the alias in step 3 covers them — verify.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/package.json apps/cli/src/app-shell/shell-theme.ts apps/cli/src/design.ts bun.lock
git commit -m "feat: wire CLI to @kunai/design tokens; add pink/teal helpers; rounded box corners"
```

---

### Task 3: Anime content-type badge helper

**Files:**
- Modify: `apps/cli/src/design.ts`

The browse results currently show emoji type indicators. Add a text badge helper that callers can use to show a coloured `anime` / `series` / `movie` label in dense list rows.

- [ ] **Step 1: Add `contentBadge` to `design.ts`**

Append to `apps/cli/src/design.ts`:

```ts
// ── Content type badge ────────────────────────────────────────────────────────
//
// Hot-pink for anime, dim for series/movie — used in browse and discover rows.

export function contentBadge(type: "movie" | "series", isAnime: boolean): string {
  if (isAnime) return clr.pink("anime");
  if (type === "movie") return clr.dim("movie");
  return clr.dim("series");
}
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/cli && bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/design.ts
git commit -m "feat: add contentBadge helper for anime/series/movie labels"
```

---

## Phase 2 — Recommendations & Discover Feature

---

### Task 4: `RecommendationService` — interface, TMDB impl, file cache

**Files:**
- Create: `apps/cli/src/services/recommendations/RecommendationService.ts`
- Create: `apps/cli/src/services/recommendations/RecommendationServiceImpl.ts`
- Create: `apps/cli/test/unit/services/recommendations/recommendation-service.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/cli/test/unit/services/recommendations/recommendation-service.test.ts
import { describe, expect, test } from "bun:test";

import { buildRecommendCacheKey, isCacheExpired } from "@/services/recommendations/RecommendationServiceImpl";

describe("recommendation cache", () => {
  test("buildRecommendCacheKey includes id and type", () => {
    const key = buildRecommendCacheKey("438631", "movie");
    expect(key).toBe("recommend:movie:438631");
  });

  test("buildRecommendCacheKey uses 'trending' for trending section", () => {
    const key = buildRecommendCacheKey("trending", "trending");
    expect(key).toBe("recommend:trending:trending");
  });

  test("isCacheExpired returns true when cachedAt is older than ttl", () => {
    const old = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
    expect(isCacheExpired(old, 24 * 60 * 60 * 1000)).toBe(true);
  });

  test("isCacheExpired returns false when cachedAt is within ttl", () => {
    const recent = Date.now() - 1 * 60 * 60 * 1000; // 1 hour ago
    expect(isCacheExpired(recent, 24 * 60 * 60 * 1000)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

```bash
bun run test -- apps/cli/test/unit/services/recommendations/recommendation-service.test.ts
```

Expected: FAIL — `buildRecommendCacheKey` and `isCacheExpired` not found.

- [ ] **Step 3: Create the interface**

```ts
// apps/cli/src/services/recommendations/RecommendationService.ts
import type { ContentType } from "@/domain/types";
import type { SearchResult } from "@/domain/types";

export interface RecommendationSection {
  readonly label: string;
  readonly reason: "similar" | "trending" | "genre-affinity";
  readonly items: readonly SearchResult[];
}

export interface RecommendationService {
  /** TMDB /recommendations for a specific title. Cached 24 h. */
  getForTitle(tmdbId: string, type: ContentType): Promise<RecommendationSection>;
  /** TMDB /trending/all/week. Cached 6 h. */
  getTrending(): Promise<RecommendationSection>;
  /** Top-rated titles in the user's most-watched genres. Cached 24 h. */
  getGenreAffinity(topGenreIds: number[]): Promise<RecommendationSection>;
}
```

- [ ] **Step 4: Create the implementation**

```ts
// apps/cli/src/services/recommendations/RecommendationServiceImpl.ts
import { join } from "node:path";

import { getKunaiPaths } from "@kunai/storage";

import type { ContentType, SearchResult } from "@/domain/types";
import { writeAtomicJson } from "@/infra/fs/atomic-write";

import type { RecommendationSection, RecommendationService } from "./RecommendationService";

// ── Cache helpers (exported for tests) ────────────────────────────────────────

export function buildRecommendCacheKey(id: string, type: ContentType | "trending"): string {
  return `recommend:${type}:${id}`;
}

export function isCacheExpired(cachedAt: number, ttlMs: number): boolean {
  return Date.now() - cachedAt > ttlMs;
}

// ── TMDB constants (same as tmdb.ts) ──────────────────────────────────────────

const PROXY  = "https://db.videasy.net";
const DIRECT = "https://api.themoviedb.org/3";
const KEY    = "653bb8af90162bd98fc7ee32bcbbfb3d";
const TTL_SIMILAR   = 24 * 60 * 60 * 1000; // 24 h
const TTL_TRENDING  =  6 * 60 * 60 * 1000; //  6 h

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function tmdbFetch(path: string): Promise<unknown> {
  try {
    const res = await fetch(`${PROXY}${path}`);
    if (!res.ok) throw new Error(`proxy ${res.status}`);
    return await res.json();
  } catch {
    const res = await fetch(`${DIRECT}${path}?api_key=${KEY}`);
    if (!res.ok) throw new Error(`direct ${res.status}`);
    return await res.json();
  }
}

// ── File cache ────────────────────────────────────────────────────────────────

type CacheFile = Record<string, { cachedAt: number; items: readonly SearchResult[] }>;

function cachePath(): string {
  return join(getKunaiPaths().configDir, "recommendations-cache.json");
}

async function readCache(): Promise<CacheFile> {
  try {
    return await Bun.file(cachePath()).json() as CacheFile;
  } catch {
    return {};
  }
}

async function writeCache(cache: CacheFile): Promise<void> {
  await writeAtomicJson(cachePath(), cache);
}

// ── TMDB result → SearchResult ────────────────────────────────────────────────

function toSearchResult(item: Record<string, unknown>): SearchResult | null {
  const id = String(item["id"] ?? "");
  const mediaType = String(item["media_type"] ?? "");
  const title = String(item["title"] ?? item["name"] ?? "");
  const year = String(
    (item["release_date"] ?? item["first_air_date"] ?? "").toString().slice(0, 4),
  );
  if (!id || !title) return null;
  const type: ContentType = mediaType === "movie" ? "movie" : "series";
  return {
    id,
    type,
    title,
    year,
    overview: String(item["overview"] ?? ""),
    posterPath: item["poster_path"] ? String(item["poster_path"]) : null,
    rating: typeof item["vote_average"] === "number" ? item["vote_average"] : null,
  };
}

// ── Implementation ────────────────────────────────────────────────────────────

export class RecommendationServiceImpl implements RecommendationService {
  async getForTitle(tmdbId: string, type: ContentType): Promise<RecommendationSection> {
    const key = buildRecommendCacheKey(tmdbId, type);
    const cache = await readCache();
    const entry = cache[key];
    if (entry && !isCacheExpired(entry.cachedAt, TTL_SIMILAR)) {
      return { label: "", reason: "similar", items: entry.items };
    }

    const segment = type === "movie" ? "movie" : "tv";
    const data = (await tmdbFetch(`/${segment}/${tmdbId}/recommendations`)) as {
      results?: Record<string, unknown>[];
    };
    const items = (data.results ?? [])
      .map(toSearchResult)
      .filter((r): r is SearchResult => r !== null)
      .slice(0, 10);

    cache[key] = { cachedAt: Date.now(), items };
    await writeCache(cache);
    return { label: "", reason: "similar", items };
  }

  async getTrending(): Promise<RecommendationSection> {
    const key = buildRecommendCacheKey("trending", "trending");
    const cache = await readCache();
    const entry = cache[key];
    if (entry && !isCacheExpired(entry.cachedAt, TTL_TRENDING)) {
      return { label: "", reason: "trending", items: entry.items };
    }

    const data = (await tmdbFetch("/trending/all/week")) as {
      results?: Record<string, unknown>[];
    };
    const items = (data.results ?? [])
      .map(toSearchResult)
      .filter((r): r is SearchResult => r !== null)
      .slice(0, 10);

    cache[key] = { cachedAt: Date.now(), items };
    await writeCache(cache);
    return { label: "", reason: "trending", items };
  }

  async getGenreAffinity(topGenreIds: number[]): Promise<RecommendationSection> {
    if (topGenreIds.length === 0) return { label: "", reason: "genre-affinity", items: [] };

    const key = buildRecommendCacheKey(topGenreIds.join("-"), "genre-affinity" as ContentType);
    const cache = await readCache();
    const entry = cache[key];
    if (entry && !isCacheExpired(entry.cachedAt, TTL_SIMILAR)) {
      return { label: "", reason: "genre-affinity", items: entry.items };
    }

    const genres = topGenreIds.slice(0, 2).join(",");
    const data = (await tmdbFetch(
      `/discover/tv?with_genres=${genres}&sort_by=vote_average.desc&vote_count.gte=200`,
    )) as { results?: Record<string, unknown>[] };
    const items = (data.results ?? [])
      .map((r) => toSearchResult({ ...r, media_type: "tv" }))
      .filter((r): r is SearchResult => r !== null)
      .slice(0, 10);

    cache[key] = { cachedAt: Date.now(), items };
    await writeCache(cache);
    return { label: "", reason: "genre-affinity", items };
  }
}
```

- [ ] **Step 5: Run tests — should pass now**

```bash
bun run test -- apps/cli/test/unit/services/recommendations/recommendation-service.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 6: Typecheck**

```bash
cd apps/cli && bun run typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/services/recommendations/ apps/cli/test/unit/services/recommendations/
git commit -m "feat: add RecommendationService with TMDB impl and file cache"
```

---

### Task 5: Wire `RecommendationService` into the container

**Files:**
- Modify: `apps/cli/src/container.ts`

- [ ] **Step 1: Add import to `container.ts`**

In the imports section of `apps/cli/src/container.ts`, add after the `SearchRegistryImpl` import:

```ts
import type { RecommendationService } from "./services/recommendations/RecommendationService";
import { RecommendationServiceImpl } from "./services/recommendations/RecommendationServiceImpl";
```

- [ ] **Step 2: Add to `Container` interface**

Find the `export interface Container {` block and add:

```ts
readonly recommendationService: RecommendationService;
```

- [ ] **Step 3: Instantiate in `createContainer`**

Inside the `const container: Container = { ... }` object literal, add:

```ts
recommendationService: new RecommendationServiceImpl(),
```

- [ ] **Step 4: Typecheck**

```bash
cd apps/cli && bun run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/container.ts
git commit -m "feat: wire RecommendationService into container"
```

---

### Task 6: Register `discover` command

**Files:**
- Modify: `apps/cli/src/domain/session/command-registry.ts`
- Modify: `apps/cli/src/app-shell/types.ts`

- [ ] **Step 1: Add `"discover"` to `AppCommandId`**

In `apps/cli/src/domain/session/command-registry.ts`, find:

```ts
export type AppCommandId =
  | "search"
  | "trending"
```

Add `"discover"` after `"trending"`:

```ts
export type AppCommandId =
  | "search"
  | "trending"
  | "discover"
```

- [ ] **Step 2: Add the command definition to `COMMANDS`**

Find the entry for `"trending"` in the `COMMANDS` array and add after it:

```ts
{
  id: "discover",
  label: "Discover",
  aliases: ["discover", "recommendations", "recs", "suggest"],
  description: "Open personalised recommendations and trending content",
},
```

- [ ] **Step 3: Handle `discover` in `resolveCommands`**

In `command-registry.ts`, find the block where commands are resolved/enabled for each `AppCommandId`. If there is no special enable condition for discovery, add a case that always enables it:

Search for the switch or if-chain that sets `enabled` per command ID. Add:

```ts
case "discover":
  return { ...cmd, enabled: true };
```

If the command registry uses a filter/map that doesn't have per-command enable logic, no change is needed — `discover` will default to enabled.

- [ ] **Step 4: Add `"discover"` to `ShellAction` and `toShellAction`**

In `apps/cli/src/app-shell/types.ts`, add `"discover"` to the `ShellAction` union:

```ts
export type ShellAction =
  | "command-mode"
  | "search"
  | "trending"
  | "discover"       // ← add this line
  | "back-to-results"
  // ... rest unchanged
```

Then in the `toShellAction` function at the bottom of the same file, add:

```ts
case "discover":
  return "discover";
```

- [ ] **Step 5: Typecheck**

```bash
cd apps/cli && bun run typecheck
```

Expected: no errors. TypeScript will flag any switch exhaustiveness gaps in callers — fix them by adding `case "discover": return "unhandled";` or similar in `command-router.ts` if needed (the next task wires the real handler).

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/domain/session/command-registry.ts apps/cli/src/app-shell/types.ts
git commit -m "feat: register discover command and ShellAction"
```

---

### Task 7: `openDiscoverShell` — Ink component

**Files:**
- Create: `apps/cli/src/app-shell/discover-shell.tsx`
- Modify: `apps/cli/src/app-shell/ink-shell.tsx`
- Modify: `apps/cli/src/app-shell/command-router.ts`

- [ ] **Step 1: Create `discover-shell.tsx`**

```tsx
// apps/cli/src/app-shell/discover-shell.tsx
import { Box, Text, useInput, useStdout } from "ink";
import React, { useState } from "react";

import type { SearchResult } from "@/domain/types";
import { palette } from "./shell-theme";
import type { RecommendationSection } from "@/services/recommendations/RecommendationService";

export type DiscoverShellResult =
  | { type: "open"; result: SearchResult }
  | { type: "back" };

function DiscoverSectionView({
  section,
  isFocused,
  focusedIndex,
}: {
  section: RecommendationSection;
  isFocused: boolean;
  focusedIndex: number;
}) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={palette.amber} bold>
        {section.label}
      </Text>
      <Text color={palette.dim}>{"─".repeat(40)}</Text>
      {section.items.length === 0 ? (
        <Text color={palette.dim}>  No results</Text>
      ) : (
        section.items.map((item, idx) => {
          const isActive = isFocused && idx === focusedIndex;
          const badge =
            item.type === "series"
              ? `\x1b[38;2;255;61;130manime\x1b[0m`
              : `\x1b[2mseries\x1b[0m`;
          const rating = item.rating ? `★ ${item.rating.toFixed(1)}` : "";
          return (
            <Box key={item.id}>
              <Text
                backgroundColor={isActive ? palette.surfaceActive : undefined}
                color={isActive ? palette.text : palette.muted}
              >
                {`  ${isActive ? "▶" : " "} ${item.title.padEnd(28).slice(0, 28)} ${rating.padEnd(7)} ${item.year}`}
              </Text>
            </Box>
          );
        })
      )}
    </Box>
  );
}

export function DiscoverShell({
  sections,
  onResult,
}: {
  sections: RecommendationSection[];
  onResult: (result: DiscoverShellResult) => void;
}) {
  const [sectionIdx, setSectionIdx] = useState(0);
  const [itemIdx, setItemIdx] = useState(0);
  const { stdout } = useStdout();
  const sepWidth = Math.max(24, (stdout.columns ?? 80) - 4);

  const currentSection = sections[sectionIdx];
  const currentItems = currentSection?.items ?? [];

  useInput((_input, key) => {
    if (key.escape) {
      onResult({ type: "back" });
      return;
    }
    if (key.upArrow) {
      if (itemIdx > 0) setItemIdx((i) => i - 1);
      else if (sectionIdx > 0) {
        const prevSection = sections[sectionIdx - 1];
        setSectionIdx((s) => s - 1);
        setItemIdx((prevSection?.items.length ?? 1) - 1);
      }
      return;
    }
    if (key.downArrow) {
      if (itemIdx < currentItems.length - 1) setItemIdx((i) => i + 1);
      else if (sectionIdx < sections.length - 1) {
        setSectionIdx((s) => s + 1);
        setItemIdx(0);
      }
      return;
    }
    if (key.tab) {
      if (sectionIdx < sections.length - 1) {
        setSectionIdx((s) => s + 1);
        setItemIdx(0);
      }
      return;
    }
    if (key.return) {
      const item = currentSection?.items[itemIdx];
      if (item) onResult({ type: "open", result: item });
      return;
    }
  });

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      justifyContent="space-between"
      backgroundColor={palette.bg}
      paddingX={1}
    >
      <Box flexDirection="column" flexGrow={1}>
        <Box justifyContent="space-between">
          <Text bold color={palette.amber}>
            ⬡ Discover
          </Text>
        </Box>
        <Text color={palette.dim}>{"─".repeat(sepWidth)}</Text>
        <Box marginTop={1} flexDirection="column" flexGrow={1}>
          {sections.length === 0 ? (
            <Text color={palette.dim}>  Loading recommendations…</Text>
          ) : (
            sections.map((section, idx) => (
              <DiscoverSectionView
                key={section.reason + idx}
                section={section}
                isFocused={idx === sectionIdx}
                focusedIndex={itemIdx}
              />
            ))
          )}
        </Box>
      </Box>
      <Box>
        <Text color={palette.dim}>{"─".repeat(sepWidth)}</Text>
      </Box>
      <Box>
        <Text>
          <Text color={palette.amber}>↵</Text>
          <Text color={palette.muted}> open  </Text>
          <Text color={palette.amber}>tab</Text>
          <Text color={palette.muted}> next section  </Text>
          <Text color={palette.amber}>esc</Text>
          <Text color={palette.muted}> back</Text>
        </Text>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Add `openDiscoverShell` to `ink-shell.tsx`**

In `apps/cli/src/app-shell/ink-shell.tsx`, add an import for `DiscoverShell` and `DiscoverShellResult` at the top, then export a new function at the bottom of the file:

```ts
import {
  DiscoverShell,
  type DiscoverShellResult,
} from "./discover-shell";
```

Then add the function (alongside the other `open*Shell` functions):

```ts
export async function openDiscoverShell(
  sections: import("@/services/recommendations/RecommendationService").RecommendationSection[],
): Promise<DiscoverShellResult> {
  return new Promise((resolve) => {
    renderRoot(
      <DiscoverShell
        sections={sections}
        onResult={(result) => {
          resolve(result);
        }}
      />,
    );
  });
}
```

(Use the existing `renderRoot` helper that the other shell functions use — check the file to confirm the name.)

- [ ] **Step 3: Handle `"discover"` in `command-router.ts`**

In `apps/cli/src/app-shell/command-router.ts`, find `routeSearchShellAction`. After the `if (action === "trending") return "handled";` line, add:

```ts
if (action === "discover") return "handled";
```

Then find `routePlaybackShellAction` and add the same guard there.

These return `"handled"` without doing anything because the discover screen is opened by the caller in `main.ts` / `PlaybackPhase.ts` — the router just needs to not throw on the action.

- [ ] **Step 4: Typecheck**

```bash
cd apps/cli && bun run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/discover-shell.tsx apps/cli/src/app-shell/ink-shell.tsx apps/cli/src/app-shell/command-router.ts
git commit -m "feat: add DiscoverShell component and openDiscoverShell"
```

---

### Task 8: Extract `buildDiscoverSections` shared helper

**Files:**
- Create: `apps/cli/src/app/discover-sections.ts`

This helper is the single place that knows how to compose recommendation sections from history + service calls. Both the browse loop (`main.ts`) and the post-playback flow (`PlaybackPhase.ts`) call it — DRY.

- [ ] **Step 1: Create the helper**

```ts
// apps/cli/src/app/discover-sections.ts
import type { Container } from "@/container";
import type { RecommendationSection } from "@/services/recommendations/RecommendationService";

/**
 * Builds the full discover section list from history and TMDB.
 * Fetches in parallel; null sections (no history, no genres) are filtered out.
 */
export async function buildDiscoverSections(
  container: Pick<Container, "historyStore" | "recommendationService" | "stateManager">,
): Promise<readonly RecommendationSection[]> {
  const history = await container.historyStore.getAll();

  const mostRecentCompleted = Object.entries(history)
    .filter(([, entry]) => entry.completed)
    .sort((a, b) => new Date(b[1].watchedAt).getTime() - new Date(a[1].watchedAt).getTime())[0];

  const topGenreIds = container.stateManager
    .getState()
    .results.flatMap((r) => r.genreIds ?? [])
    .reduce<Map<number, number>>((tally, id) => tally.set(id, (tally.get(id) ?? 0) + 1), new Map());
  const topGenres = [...topGenreIds.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => id);

  const results = await Promise.all([
    mostRecentCompleted
      ? container.recommendationService
          .getForTitle(mostRecentCompleted[0], mostRecentCompleted[1].type)
          .then((s) => ({ ...s, label: `Because you watched ${mostRecentCompleted[1].title}` }))
      : null,
    container.recommendationService
      .getTrending()
      .then((s) => ({ ...s, label: "Trending this week" })),
    topGenres.length > 0
      ? container.recommendationService
          .getGenreAffinity(topGenres)
          .then((s) => ({ ...s, label: "From your watch pattern" }))
      : null,
  ]);

  return results.filter((s): s is RecommendationSection => s !== null);
}
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/cli && bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/app/discover-sections.ts
git commit -m "feat: extract buildDiscoverSections shared helper"
```

---

### Task 9: Wire `discover` action in `main.ts` browse flow

**Files:**
- Modify: `apps/cli/src/main.ts`

The browse loop in `main.ts` handles `ShellAction` results. Add handling for `"discover"` using the shared helper.

- [ ] **Step 1: Find the action dispatch loop in `main.ts`**

Search for the block that handles `"trending"`. It will look like:

```ts
} else if (action === "trending") {
  // ... loads trending results
}
```

- [ ] **Step 2: Add a `"discover"` branch after `"trending"`**

```ts
} else if (action === "discover") {
  const { openDiscoverShell } = await import("./app-shell/ink-shell");
  const { buildDiscoverSections } = await import("./app/discover-sections");

  const sections = await buildDiscoverSections(container);
  const discoverResult = await openDiscoverShell(sections);

  if (discoverResult.type === "open") {
    container.stateManager.dispatch({
      type: "SET_RESULTS",
      results: [discoverResult.result],
      query: discoverResult.result.title,
    });
  }
  continue; // back to browse loop
}
```

> **Note:** Adapt the `continue` / loop structure to match the actual loop pattern in `main.ts`. The browse loop is a `while (true)` or labelled loop — use whichever break/continue form the surrounding code uses.

- [ ] **Step 3: Typecheck**

```bash
cd apps/cli && bun run typecheck
```

Expected: no errors. Fix any missing imports.

- [ ] **Step 4: Smoke test manually**

```bash
bun run dev
```

Type `/` → `discover` → press Enter. The Discover screen should open and populate with trending results. Press `esc` to return to browse.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/main.ts
git commit -m "feat: wire discover action in browse session loop"
```

---

### Task 10: Post-playback series-complete nudge

**Files:**
- Modify: `apps/cli/src/app-shell/types.ts`
- Modify: `apps/cli/src/app/PlaybackPhase.ts`

When both `episodeNavigation.hasNext` and `episodeNavigation.hasNextSeason` are false after a completed playback, surface `"discover"` as the first post-playback action.

- [ ] **Step 1: Add `showDiscoverNudge` to `PlaybackShellState`**

In `apps/cli/src/app-shell/types.ts`, find `PlaybackShellState` and add:

```ts
readonly showDiscoverNudge?: boolean;
```

- [ ] **Step 2: Pass `showDiscoverNudge` from `PlaybackPhase.ts`**

In `apps/cli/src/app/PlaybackPhase.ts`, find the `openPlaybackShell({ state: { ... } })` call (around line 1204). Add `showDiscoverNudge` to the `state` object:

```ts
showDiscoverNudge:
  title.type === "series" &&
  !episodeAvailability.nextEpisode &&
  isFinished(
    await container.historyStore.get(title.id).then((e) => e ?? null) as import("@/services/persistence/HistoryStore").HistoryEntry,
  ),
```

Because `isFinished` requires a `HistoryEntry`, read it inline. If the entry is null (history not saved yet), default to false:

```ts
showDiscoverNudge: await (async () => {
  if (title.type !== "series") return false;
  if (episodeAvailability.nextEpisode) return false;
  const entry = await container.historyStore.get(title.id);
  return entry ? isFinished(entry) : false;
})(),
```

- [ ] **Step 3: Add `"discover"` to the post-playback command list**

In the same `openPlaybackShell` call, in the `commands: resolveCommands(...)` array, add `"discover"` after `"search"`:

```ts
"search",
"discover",  // ← add
"settings",
```

- [ ] **Step 4: Handle `"discover"` in the `postPlayback` loop**

In `PlaybackPhase.ts`, find where routed actions are handled after the `postPlayback:` label. Add:

```ts
} else if (postAction === "discover") {
  const { openDiscoverShell } = await import("../app-shell/ink-shell");
  const { buildDiscoverSections } = await import("./discover-sections");

  const sections = await buildDiscoverSections(container);
  await openDiscoverShell(sections);
  continue postPlayback;
}
```

- [ ] **Step 5: Typecheck**

```bash
cd apps/cli && bun run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/app-shell/types.ts apps/cli/src/app/PlaybackPhase.ts
git commit -m "feat: post-playback discover nudge on series complete"
```

---

### Task 11: Config additions — flat `KitsuneConfig` fields

**Files:**
- Modify: `apps/cli/src/services/persistence/ConfigService.ts`
- Modify: `apps/cli/src/services/persistence/ConfigServiceImpl.ts`

All new config fields go directly into the flat `KitsuneConfig` interface — no nested objects — consistent with existing fields like `autoNext`, `showMemory`, `footerHints`.

- [ ] **Step 1: Add fields to `KitsuneConfig`**

In `apps/cli/src/services/persistence/ConfigService.ts`, add to the `KitsuneConfig` interface:

```ts
/** Show a faint "/ discover" hint in the browse footer when history is non-empty. Default false. */
discoverShowOnStartup: boolean;
/** Collapse the companion pane, minimal footer, and dim header status regardless of terminal size. Default false. */
minimalMode: boolean;
```

- [ ] **Step 2: Add defaults in `ConfigServiceImpl.ts`**

Find the default config object in `apps/cli/src/services/persistence/ConfigServiceImpl.ts`. Add:

```ts
discoverShowOnStartup: false,
minimalMode: false,
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/cli && bun run typecheck
```

Expected: no errors. TypeScript will flag any callers that spread `KitsuneConfig` without the new field — add the default there too.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/services/persistence/ConfigService.ts apps/cli/src/services/persistence/ConfigServiceImpl.ts
git commit -m "feat: add discover config block with showOnStartup and refreshOnOpen"
```

---

### Task 12: Startup hint (behind `discoverShowOnStartup`)

**Files:**
- Modify: `apps/cli/src/app-shell/ink-shell.tsx` (or wherever the browse footer is assembled)

- [ ] **Step 1: Find where the browse shell footer is built**

Search `apps/cli/src/app-shell/ink-shell.tsx` for `footerActions` construction for the browse/search shell. It will produce an array of `FooterAction` objects.

- [ ] **Step 2: Add a conditional dim hint line**

Below the footer actions, add a second line rendered only when `config.discover.showOnStartup && historyNonEmpty`:

```tsx
{config.discoverShowOnStartup && hasHistory && (
  <Text color={palette.dim}>/ discover  ·  based on your history</Text>
)}
```

Pass `hasHistory` by checking if `Object.keys(historyStore.getAll()).length > 0` before rendering — you can derive this from whatever history snapshot the browse shell already has. If the shell doesn't already have history available at render time, skip this step for now; it's a polish item.

- [ ] **Step 3: Typecheck**

```bash
cd apps/cli && bun run typecheck
```

Expected: no errors.

- [ ] **Step 4: Run full suite**

```bash
bun run typecheck && bun run lint && bun run test
```

Expected: all pass.

- [ ] **Step 5: Final commit**

```bash
git add apps/cli/src/app-shell/ink-shell.tsx
git commit -m "feat: show optional discover startup hint when showOnStartup is true"
```

---

---

### Task 13: Minimal mode

**Files:**
- Modify: `apps/cli/src/container.ts` (`effectiveFooterHints`)
- Modify: `apps/cli/src/app-shell/layout-policy.ts`
- Modify: `apps/cli/src/app-shell/ink-shell.tsx`

Minimal mode is a single `KitsuneConfig.minimalMode` flag (added in Task 11) that wires into three existing abstractions:

1. **`effectiveFooterHints`** — already the canonical way callers read footer density; fix its stub to respect config
2. **`getShellViewportPolicy`** — already controls companion-pane visibility via `wideBrowse`; add a `forceCompact` option so callers can honour `minimalMode` without duplicating the flag check
3. **Header status** — `ShellFrame` already accepts a `status` prop; callers suppress it when `minimalMode` is true

No new abstractions. No parallel mechanisms.

- [ ] **Step 1: Fix `effectiveFooterHints` in `container.ts`**

The current implementation ignores its argument and always returns `"minimal"`. Fix it to honour both `shellChrome` and `minimalMode`:

```ts
export function effectiveFooterHints(
  container: Pick<Container, "config" | "shellChrome">,
): "detailed" | "minimal" {
  if (container.config.minimalMode) return "minimal";
  if (container.shellChrome === "minimal" || container.shellChrome === "quick") return "minimal";
  return container.config.footerHints;
}
```

- [ ] **Step 2: Add `forceCompact` to `getShellViewportPolicy`**

In `apps/cli/src/app-shell/layout-policy.ts`, add an optional third argument and set `wideBrowse` to `false` when it is true:

```ts
export function getShellViewportPolicy(
  kind: ShellViewportKind,
  columns: number,
  rows: number,
  options: { forceCompact?: boolean } = {},
): ShellViewportPolicy {
  const forceCompact = options.forceCompact ?? false;
  const compact = forceCompact || columns < 110 || rows < 34;
  const ultraCompact = forceCompact || columns < 92 || rows < 28;
  const wideBrowse = !forceCompact && kind === "browse" && columns >= 164 && rows >= 30;
  // ... rest of function body unchanged
```

The rest of the function body stays identical. Only the first three derived variables change.

- [ ] **Step 3: Run tests to confirm layout policy still passes**

```bash
bun run test -- apps/cli/test/unit/app-shell
```

Expected: all pass. (If no layout-policy unit tests exist, skip — the typecheck in step 5 is sufficient.)

- [ ] **Step 4: Pass `forceCompact` at the browse shell call site in `ink-shell.tsx`**

Find the call to `getShellViewportPolicy("browse", ...)` in `ink-shell.tsx` (around line 1859 per the file map). Update it:

```ts
// Before
const { wideBrowse, ... } = getShellViewportPolicy("browse", stdout.columns, stdout.rows);

// After — thread minimalMode from the config the shell already has access to
const { wideBrowse, ... } = getShellViewportPolicy(
  "browse",
  stdout.columns,
  stdout.rows,
  { forceCompact: config.minimalMode },
);
```

Also find the second `getShellViewportPolicy("browse", ...)` call around line 1689 (the `enabled` check for the poster image pane) and apply the same change:

```ts
enabled: getShellViewportPolicy(
  "browse",
  stdout.columns,
  stdout.rows,
  { forceCompact: config.minimalMode },
).wideBrowse,
```

- [ ] **Step 5: Suppress header status detail in minimal mode**

`ShellFrame` accepts a `status` prop of type `ShellStatus | undefined`. When it is `undefined`, the status area is already hidden. At the call sites in `ink-shell.tsx` that pass a `status` to `ShellFrame` during browse, wrap it:

```ts
status: config.minimalMode ? undefined : currentStatus,
```

This uses the existing prop contract — no new props needed.

- [ ] **Step 6: Typecheck**

```bash
cd apps/cli && bun run typecheck
```

Expected: no errors. Fix any call sites where `getShellViewportPolicy` is called without the new optional arg — it defaults to `{}` so no changes are strictly required, but update any callers inside `ink-shell.tsx` that already destructure the result to confirm they still compile.

- [ ] **Step 7: Smoke test both modes**

```bash
# Normal mode
bun run dev

# Minimal mode — set via config or pass a flag if one is wired
bun run dev -- --minimal
```

Expected in minimal mode: no companion pane, footer shows only `/ commands`, no status badge in header.

- [ ] **Step 8: Final typecheck + lint + test**

```bash
bun run typecheck && bun run lint && bun run test
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add apps/cli/src/container.ts apps/cli/src/app-shell/layout-policy.ts apps/cli/src/app-shell/ink-shell.tsx
git commit -m "feat: minimal mode — forceCompact layout, minimal footer, no header status"
```

---

---

### Task 14: Fullscreen TUI resilience — viewport hook + resize safety in DiscoverShell

**Files:**
- Create: `apps/cli/src/app-shell/use-viewport-policy.ts`
- Modify: `apps/cli/src/app-shell/discover-shell.tsx`

**Context:** `ResizeBlocker`, `getShellViewportPolicy`, and the `tooSmall` guard are already used consistently in the browse, playback, and picker shells. This task closes the gap for `DiscoverShell` (which lacks resize protection) and extracts the `useStdout() + getShellViewportPolicy` boilerplate into a single shared hook so all shells — including new ones — don't repeat it.

- [ ] **Step 1: Create `useViewportPolicy` hook**

```ts
// apps/cli/src/app-shell/use-viewport-policy.ts
import { useStdout } from "ink";

import {
  getShellViewportPolicy,
  type ShellViewportKind,
  type ShellViewportPolicy,
} from "./layout-policy";

/**
 * Returns a live viewport policy that re-evaluates on every terminal resize.
 * Ink re-renders components that call useStdout() when the terminal size changes,
 * so this hook is automatically reactive.
 */
export function useViewportPolicy(
  kind: ShellViewportKind,
  options: { forceCompact?: boolean } = {},
): ShellViewportPolicy {
  const { stdout } = useStdout();
  return getShellViewportPolicy(
    kind,
    stdout.columns ?? 80,
    stdout.rows ?? 24,
    options,
  );
}
```

- [ ] **Step 2: Update `DiscoverShell` to use the hook and show `ResizeBlocker`**

Replace the `useStdout()` call at the top of `DiscoverShell` in `discover-shell.tsx` with `useViewportPolicy`, and add the resize guard before rendering any content:

```tsx
// Add to imports
import { useViewportPolicy } from "./use-viewport-policy";
import { ResizeBlocker } from "./shell-primitives";

// Inside DiscoverShell component, replace:
//   const { stdout } = useStdout();
//   const sepWidth = Math.max(24, (stdout.columns ?? 80) - 4);
// with:

export function DiscoverShell({ sections, onResult }: {
  sections: RecommendationSection[];
  onResult: (result: DiscoverShellResult) => void;
}) {
  const [sectionIdx, setSectionIdx] = useState(0);
  const [itemIdx, setItemIdx] = useState(0);
  const viewport = useViewportPolicy("browse");
  const sepWidth = Math.max(24, viewport.minColumns - 4);

  // ... existing useInput hook unchanged ...

  if (viewport.tooSmall) {
    return (
      <ResizeBlocker
        minColumns={viewport.minColumns}
        minRows={viewport.minRows}
      />
    );
  }

  // ... rest of JSX unchanged ...
}
```

- [ ] **Step 3: Add `truncateLabel` helper to `design.ts`**

Text in dense list rows can overflow and cause line-wrap on resize. Add a single helper for row label clamping — callers use this instead of inline `.slice()`:

```ts
// apps/cli/src/design.ts
// ── Label truncation ──────────────────────────────────────────────────────────
//
// Clamps a label to maxWidth with an ellipsis so list rows never wrap.

export function truncateLabel(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  return `${text.slice(0, maxWidth - 1)}…`;
}
```

Then update the row rendering inside `DiscoverSectionView` to use it:

```ts
// Before:
`  ${isActive ? "▶" : " "} ${item.title.padEnd(28).slice(0, 28)} ${rating.padEnd(7)} ${item.year}`

// After:
`  ${isActive ? "▶" : " "} ${truncateLabel(item.title, 28).padEnd(28)} ${rating.padEnd(7)} ${item.year}`
```

- [ ] **Step 4: Audit existing callers of `useStdout` + `getShellViewportPolicy` in `ink-shell.tsx`**

Search `ink-shell.tsx` for the pattern:

```ts
const { stdout } = useStdout();
// ...
getShellViewportPolicy(kind, stdout.columns, stdout.rows)
```

For each occurrence, replace with `useViewportPolicy(kind)`. This eliminates the repeated boilerplate while keeping behaviour identical — Ink's `useStdout()` reactive update path is preserved inside the hook.

> **Note:** Don't replace `useStdout()` calls that are used for other purposes (e.g. reading `stdout.columns` for separator widths unrelated to viewport policy). Only replace the `useStdout + getShellViewportPolicy` pairing.

- [ ] **Step 5: Typecheck**

```bash
cd apps/cli && bun run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/app-shell/use-viewport-policy.ts apps/cli/src/app-shell/discover-shell.tsx apps/cli/src/design.ts apps/cli/src/app-shell/ink-shell.tsx
git commit -m "feat: useViewportPolicy hook + ResizeBlocker in DiscoverShell + truncateLabel"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| `@kunai/design` token package | Task 1 |
| `shell-theme.ts` imports from `@kunai/design` | Task 2 |
| `clr.pink`, `clr.teal` added to `design.ts` | Task 2 |
| Rounded box corners | Task 2 |
| `contentBadge` anime helper | Task 3 |
| `RecommendationService` interface | Task 4 |
| TMDB `/recommendations`, `/trending`, `/discover` | Task 4 |
| File cache with 24h/6h TTL | Task 4 |
| Wired into container | Task 5 |
| `"discover"` command + `ShellAction` | Task 6 |
| Discover screen Ink component (`DiscoverSectionView`) | Task 7 |
| `buildDiscoverSections` shared helper (DRY) | Task 8 |
| Browse loop handles `"discover"` | Task 9 |
| Post-playback series-complete nudge | Task 10 |
| Flat `KitsuneConfig` fields (`discoverShowOnStartup`, `minimalMode`) | Task 11 |
| Startup hint behind `discoverShowOnStartup` | Task 12 |
| Minimal mode: `forceCompact` layout, `effectiveFooterHints`, no header status | Task 13 |
| `useViewportPolicy` hook, `ResizeBlocker` in `DiscoverShell`, `truncateLabel` | Task 14 |

All spec requirements covered. No TBDs. All new config fields are flat in `KitsuneConfig`. `buildDiscoverSections` is defined once. `DiscoverSectionView` replaces the generic `SectionList` name. `effectiveFooterHints` is fixed rather than bypassed.
