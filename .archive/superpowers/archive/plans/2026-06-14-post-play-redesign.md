# Post-play Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the post-playback surface into a state-aware "what next?" screen — a Next-Up hero card with a live autoplay countdown, recommendation poster tiles, and a series-complete celebration with an optional watch-time stat.

**Architecture:** Preserve the pure view-model (`post-play-view.ts`) + render-only component (`post-play-shell.tsx`) split. New derivation goes in the builder; new visuals are render-only. The live countdown and watch-time stat flow through new `SessionState` fields dispatched by `PlaybackPhase` and read at the `ink-shell.tsx` render site — the same pattern existing post-play props already use.

**Tech Stack:** Bun, Ink 7 (React 19), `bun run test` (Bun test runner), `captureFrame` harness (`apps/cli/test/harness/render-capture.ts`), `usePosterPreview` (chafa text mini-posters), `resolveCatalogPosterUrl`.

**Spec:** `docs/superpowers/specs/2026-06-14-post-play-redesign-design.md`

**Working dir for all commands:** `cd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli` (turbo at repo root cannot resolve `bun run test <path>`).

---

## File Structure

| File                                                        | Responsibility                                                                         | Action        |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------- |
| `apps/cli/src/app-shell/post-play-view.ts`                  | View-model: pick poster URLs, hero next-up model, watch-time placement, celebration    | Modify        |
| `apps/cli/src/app-shell/post-play-shell.tsx`                | Render: Next-Up hero card, poster pick tiles, celebration banner, keys footer          | Modify        |
| `apps/cli/src/app-shell/post-play-watch-time.ts`            | Pure watch-time aggregator + formatter                                                 | Create        |
| `apps/cli/src/app-shell/types.ts`                           | `PlaybackRecommendationRailItem` already has `posterPath` (no change); add nothing     | —             |
| `apps/cli/src/domain/session/SessionState.ts`               | `autoNextCountdownSeconds`, `watchTimeSummary` fields + reducer actions                | Modify        |
| `apps/cli/src/app/PlaybackPhase.ts`                         | Dispatch countdown seconds on tick; aggregate + dispatch watch-time on series-complete | Modify        |
| `apps/cli/src/app-shell/ink-shell.tsx`                      | Pass new state fields as `PostPlayShell` props                                         | Modify        |
| `apps/cli/src/services/persistence/ConfigService.ts`        | `showWatchTimeStats` field on `KitsuneConfig`                                          | Modify        |
| `apps/cli/src/services/persistence/ConfigStore.ts`          | Default `showWatchTimeStats: true`                                                     | Modify        |
| `apps/cli/src/services/persistence/ConfigServiceImpl.ts`    | `get showWatchTimeStats()`                                                             | Modify        |
| `apps/cli/src/services/persistence/config-metadata.ts`      | Metadata entry for `showWatchTimeStats`                                                | Modify        |
| `apps/cli/test/unit/app-shell/post-play-view.test.ts`       | View-model assertions                                                                  | Modify        |
| `apps/cli/test/unit/app-shell/post-play-watch-time.test.ts` | Aggregator/formatter                                                                   | Create        |
| `apps/cli/test/unit/app-shell/post-play-shell.test.tsx`     | Frame snapshots across breakpoints                                                     | Modify/Create |

---

## Task 1: Recommendation pick posters in the view-model

**Files:**

- Modify: `apps/cli/src/app-shell/post-play-view.ts` (`PostPlayDiscoveryCard`, `buildDiscovery`)
- Test: `apps/cli/test/unit/app-shell/post-play-view.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `post-play-view.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { buildPostPlayView } from "@/app-shell/post-play-view";

