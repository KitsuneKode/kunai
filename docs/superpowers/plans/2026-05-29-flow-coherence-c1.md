# Flow Coherence — Phase C1 (PlayableRef + buildPlayIntent core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the pure foundation that fixes the movie-misclassification bug class — a `PlayableRef` identity, a `PlayIntent`, and a pure `buildPlayIntent()` that enforces "movie ⇒ no episode, no autoplay" and decouples content `mediaKind` from provider `mode` — with the full permutation matrix as tests. Purely additive; no wiring yet, build stays green.

**Architecture:** A pure function `buildPlayIntent(ref)` maps a surface-agnostic `PlayableRef` to a `PlayIntent` consumed (in Phase C2) by the playback pipeline. No IO, fully unit-testable. The permutation matrix (`mediaKind × inputs`) is encoded directly as tests, including the regression guard that a movie ref can never produce an episode even if a buggy caller supplies season/episode.

**Tech Stack:** TypeScript, Bun, `bun:test`. Types from `@kunai/types` (`MediaKind`, `ProviderExternalIds`) and `@/domain/types` (`ShellMode`).

**Spec:** `docs/superpowers/specs/2026-05-29-flow-coherence-design.md`

---

## Background the engineer needs

- `MediaKind = "movie" | "series" | "anime"` is exported from `@kunai/types`.
- `ShellMode = "series" | "anime"` is exported from `@/domain/types` — it is **provider routing only** (anime providers vs general); `"series"` is the non-anime/general category used for both movies and series.
- `ProviderExternalIds` is exported from `@kunai/types`.
- The existing `PlaybackStartIntent` (`@/app/playback-start-intent`) is a _resume-position_ shape only — do not confuse it with the new `PlayIntent` (broader: mode, mediaKind, episode, autoplay).
- Tests use `bun:test` (`import { expect, test } from "bun:test"`). Run one file: `cd apps/cli && bun test test/unit/domain/playback/playable-ref.test.ts`.
- Path alias `@/` = `apps/cli/src/`.
- **Phase C1 is additive only.** Do not modify the session reducer, `TitleInfo`, `launch-entry.ts`, `session-flow.ts`, or any surface. Those are Phase C2.

---

## File structure (Phase C1)

- Create `apps/cli/src/domain/playback/playable-ref.ts` — `PlayableRef`, `PlayableSource`, `PlayIntent`, `buildPlayIntent`.
- Test `apps/cli/test/unit/domain/playback/playable-ref.test.ts`.

---

## Task 1: PlayableRef + PlayIntent + buildPlayIntent

**Files:**

- Create: `apps/cli/src/domain/playback/playable-ref.ts`
- Test: `apps/cli/test/unit/domain/playback/playable-ref.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";

import { buildPlayIntent, type PlayableRef } from "@/domain/playback/playable-ref";

function ref(overrides: Partial<PlayableRef> = {}): PlayableRef {
  return {
    titleId: "tmdb:1",
    mediaKind: "series",
    title: "Example",
    source: "search",
    ...overrides,
  };
}

test("movie ref produces NO episode and autoplay disabled (the bug guard)", () => {
  const intent = buildPlayIntent(ref({ mediaKind: "movie", title: "Transformers" }));
  expect(intent.episode).toBeUndefined();
  expect(intent.autoplayEligible).toBe(false);
  expect(intent.mode).toBe("series"); // general-provider routing, NOT a content label
});

test("movie ref drops season/episode even if a buggy caller supplies them", () => {
  const intent = buildPlayIntent(
    ref({ mediaKind: "movie", season: 1, episode: 1, absoluteEpisode: 1 }),
  );
  expect(intent.episode).toBeUndefined();
  expect(intent.autoplayEligible).toBe(false);
});

test("series ref carries its episode and enables autoplay", () => {
  const intent = buildPlayIntent(ref({ mediaKind: "series", season: 2, episode: 5 }));
  expect(intent.episode).toEqual({ season: 2, episode: 5 });
  expect(intent.autoplayEligible).toBe(true);
  expect(intent.mode).toBe("series");
});

test("series first-watch with no episode defaults to S1E1", () => {
  const intent = buildPlayIntent(ref({ mediaKind: "series" }));
  expect(intent.episode).toEqual({ season: 1, episode: 1 });
});

test("anime ref routes to anime mode and uses absoluteEpisode when episode is absent", () => {
  const intent = buildPlayIntent(ref({ mediaKind: "anime", absoluteEpisode: 64 }));
  expect(intent.mode).toBe("anime");
  expect(intent.autoplayEligible).toBe(true);
  expect(intent.episode).toEqual({ season: 1, episode: 64, absoluteEpisode: 64 });
});

test("resumeSeconds passes through; absent means fresh (0)", () => {
  expect(buildPlayIntent(ref({ resumeSeconds: 743 })).resumeSeconds).toBe(743);
  expect(buildPlayIntent(ref()).resumeSeconds).toBe(0);
  expect(buildPlayIntent(ref({ resumeSeconds: -5 })).resumeSeconds).toBe(0);
});

test("identity fields and provider hint pass through", () => {
  const intent = buildPlayIntent(
    ref({ providerHint: "vidking", externalIds: { tmdbId: "1" }, source: "recommendation" }),
  );
  expect(intent.providerHint).toBe("vidking");
  expect(intent.externalIds).toEqual({ tmdbId: "1" });
  expect(intent.source).toBe("recommendation");
  expect(intent.titleId).toBe("tmdb:1");
  expect(intent.title).toBe("Example");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun test test/unit/domain/playback/playable-ref.test.ts`