describe("buildDiscovery posters", () => {
  it("resolves a TMDB posterUrl from posterPath", () => {
    const view = buildPostPlayView({
      title: "Show",
      episodeLabel: "S01 E01",
      postPlayState: { kind: "mid-series" },
      recommendations: [
        { id: "r1", title: "Frieren", type: "series", posterPath: "/abc.jpg", year: "2023" },
      ],
    });
    expect(view.discovery[0]?.posterUrl).toBe("https://image.tmdb.org/t/p/w185/abc.jpg");
  });

  it("leaves posterUrl undefined when posterPath absent", () => {
    const view = buildPostPlayView({
      title: "Show",
      episodeLabel: "S01 E01",
      postPlayState: { kind: "mid-series" },
      recommendations: [{ id: "r1", title: "Frieren", type: "series", year: "2023" }],
    });
    expect(view.discovery[0]?.posterUrl).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli && bun run test test/unit/app-shell/post-play-view.test.ts`
Expected: FAIL — `posterUrl` is `undefined` (property does not exist yet).

- [ ] **Step 3: Implement**

In `post-play-view.ts`, add the import at top:

```ts
import { resolveCatalogPosterUrl } from "@/domain/catalog/resolve-catalog-poster-url";
```

Add `posterUrl` to the type:

```ts
export type PostPlayDiscoveryCard = {
  readonly id: string;
  readonly index: number; // 1-based for display
  readonly title: string;
  readonly reason: string; // dim snippet: overview excerpt or year
  readonly posterUrl?: string;
};
```

Update `buildDiscovery`:

```ts
function buildDiscovery(
  recs: readonly PlaybackRecommendationRailItem[],
): readonly PostPlayDiscoveryCard[] {
  return recs.slice(0, 3).map((rec, i) => {
    const reason = rec.overview
      ? (rec.overview.split(/[.!?]/u)[0]?.trim().slice(0, 44) ?? rec.year ?? "")
      : (rec.year ?? "");
    const posterUrl = resolveCatalogPosterUrl(rec.posterPath, { tmdbSize: "w185" }) ?? undefined;
    return { id: rec.id, index: i + 1, title: rec.title, reason, posterUrl };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli && bun run test test/unit/app-shell/post-play-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/kitsunekode/Projects/hacking/kitsunesnipe
git add apps/cli/src/app-shell/post-play-view.ts apps/cli/test/unit/app-shell/post-play-view.test.ts
git commit -m "feat(post-play): resolve recommendation pick poster URLs in view-model"
```

---

## Task 2: Render poster pick tiles (poster-on-top wide, poster-left narrow)

**Files:**

- Modify: `apps/cli/src/app-shell/post-play-shell.tsx` (`DiscoveryCard`, `DiscoveryCards`)
- Test: `apps/cli/test/unit/app-shell/post-play-shell.test.tsx`

- [ ] **Step 1: Write the failing test**

Create/extend `post-play-shell.test.tsx`:

```tsx
import { describe, expect, it } from "bun:test";
import React from "react";
import { captureFrame } from "../../harness/render-capture";
import { PostPlayShell } from "@/app-shell/post-play-shell";

const recs = [
  { id: "r1", title: "Frieren", type: "series" as const, posterPath: "/a.jpg", year: "2023" },
  { id: "r2", title: "Dandadan", type: "series" as const, posterPath: "/b.jpg", year: "2024" },
];

describe("PostPlayShell discovery posters", () => {
  it("renders pick titles in the wide layout", () => {
    const frame = captureFrame(
      <PostPlayShell
        title="My Show"
        episodeLabel="S01 E01"
        postPlayState={{ kind: "mid-series" }}
        recommendations={recs}
      />,
      { columns: 130 },
    );
    expect(frame).toContain("Frieren");
    expect(frame).toContain("Dandadan");
  });
});
```

- [ ] **Step 2: Run test to verify it fails (or passes trivially)**

Run: `cd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli && bun run test test/unit/app-shell/post-play-shell.test.tsx`
Expected: If `post-play-shell.test.tsx` is new, this may PASS for the title-only assertion (titles already render). That is fine — the test locks behavior. The visual poster cell is verified by the snapshot in Task 8. Proceed to implement the poster cells.

- [ ] **Step 3: Implement poster tiles**

In `post-play-shell.tsx`, add the `MiniPoster` (reuse the queue pattern; import `usePosterPreview` already present). Add near the other small components:

```tsx
function pickInitials(title: string): string {
  return (
    title
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .slice(0, 2)
      .join("") || "?"
  );
}

function PickPoster({
  url,
  title,
  cols,
  rows,
}: {
  readonly url?: string;
  readonly title: string;
  readonly cols: number;
  readonly rows: number;
}) {
  const { poster } = usePosterPreview(url, {
    rows,
    cols,
    enabled: Boolean(url),
    variant: "preview",
    inkEmbedded: true,
    preserveTerminalImages: true,
    debounceMs: 160,
  });
  if (poster.kind !== "none") return <Text>{poster.placeholder}</Text>;
  return <Text color={palette.dim}>{pickInitials(title)}</Text>;
}
```

Replace `DiscoveryCard` (the wide tile) with a poster-on-top layout:

```tsx
function DiscoveryCard({
  card,
  width,
}: {
  readonly card: PostPlayDiscoveryCard;
  readonly width: number;
}) {
  const titleWidth = Math.max(8, width - 4);
  const reasonWidth = Math.max(4, width - 4);
  const posterCols = Math.max(8, width - 4);
  return (
    <Box
      borderStyle="single"
      borderColor={palette.lineSoft}
      paddingX={1}
      paddingY={0}
      flexDirection="column"
      width={width}
    >
      <Box minHeight={3} justifyContent="center" alignItems="center">
        <PickPoster url={card.posterUrl} title={card.title} cols={posterCols} rows={3} />
      </Box>
      <Text color={palette.accent} bold>
        {String(card.index)}
      </Text>
      <Text color={palette.text} bold>
        {truncateLine(card.title, titleWidth)}
      </Text>
      {card.reason ? (
        <Text color={palette.muted}>{truncateLine(card.reason, reasonWidth)}</Text>
      ) : null}
    </Box>
  );
}
```

Update the `list` layout branch of `DiscoveryCards` to prepend a small poster cell per row:

```tsx
return (
  <Box flexDirection="column" marginTop={1}>
    {cards.map((card) => (
      <Box key={card.id} flexDirection="row" flexWrap="nowrap">
        <Box width={5}>
          <PickPoster url={card.posterUrl} title={card.title} cols={4} rows={2} />
        </Box>
        <Text color={palette.accent} bold>
          {String(card.index).padStart(1)}{" "}
        </Text>
        <Text color={palette.text} bold>
          {truncateLine(card.title, Math.max(8, width - 27))}
        </Text>
        {card.reason ? (
          <Text color={palette.dim}>
            {" "}
            · {truncateLine(card.reason, Math.max(4, width - measureColumns(card.title) - 11))}
          </Text>
        ) : null}
      </Box>
    ))}
  </Box>
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli && bun run test test/unit/app-shell/post-play-shell.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/kitsunekode/Projects/hacking/kitsunesnipe
git add apps/cli/src/app-shell/post-play-shell.tsx apps/cli/test/unit/app-shell/post-play-shell.test.tsx
git commit -m "feat(post-play): render recommendation picks as poster tiles"
```

---

## Task 3: Next-Up hero view-model

**Files:**

- Modify: `apps/cli/src/app-shell/post-play-view.ts` (new `PostPlayNextUpHero` type + `nextUpHero` field + builder)
- Test: `apps/cli/test/unit/app-shell/post-play-view.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("nextUpHero", () => {
  it("builds a hero for mid-series with the next episode label", () => {
    const view = buildPostPlayView({
      title: "Show",
      episodeLabel: "S01 E01",
      nextEpisodeLabel: "S01 E02 — Challengers of Science",
      postPlayState: { kind: "mid-series" },
    });
    expect(view.nextUpHero).toBeDefined();
    expect(view.nextUpHero?.label).toBe("E02 · Challengers of Science");
    expect(view.nextUpHero?.kind).toBe("next-episode");
  });

  it("omits the hero when there is no next thing to play", () => {
    const view = buildPostPlayView({
      title: "Show",
      episodeLabel: "S01 E12",
      postPlayState: { kind: "caught-up" },
    });
    expect(view.nextUpHero).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli && bun run test test/unit/app-shell/post-play-view.test.ts`
Expected: FAIL — `nextUpHero` undefined / property absent.

- [ ] **Step 3: Implement**

Add the type and field to `post-play-view.ts`:

```ts
export type PostPlayNextUpHero = {
  /** "next-episode" = binge the current series; "queue" = cross-title queue head. */
  readonly kind: "next-episode" | "queue" | "resume" | "next-season";
  readonly label: string;
  readonly meta: string;
};
```

Add to `PostPlayView`:

```ts
  readonly nextUpHero?: PostPlayNextUpHero;
```

Add a builder helper (reuses existing `formatUpNextLabel` / `buildUpNextMeta`):

```ts
function buildNextUpHero(
  props: BuildPostPlayViewProps,
  variant: "next-episode" | "resume" | "next-season" | "queue-only",
): PostPlayNextUpHero | undefined {
  const { nextEpisodeLabel, queueNextLabel, titleDetail, autoplayPaused, resumeLabel } = props;
  if (variant === "resume" && resumeLabel) {
    return { kind: "resume", label: resumeLabel, meta: "same stream · same position" };
  }
  if (variant !== "queue-only" && nextEpisodeLabel) {
    return {
      kind: variant === "next-season" ? "next-season" : "next-episode",
      label: formatUpNextLabel(nextEpisodeLabel),
      meta: buildUpNextMeta(titleDetail, autoplayPaused),
    };
  }
  if (queueNextLabel) {
    return {
      kind: "queue",
      label: queueNextLabel,
      meta: `From your queue · ${autoplayPaused ? "autoplay paused" : "autoplay on"}`,
    };
  }
  return undefined;
}
```

Set `nextUpHero` in each relevant returned view object:

- `stopped-early` → `buildNextUpHero(props, "resume")`
- `mid-series` → `buildNextUpHero(props, "next-episode")`
- `season-finale` (when `hasNextSeason`) → `buildNextUpHero(props, "next-season")`
- `movie-complete`, `caught-up`, `series-complete` → `buildNextUpHero(props, "queue-only")` (hero only if a queue head exists; otherwise undefined)
- `did-not-start` → leave undefined

For each, add the property to the existing returned object, e.g. in the `mid-series` return add `nextUpHero: buildNextUpHero(props, "next-episode"),`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli && bun run test test/unit/app-shell/post-play-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/kitsunekode/Projects/hacking/kitsunesnipe
git add apps/cli/src/app-shell/post-play-view.ts apps/cli/test/unit/app-shell/post-play-view.test.ts
git commit -m "feat(post-play): add Next-Up hero view-model"
```

---

## Task 4: Render the Next-Up hero card (static, no countdown yet)

**Files:**

- Modify: `apps/cli/src/app-shell/post-play-shell.tsx`
- Test: `apps/cli/test/unit/app-shell/post-play-shell.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("renders the Next-Up hero card label", () => {
  const frame = captureFrame(
    <PostPlayShell
      title="My Show"
      episodeLabel="S01 E01"
      nextEpisodeLabel="S01 E02 — Challengers of Science"
      postPlayState={{ kind: "mid-series" }}
    />,
    { columns: 130 },
  );
  expect(frame).toContain("UP NEXT");
  expect(frame).toContain("Challengers of Science");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli && bun run test test/unit/app-shell/post-play-shell.test.tsx`
Expected: FAIL — no "UP NEXT" card rendered.

- [ ] **Step 3: Implement the hero card**

Add a prop to `PostPlayShellProps`:

```ts
  /** Live autoplay countdown seconds; when set, the hero shows "Playing … in Ns". */
  autoNextCountdownSeconds?: number;
```

Add the component (uses `RailArtwork`'s image approach but inline in the body — this becomes the single Kitty image):

```tsx
function NextUpHeroCard({
  hero,
  artworkUrl,
  title,
  width,
  countdownSeconds,
}: {
  readonly hero: import("./post-play-view").PostPlayNextUpHero;
  readonly artworkUrl?: string;
  readonly title: string;
  readonly width: number;
  readonly countdownSeconds?: number;
}) {
  const innerWidth = Math.max(20, width - 4);
  const posterCols = 10;
  const textWidth = Math.max(8, innerWidth - posterCols - 2);
  const { poster, posterState } = usePosterPreview(artworkUrl, {
    rows: 4,
    cols: posterCols,
    enabled: Boolean(artworkUrl),
    variant: "preview",
  });
  const countdownLine =
    countdownSeconds && countdownSeconds > 0
      ? `Playing in ${countdownSeconds}s · ↵ now · x cancel`
      : hero.kind === "resume"
        ? "↵ resume · e episodes"
        : "↵ play · e episodes";
  return (
    <Box
      borderStyle="round"
      borderColor={palette.accent}
      flexDirection="column"
      width={width}
      paddingX={1}
      marginTop={1}
    >
      <Text color={palette.accent} bold>
        ▶ UP NEXT
      </Text>
      <Box flexDirection="row" marginTop={1}>
        <Box width={posterCols} minHeight={4} justifyContent="center" alignItems="center">
          {poster.kind !== "none" ? (
            <Text>{poster.placeholder}</Text>
          ) : (
            <Text color={palette.dim} bold>
              {posterState === "loading" ? "…" : initialsOf(title)}
            </Text>
          )}
        </Box>
        <Box flexDirection="column" marginLeft={2}>
          <Text color={palette.text} bold>
            {truncateLine(hero.label, textWidth)}
          </Text>
          <Text color={palette.muted}>{truncateLine(hero.meta, textWidth)}</Text>
          <Text color={countdownSeconds ? palette.accent : palette.dim}>
            {truncateLine(countdownLine, textWidth)}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
```

In the shell body, render the hero above the action rows when `view.nextUpHero` exists; pass `artworkUrl={nextEpisodeThumbUrl ?? posterUrl}` and `countdownSeconds={autoNextCountdownSeconds}`. Because this is now the one Kitty image, **remove `RailArtwork` from `PostPlayRail`** (replace its `<RailArtwork .../>` with nothing) to honor the one-image budget. Keep the rail's Up-next card + facts.

Add `autoNextCountdownSeconds` to the destructured props of `PostPlayShell` and thread it down.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli && bun run test test/unit/app-shell/post-play-shell.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/kitsunekode/Projects/hacking/kitsunesnipe
git add apps/cli/src/app-shell/post-play-shell.tsx
git commit -m "feat(post-play): render Next-Up hero card and free the Kitty image budget"
```

---

## Task 5: Live countdown — SessionState field + reducer

**Files:**

- Modify: `apps/cli/src/domain/session/SessionState.ts`
- Test: `apps/cli/test/unit/domain/session/session-state.test.ts` (or the existing reducer test file; create if absent)

- [ ] **Step 1: Write the failing test**

Locate the existing reducer test (`grep -rl "SET_PLAYBACK_FEEDBACK" test/`). Add:

```ts
it("sets and clears the auto-next countdown", () => {
  let state = reduce(initialState(), { type: "SET_AUTO_NEXT_COUNTDOWN", seconds: 3 });
  expect(state.autoNextCountdownSeconds).toBe(3);
  state = reduce(state, { type: "SET_AUTO_NEXT_COUNTDOWN", seconds: null });
  expect(state.autoNextCountdownSeconds).toBeNull();
});
```

Match the import names used by the existing test file (the reducer is exported from `SessionState.ts` — reuse whatever the file already imports).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli && bun run test test/unit/domain/session/`
Expected: FAIL — action type unknown / field absent.

- [ ] **Step 3: Implement**

Add the field to the state interface (near `playbackNote`, line ~143):

```ts
  readonly autoNextCountdownSeconds: number | null;
```

Add to the initial state (near line ~259):

```ts
    autoNextCountdownSeconds: null,
```

Add the action to the action union (near line ~186):

```ts
  | { type: "SET_AUTO_NEXT_COUNTDOWN"; seconds: number | null }
```

Add the reducer case:

```ts
    case "SET_AUTO_NEXT_COUNTDOWN":
      return { ...state, autoNextCountdownSeconds: transition.seconds };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli && bun run test test/unit/domain/session/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/kitsunekode/Projects/hacking/kitsunesnipe
git add apps/cli/src/domain/session/SessionState.ts apps/cli/test/unit/domain/session/
git commit -m "feat(session): add auto-next countdown state field"
```

---

## Task 6: Wire countdown dispatch + prop

**Files:**

- Modify: `apps/cli/src/app/PlaybackPhase.ts` (`runAutoNextCountdown` onTick + clear)
- Modify: `apps/cli/src/app-shell/ink-shell.tsx` (pass prop)

- [ ] **Step 1: Add the dispatch in onTick**

In `runAutoNextCountdown` (line ~313), inside `onTick`, after the existing `updatePlaybackFeedback`, add:

```ts
stateManager.dispatch({ type: "SET_AUTO_NEXT_COUNTDOWN", seconds: remaining });
```

After `runAutoplayAdvanceCountdown` resolves (before `return outcome;`), clear it:

```ts
stateManager.dispatch({ type: "SET_AUTO_NEXT_COUNTDOWN", seconds: null });
```

(`stateManager` is already destructured at the top of the method.)

- [ ] **Step 2: Pass the prop at the render site**

In `ink-shell.tsx` (~line 1676), add to the `<PostPlayShell>` props:

```tsx
          autoNextCountdownSeconds={state.autoNextCountdownSeconds ?? undefined}
```

- [ ] **Step 3: Typecheck**

Run: `cd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli && bun run typecheck`
Expected: PASS (no type errors).

- [ ] **Step 4: Manual reasoning check (no live timer test)**

Confirm by reading: `onTick(remaining)` now dispatches `SET_AUTO_NEXT_COUNTDOWN` each second; the shell prop reads `state.autoNextCountdownSeconds`; the hero shows `Playing in Ns` when > 0. No automated timer test (would be flaky); covered by the typecheck + the hero render test from Task 4 driving `autoNextCountdownSeconds` directly.

- [ ] **Step 5: Add a hero countdown render test**

In `post-play-shell.test.tsx`:

```tsx
it("shows the live countdown in the hero when seconds are set", () => {
  const frame = captureFrame(
    <PostPlayShell
      title="My Show"
      episodeLabel="S01 E01"
      nextEpisodeLabel="S01 E02 — Next One"
      postPlayState={{ kind: "mid-series" }}
      autoNextCountdownSeconds={4}
    />,
    { columns: 130 },
  );
  expect(frame).toContain("Playing in 4s");
});
```

Run: `cd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli && bun run test test/unit/app-shell/post-play-shell.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/kitsunekode/Projects/hacking/kitsunesnipe
git add apps/cli/src/app/PlaybackPhase.ts apps/cli/src/app-shell/ink-shell.tsx apps/cli/test/unit/app-shell/post-play-shell.test.tsx
git commit -m "feat(post-play): wire live autoplay countdown into the Next-Up hero"
```

---

## Task 7: Config flag `showWatchTimeStats`

**Files:**

- Modify: `apps/cli/src/services/persistence/ConfigService.ts`
- Modify: `apps/cli/src/services/persistence/ConfigStore.ts`
- Modify: `apps/cli/src/services/persistence/ConfigServiceImpl.ts`
- Modify: `apps/cli/src/services/persistence/config-metadata.ts`

- [ ] **Step 1: Add the interface field**

In `ConfigService.ts`, after `recommendationRailEnabled` (line ~69):

```ts
/** Show a personal watch-time stat on the series-complete celebration. Default true. */
showWatchTimeStats: boolean;
```

- [ ] **Step 2: Add the default**

In `ConfigStore.ts`, after `recommendationRailEnabled: true,` (line ~54):

```ts
  showWatchTimeStats: true,
```

- [ ] **Step 3: Add the getter**

In `ConfigServiceImpl.ts`, after the `recommendationRailEnabled` getter (line ~403):

```ts
  get showWatchTimeStats(): boolean {
    return this.config.showWatchTimeStats;
  }
```

- [ ] **Step 4: Add metadata**

In `config-metadata.ts`, after the `recommendationRailEnabled` entry (which ends `options: ["on", "off"],` then `},` around line 73), insert an analogous entry:

```ts
  {
    key: "showWatchTimeStats",
    label: "Watch-time stats",
    section: "recommendations",
    effect: "immediate",
    privacy: "local",
    editable: true,
    options: ["on", "off"],
  },
```

(Exact field set mirrors the neighbor: `key`, `label`, `section`, `effect`, `privacy`, `editable`, `options`. Do not add fields.)

- [ ] **Step 5: Typecheck**

Run: `cd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/kitsunekode/Projects/hacking/kitsunesnipe
git add apps/cli/src/services/persistence/
git commit -m "feat(config): add showWatchTimeStats flag (default on)"
```

---

## Task 8: Watch-time aggregator + formatter (pure)

**Files:**

- Create: `apps/cli/src/app-shell/post-play-watch-time.ts`
- Test: `apps/cli/test/unit/app-shell/post-play-watch-time.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";
import { aggregateWatchTime, formatWatchTimeSummary } from "@/app-shell/post-play-watch-time";

const row = (over: Partial<{ positionSeconds: number; updatedAt: string }>) => ({
  key: "k",
  titleId: "t",
  mediaKind: "series" as const,
  title: "Show",
  positionSeconds: 1200,
  completed: true,
  updatedAt: "2026-06-01T10:00:00.000Z",
  createdAt: "2026-06-01T10:00:00.000Z",
  ...over,
});

describe("aggregateWatchTime", () => {
  it("sums positions, counts episodes and distinct days", () => {
    const stats = aggregateWatchTime([
      row({ positionSeconds: 1200, updatedAt: "2026-06-01T10:00:00.000Z" }),
      row({ positionSeconds: 1500, updatedAt: "2026-06-01T22:00:00.000Z" }),
      row({ positionSeconds: 1800, updatedAt: "2026-06-03T09:00:00.000Z" }),
    ]);
    expect(stats.watchedSeconds).toBe(4500);
    expect(stats.episodeCount).toBe(3);
    expect(stats.dayCount).toBe(2);
  });

  it("returns null summary below a meaningful threshold", () => {
    expect(
      formatWatchTimeSummary({ watchedSeconds: 120, episodeCount: 1, dayCount: 1 }),
    ).toBeNull();
  });

  it("formats hours and days", () => {
    expect(formatWatchTimeSummary({ watchedSeconds: 39600, episodeCount: 28, dayCount: 9 })).toBe(
      "You watched ~11h over 9 days",
    );
  });

  it("uses singular day", () => {
    expect(formatWatchTimeSummary({ watchedSeconds: 7200, episodeCount: 4, dayCount: 1 })).toBe(
      "You watched ~2h over 1 day",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli && bun run test test/unit/app-shell/post-play-watch-time.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `post-play-watch-time.ts`:

```ts
import type { HistoryProgress } from "@kunai/storage";

export type WatchTimeStats = {
  readonly watchedSeconds: number;
  readonly episodeCount: number;
  readonly dayCount: number;
};

/** Pure aggregation over a title's history rows (one row per episode via upsert). */
export function aggregateWatchTime(rows: readonly HistoryProgress[]): WatchTimeStats {
  let watchedSeconds = 0;
  const days = new Set<string>();
  for (const row of rows) {
    watchedSeconds += Math.max(0, row.positionSeconds);
    days.add(row.updatedAt.slice(0, 10)); // YYYY-MM-DD
  }
  return { watchedSeconds, episodeCount: rows.length, dayCount: days.size };
}

/** Below ~10 minutes total there is nothing worth celebrating; return null to hide. */
export function formatWatchTimeSummary(stats: WatchTimeStats): string | null {
  if (stats.watchedSeconds < 600) return null;
  const hours = Math.round(stats.watchedSeconds / 3600);
  const hoursPart = hours >= 1 ? `~${hours}h` : `~${Math.round(stats.watchedSeconds / 60)}m`;
  const dayPart = `${stats.dayCount} ${stats.dayCount === 1 ? "day" : "days"}`;
  return `You watched ${hoursPart} over ${dayPart}`;
}
```

Confirm the `HistoryProgress` import path: `grep -rn "HistoryProgress" apps/cli/src | grep import | head -1` and use the same specifier (likely `@kunai/storage`). If different, match it.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli && bun run test test/unit/app-shell/post-play-watch-time.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/kitsunekode/Projects/hacking/kitsunesnipe
git add apps/cli/src/app-shell/post-play-watch-time.ts apps/cli/test/unit/app-shell/post-play-watch-time.test.ts
git commit -m "feat(post-play): pure watch-time aggregator and formatter"
```

---

## Task 9: series-complete celebration — view-model + wiring

**Files:**

- Modify: `apps/cli/src/app-shell/post-play-view.ts` (add `celebration` to the series-complete view + prop input)
- Modify: `apps/cli/src/app-shell/post-play-shell.tsx` (render the celebration banner)
- Modify: `apps/cli/src/domain/session/SessionState.ts` (`watchTimeSummary` field + action)
- Modify: `apps/cli/src/app/PlaybackPhase.ts` (aggregate + dispatch on series-complete)
- Modify: `apps/cli/src/app-shell/ink-shell.tsx` (pass prop)
- Test: `apps/cli/test/unit/app-shell/post-play-view.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("series-complete celebration", () => {
  it("includes catalog stats and the watch-time summary when provided", () => {
    const view = buildPostPlayView({
      title: "Show",
      episodeLabel: "S02 E12",
      postPlayState: { kind: "series-complete" },
      totalEpisodes: 28,
      currentSeason: 2,
      watchTimeSummary: "You watched ~11h over 9 days",
    });
    expect(view.celebration).toBeDefined();
    expect(view.celebration?.statLine).toContain("28 episodes");
    expect(view.celebration?.watchTimeLine).toBe("You watched ~11h over 9 days");
  });

  it("omits watch-time line when not provided", () => {
    const view = buildPostPlayView({
      title: "Show",
      episodeLabel: "S02 E12",
      postPlayState: { kind: "series-complete" },
      totalEpisodes: 28,
    });
    expect(view.celebration?.watchTimeLine).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli && bun run test test/unit/app-shell/post-play-view.test.ts`
Expected: FAIL — `celebration` absent.

- [ ] **Step 3: Implement view-model**

Add to `BuildPostPlayViewProps`:

```ts
  /** Pre-formatted personal watch-time line; omitted when disabled or below threshold. */
  readonly watchTimeSummary?: string;
```

Add the type + field:

```ts
export type PostPlayCelebration = {
  readonly statLine: string; // "28 episodes · 2 seasons · 2023"
  readonly watchTimeLine?: string;
};
```

Add to `PostPlayView`:

```ts
  readonly celebration?: PostPlayCelebration;
```

In the series-complete return (the final block), build it from the existing `seriesMeta` computation already present there:

```ts
const celebration: PostPlayCelebration = {
  statLine: seriesMeta || "Series complete",
  watchTimeLine: props.watchTimeSummary,
};
```

and add `celebration,` to the returned object.

- [ ] **Step 4: Render the banner**

In `post-play-shell.tsx`, when `view.celebration` exists (series-complete), render above the discovery section:

```tsx
{
  view.celebration ? (
    <Box flexDirection="column" marginTop={1}>
      <Text color={palette.milestone} bold>
        ✦ SERIES COMPLETE
      </Text>
      <Text color={palette.muted}>{truncateLine(view.celebration.statLine, bodyWidth)}</Text>
      {view.celebration.watchTimeLine ? (
        <Text color={palette.ok}>{truncateLine(view.celebration.watchTimeLine, bodyWidth)}</Text>
      ) : null}
    </Box>
  ) : null;
}
```

(The existing `heroLabel` for series-complete may now be redundant with the banner; keep the banner as the celebration and leave `heroLabel` — they reinforce. If visually doubled in the Task 11 snapshot, drop the `heroLabel` render for series-complete then.)

- [ ] **Step 5: Add SessionState field**

In `SessionState.ts`: add `readonly watchTimeSummary: string | null;` to the state, `watchTimeSummary: null,` to initial state, action `| { type: "SET_WATCH_TIME_SUMMARY"; summary: string | null }`, and reducer case `case "SET_WATCH_TIME_SUMMARY": return { ...state, watchTimeSummary: transition.summary };`.

- [ ] **Step 6: Aggregate + dispatch in PlaybackPhase**

`postPlayState` is computed at `PlaybackPhase.ts:2924` (`const postPlayState = resolvePostPlayState(postPlayInput);`), and `historyRepository`, `container`, `stateManager`, and `title` are all in scope (line 1056 already calls `historyRepository.listByTitle(title.id)`). Add the import at the top of the file:

```ts
import { aggregateWatchTime, formatWatchTimeSummary } from "@/app-shell/post-play-watch-time";
```

Immediately after line 2924, insert:

```ts
const watchTimeSummary =
  postPlayState.kind === "series-complete" && container.config.showWatchTimeStats
    ? formatWatchTimeSummary(aggregateWatchTime(historyRepository.listByTitle(title.id)))
    : null;
stateManager.dispatch({ type: "SET_WATCH_TIME_SUMMARY", summary: watchTimeSummary });
```

(`title.id` is the titleId; `formatWatchTimeSummary` returns `string | null`, so the dispatch payload is always valid.)

- [ ] **Step 7: Pass the prop**

In `ink-shell.tsx` `<PostPlayShell>`:

```tsx
          watchTimeSummary={state.watchTimeSummary ?? undefined}
```

And thread `watchTimeSummary` into `buildPostPlayView` inside `post-play-shell.tsx` (add to the props object passed to `buildPostPlayView` and to `PostPlayShellProps`).

- [ ] **Step 8: Run tests + typecheck**

Run: `cd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli && bun run test test/unit/app-shell/post-play-view.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd /home/kitsunekode/Projects/hacking/kitsunesnipe
git add apps/cli/src/app-shell/post-play-view.ts apps/cli/src/app-shell/post-play-shell.tsx apps/cli/src/domain/session/SessionState.ts apps/cli/src/app/PlaybackPhase.ts apps/cli/src/app-shell/ink-shell.tsx apps/cli/test/unit/app-shell/post-play-view.test.ts
git commit -m "feat(post-play): series-complete celebration with optional watch-time stat"
```

---

## Task 10: Live-keys footer + unified focus across picks

**Files:**

- Modify: `apps/cli/src/app-shell/post-play-shell.tsx` (footer line)
- Modify: `apps/cli/src/app-shell/post-play-view.ts` (`resolvePostPlayUnhandledInput` already routes `1/2/3` + actions — verify, extend only if needed)
- Test: `apps/cli/test/unit/app-shell/post-play-shell.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("renders a legible keys footer", () => {
  const frame = captureFrame(
    <PostPlayShell
      title="My Show"
      episodeLabel="S01 E01"
      nextEpisodeLabel="S01 E02 — Next One"
      postPlayState={{ kind: "mid-series" }}
      recommendations={recs}
    />,
    { columns: 130 },
  );
  expect(frame).toContain("↑↓ move");
  expect(frame).toContain("1·2·3 picks");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli && bun run test test/unit/app-shell/post-play-shell.test.tsx`
Expected: FAIL — footer absent.

- [ ] **Step 3: Implement the footer**

At the bottom of the body column in `PostPlayShell`, after the discovery section:

```tsx
<Box marginTop={1}>
  <Text color={palette.dim}>
    {truncateLine(
      [
        "↑↓ move",
        "↵ select",
        recommendations.length > 0 ? "1·2·3 picks" : null,
        view.nextUpHero ? "x cancel" : null,
        "/ search",
      ]
        .filter(Boolean)
        .join("   ·   "),
      bodyWidth,
    )}
  </Text>
</Box>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli && bun run test test/unit/app-shell/post-play-shell.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/kitsunekode/Projects/hacking/kitsunesnipe
git add apps/cli/src/app-shell/post-play-shell.tsx apps/cli/test/unit/app-shell/post-play-shell.test.tsx
git commit -m "feat(post-play): live-keys footer"
```

---

## Task 11: Responsive snapshots + full gate

**Files:**

- Modify: `apps/cli/test/unit/app-shell/post-play-shell.test.tsx`

- [ ] **Step 1: Add breakpoint snapshot tests**

```tsx
describe("PostPlayShell responsive", () => {
  const base = {
    title: "My Show",
    episodeLabel: "S01 E01",
    nextEpisodeLabel: "S01 E02 — Next One",
    postPlayState: { kind: "mid-series" as const },
    recommendations: recs,
  };
  it("wide renders hero + poster tiles + footer without throwing", () => {
    const frame = captureFrame(<PostPlayShell {...base} />, { columns: 140 });
    expect(frame).toContain("UP NEXT");
    expect(frame).toContain("Frieren");
  });
  it("medium renders without rail overflow", () => {
    const frame = captureFrame(<PostPlayShell {...base} />, { columns: 90 });
    expect(frame).toContain("UP NEXT");
  });
  it("narrow degrades to compact picks, no posters wall", () => {
    const frame = captureFrame(<PostPlayShell {...base} />, { columns: 50 });
    expect(frame).toContain("My Show");
  });
});
```

- [ ] **Step 2: Run the post-play tests**

Run: `cd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli && bun run test test/unit/app-shell/post-play-shell.test.tsx test/unit/app-shell/post-play-view.test.ts test/unit/app-shell/post-play-watch-time.test.ts`
Expected: PASS.

- [ ] **Step 3: Full gate**

Run each, expecting clean:

```bash
cd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli
bun run typecheck
bun run lint
bun run test
```

Then from repo root:

```bash
cd /home/kitsunekode/Projects/hacking/kitsunesnipe
bun run build
```

Expected: typecheck clean, lint clean (watch for `no-shadow` on the new `PickPoster`/`row` locals — rename if flagged), all tests pass, build succeeds.

- [ ] **Step 4: Commit**

```bash
cd /home/kitsunekode/Projects/hacking/kitsunesnipe
git add apps/cli/test/unit/app-shell/post-play-shell.test.tsx
git commit -m "test(post-play): responsive snapshots across breakpoints"
```

---

## Self-Review notes (for the executor)

- **One-image budget:** Task 4 removes `RailArtwork` from the rail when the hero takes the image. Verify in the Task 11 wide snapshot that only one poster preview mounts. If the rail still needs a poster on very wide terminals, that is a follow-up — do not add a second Kitty image.
- **series-complete double heading:** Task 9 Step 4 notes the `heroLabel` may visually duplicate the celebration banner. Decide from the snapshot; prefer the banner.
- **Lint:** the pre-commit hook runs oxlint + oxfmt (reorders imports). Expect import reordering on commit; let it.
- **Threshold:** `formatWatchTimeSummary` hides below 10 minutes — intentional, so trivial sessions do not show a stat.