Expected: FAIL — cannot resolve module `@/domain/playback/playable-ref`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/cli/src/domain/playback/playable-ref.ts
import type { MediaKind, ProviderExternalIds } from "@kunai/types";

import type { ShellMode } from "@/domain/types";

export type PlayableSource =
  | "search"
  | "history"
  | "continue"
  | "recommendation"
  | "trending"
  | "queue"
  | "offline"
  | "calendar";

/**
 * Surface-agnostic "play this" identity. Every surface builds a PlayableRef and
 * calls the single play() entry (Phase C2). `mediaKind` is content truth; it is
 * the only thing that decides labels / episode / autoplay — never ShellMode.
 */
export interface PlayableRef {
  readonly titleId: string;
  readonly mediaKind: MediaKind;
  readonly title: string;
  readonly season?: number; // series/anime only
  readonly episode?: number; // series/anime only
  readonly absoluteEpisode?: number;
  readonly externalIds?: ProviderExternalIds;
  readonly providerHint?: string;
  readonly resumeSeconds?: number;
  readonly source: PlayableSource;
}

export interface PlayIntentEpisode {
  readonly season: number;
  readonly episode: number;
  readonly absoluteEpisode?: number;
}

export interface PlayIntent {
  readonly titleId: string;
  readonly title: string;
  readonly mediaKind: MediaKind;
  /** Provider routing only. `"anime"` for anime, `"series"` (general) otherwise. */
  readonly mode: ShellMode;
  /** Present for series/anime, ALWAYS undefined for movie. */
  readonly episode?: PlayIntentEpisode;
  readonly autoplayEligible: boolean;
  /** 0 = start fresh. */
  readonly resumeSeconds: number;
  readonly providerHint?: string;
  readonly externalIds?: ProviderExternalIds;
  readonly source: PlayableSource;
}

/**
 * Pure mapping from a PlayableRef to a PlayIntent. Enforces the invariants that
 * fix the movie-misclassification bug class:
 *  - movie ⇒ no episode, autoplay disabled (regardless of supplied season/episode);
 *  - mode is derived from mediaKind for provider routing only;
 *  - series/anime default to S1E1 on first watch; anime falls back to absoluteEpisode.
 */
export function buildPlayIntent(ref: PlayableRef): PlayIntent {
  const mode: ShellMode = ref.mediaKind === "anime" ? "anime" : "series";
  const isMovie = ref.mediaKind === "movie";

  const episode: PlayIntentEpisode | undefined = isMovie
    ? undefined
    : {
        season: ref.season ?? 1,
        episode: ref.episode ?? ref.absoluteEpisode ?? 1,
        ...(ref.absoluteEpisode === undefined ? {} : { absoluteEpisode: ref.absoluteEpisode }),
      };

  const resumeSeconds =
    typeof ref.resumeSeconds === "number" &&
    Number.isFinite(ref.resumeSeconds) &&
    ref.resumeSeconds > 0
      ? ref.resumeSeconds
      : 0;

  return {
    titleId: ref.titleId,
    title: ref.title,
    mediaKind: ref.mediaKind,
    mode,
    episode,
    autoplayEligible: !isMovie,
    resumeSeconds,
    providerHint: ref.providerHint,
    externalIds: ref.externalIds,
    source: ref.source,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/cli && bun test test/unit/domain/playback/playable-ref.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/domain/playback/playable-ref.ts apps/cli/test/unit/domain/playback/playable-ref.test.ts
git commit -m "feat(playback): PlayableRef + pure buildPlayIntent (movie/series/anime invariants)"
```

---

## Task 2: Phase gate — full verification

- [ ] **Step 1: Run the new tests**

Run: `cd apps/cli && bun test test/unit/domain/playback/playable-ref.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 2: Typecheck, lint, full test, build**

Run (from repo root):

```bash
bun run typecheck
bun run lint
bun run test
bun run build
```

Expected: all PASS. No existing test changes — Phase C1 is additive (no session/UI/intake wiring touched).

- [ ] **Step 3: Final commit (if lint/fmt adjusted anything)**

```bash
git add -A
git commit -m "chore(playback): phase C1 verification" || echo "nothing to commit"
```

---

## Self-review notes (for the author)

- **Spec coverage:** Pillar 2 (`PlayableRef` + intent) → Task 1. Pillar 1 invariant (mediaKind decoupled from mode; movie ⇒ no episode/autoplay) → enforced in `buildPlayIntent` + guarded by the "drops season/episode even if supplied" test. Pillar 3 (permutation matrix) → the test cases ARE the matrix at the intent level.
- **Out of scope (Phase C2):** session-state `mediaKind`, routing `play(ref)` through `buildPlayIntent`, fixing the Now-Playing header / autoplay / continue to read `mediaKind`, migrating surface call sites, the intake misclassification fix. **(Phase C3):** consolidated Source-control overlay + per-episode cache escape hatch. These need reads of the session reducer, `ink-shell`, and the surface call sites, and will be their own plans.
- **Type consistency:** `PlayableRef` / `PlayableSource` / `PlayIntent` / `PlayIntentEpisode` / `buildPlayIntent` names are used identically in code and tests; `mode` values stay within `ShellMode` (`"series" | "anime"`).
