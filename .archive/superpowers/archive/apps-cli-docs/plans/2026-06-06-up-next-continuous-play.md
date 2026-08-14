# Up Next — Continuous Play (Spec 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Press play once and the app keeps going — next episode → queue → recommendation — with a visible, cancelable "Up next," reusing the existing queue/autoplay infrastructure.

**Architecture:** One new pure decision function `resolveNextUp()` (episode → queue → rec) is the only new logic; everything else wires it to the existing `QueueService`, `runAutoplayAdvanceCountdown`, post-play surface, and `keybindings.ts`. No key is repurposed (`n` stays "next", just smarter).

**Tech Stack:** Bun, TypeScript, Ink/React, SQLite (`@kunai/storage`), `bun run test`.

Spec: `apps/cli/docs/superpowers/specs/2026-06-06-up-next-continuous-play-design.md`.

---

## Real signatures (confirmed, reuse exactly)

- `QueueService.enqueueMediaItem(item: MediaItemIdentity, { placement: "next" | "after-current-chain" | "end"; source: string }): QueueEntry`
- `QueueService.peekNext(): QueueEntry | undefined` · `getUnplayed(): QueueEntry[]` · `remove(id: string)` · `clear()`
- `MediaItemIdentity`: `{ mediaKind; titleId; title; season?; episode?; absoluteEpisode?; sourceId?; providerHints? }`
- `QueueEntry`: `{ id; title; mediaKind; titleId; season?; episode?; absoluteEpisode?; priority; source; status; ... }`
- `runAutoplayAdvanceCountdown({ seconds; sleep; onTick; isCancelled; shouldSkip?; signal? }): Promise<"completed" | "cancelled" | "skipped">`
- `PlaybackRecommendationRailItem` (`@/app-shell/types`) — post-play rec item; `recommendationRailItemToSearchResult(item)` exists.
- `/queue` is currently an **alias of the `downloads` command** (`command-registry.ts:188`).

---

## File Structure

**Create:**

- `apps/cli/src/domain/playback/resolve-next-up.ts` — pure `resolveNextUp()` + `NextUp` type.
- `apps/cli/test/unit/domain/playback/resolve-next-up.test.ts`
- `apps/cli/src/app-shell/up-next-queue-shell.tsx` — `/queue` panel renderer (two-pane via `MediaListShell`).
- `apps/cli/test/unit/app-shell/up-next-queue-view.test.ts`

**Modify:**

- `apps/cli/src/services/persistence/ConfigService.ts` + `ConfigStore.ts` + `ConfigServiceImpl.ts` — `autoplayRecommendations`.
- `apps/cli/src/app/PlaybackPhase.ts` — call `resolveNextUp`; recommendation auto-continue branch.
- `apps/cli/src/app/post-play-input.ts` + the post-play shell input handler — `1/2/3` play-rec, `h` history.
- `apps/cli/src/app-shell/keybindings.ts` — register new keys + the Up Next hint.
- `apps/cli/src/domain/session/command-registry.ts` — move `queue` off `downloads`, add `up-next`.
- `apps/cli/src/app-shell/browse-shell.tsx` — wire the existing `q` to enqueue.
- post-play recommendation load path (`post-playback-recommendations.ts`) — deterministic fetch + small posters.

---

## Phase 1 — Foundations

### Task 1: `autoplayRecommendations` config field

**Files:** Modify `ConfigService.ts`, `ConfigStore.ts`, `ConfigServiceImpl.ts`. Test: `apps/cli/test/unit/services/persistence/autoplay-recs-config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";

describe("autoplayRecommendations config", () => {
  test("defaults to true", () => {
    expect(DEFAULT_CONFIG.autoplayRecommendations).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`Property 'autoplayRecommendations' does not exist`). Run: `bun run --cwd apps/cli test:unit 2>&1 | grep -A2 autoplayRecommendations`

- [ ] **Step 3: Implement.** In `ConfigService.ts` `KitsuneConfig` interface, after `autoNext`:

```ts
/** YouTube-style: when caught up, auto-continue into the top recommendation (with a cancelable countdown). Default true. */
autoplayRecommendations: boolean;
```

In `ConfigStore.ts` `DEFAULT_CONFIG`, after `autoNext: true,`:

```ts
  autoplayRecommendations: true,
```

In `ConfigServiceImpl.ts`, add a getter next to `get autoNext()`:

```ts
  get autoplayRecommendations(): boolean {
    return this.config.autoplayRecommendations;
  }
```

- [ ] **Step 4: Run — expect PASS.** Then `bun run --cwd apps/cli typecheck` (fix any other `KitsuneConfig` literal that now needs the field, mirroring how `favoriteSources` was added).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/services/persistence/ apps/cli/test/unit/services/persistence/autoplay-recs-config.test.ts
git commit -m "feat(config): autoplayRecommendations setting (default on)"
```

---

### Task 2: `resolveNextUp()` pure decision function

**Files:** Create `apps/cli/src/domain/playback/resolve-next-up.ts`, Test `apps/cli/test/unit/domain/playback/resolve-next-up.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { resolveNextUp } from "@/domain/playback/resolve-next-up";

const ep = { season: 1, episode: 2 };
const queueHead = { id: "q1", title: "Queued", mediaKind: "series", titleId: "t2" } as const;
const rec = { titleId: "t3", title: "Rec", mediaKind: "series" } as const;

describe("resolveNextUp", () => {
  test("next episode wins over queue and rec", () => {
    const r = resolveNextUp({
      nextEpisode: ep,
      queueHead,
      topRecommendation: rec,
      seriesDone: false,
      autoplayRecommendations: true,
    });
    expect(r).toEqual({ kind: "episode", episode: ep });
  });

  test("queue head wins when no next episode", () => {
    const r = resolveNextUp({
      nextEpisode: null,
      queueHead,
      topRecommendation: rec,
      seriesDone: true,
      autoplayRecommendations: true,
    });
    expect(r).toEqual({ kind: "queue", entry: queueHead });
  });

  test("recommendation only when series done AND setting on AND queue empty", () => {
    expect(
      resolveNextUp({
        nextEpisode: null,
        queueHead: undefined,
        topRecommendation: rec,
        seriesDone: true,
        autoplayRecommendations: true,
      }),
    ).toEqual({ kind: "recommendation", item: rec });

    expect(
      resolveNextUp({
        nextEpisode: null,
        queueHead: undefined,
        topRecommendation: rec,
        seriesDone: true,
        autoplayRecommendations: false,
      }),
    ).toBeNull();

    expect(
      resolveNextUp({
        nextEpisode: null,
        queueHead: undefined,
        topRecommendation: rec,
        seriesDone: false,
        autoplayRecommendations: true,
      }),
    ).toBeNull();
  });

  test("null when nothing is available", () => {
    expect(
      resolveNextUp({
        nextEpisode: null,
        queueHead: undefined,
        topRecommendation: null,
        seriesDone: true,
        autoplayRecommendations: true,
      }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found). Run: `bun run --cwd apps/cli test:unit 2>&1 | grep -A2 resolveNextUp`

- [ ] **Step 3: Implement**

```ts
// apps/cli/src/domain/playback/resolve-next-up.ts
import type { EpisodeInfo } from "@/domain/types";
import type { MediaItemIdentity } from "@/domain/media/media-item-identity";
import type { QueueEntry } from "@kunai/storage";

export type NextUp =
  | { readonly kind: "episode"; readonly episode: EpisodeInfo }
  | { readonly kind: "queue"; readonly entry: QueueEntry }
  | { readonly kind: "recommendation"; readonly item: MediaItemIdentity };

/**
 * Single decision for "what plays next": next episode → queue head → recommendation.
 * A recommendation is only offered when the current title is done AND the user has
 * autoplay-recommendations on. Pure — no I/O, fully testable.
 */
export function resolveNextUp(input: {
  readonly nextEpisode: EpisodeInfo | null;
  readonly queueHead: QueueEntry | undefined;
  readonly topRecommendation: MediaItemIdentity | null;
  readonly seriesDone: boolean;
  readonly autoplayRecommendations: boolean;
}): NextUp | null {
  if (input.nextEpisode) return { kind: "episode", episode: input.nextEpisode };
  if (input.queueHead) return { kind: "queue", entry: input.queueHead };
  if (input.seriesDone && input.autoplayRecommendations && input.topRecommendation) {
    return { kind: "recommendation", item: input.topRecommendation };
  }
  return null;
}
```

> Note: the test's `rec`/`queueHead` literals are partials cast `as const`; widen the test types with `as MediaItemIdentity` / `as QueueEntry` if `typecheck` complains.

- [ ] **Step 4: Run — expect PASS.** Then `bun run --cwd apps/cli typecheck`.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/domain/playback/resolve-next-up.ts apps/cli/test/unit/domain/playback/resolve-next-up.test.ts
git commit -m "feat(playback): pure resolveNextUp decision (episode → queue → recommendation)"
```

---

## Phase 2 — Auto-continue wiring

### Task 3: Recommendation auto-continue in `PlaybackPhase`

**Files:** Modify `apps/cli/src/app/PlaybackPhase.ts` (the post-play block around `:2517`, the existing queue-advance).

> Read `PlaybackPhase.ts:2505-2570` first. The queue-advance block already: checks `!nextEpisode && endReason === "eof" && !autoplayPaused`, peeks the queue, runs `runAutoplayAdvanceCountdown`, and returns a `playlist-advance` value. You are adding a **third branch**: when the queue is _also_ empty, the series is done, and `config.autoplayRecommendations` is on, continue into the top recommendation using the **same countdown + return shape**.

- [ ] **Step 1:** Just below the existing `if (nextPlaylistItem) { ... }` block (still inside the `!nextEpisode && eof && !autoplayPaused` guard), add:

```ts
// YouTube-style: queue empty + series done + setting on → continue into
// the top recommendation with the same cancelable countdown.
if (!nextPlaylistItem && config.autoplayRecommendations) {
  const topRec = recommendationRailItems[0]; // already loaded for the post-play rail
  if (topRec) {
    const recCountdown = await runAutoplayAdvanceCountdown({
      seconds: 5,
      signal: context.signal,
      sleep: (ms) => Bun.sleep(ms),
      onTick: (remaining) =>
        this.updatePlaybackFeedback(context, {
          detail: "Up next ready",
          note: `Up next: ${topRec.title} in ${remaining}s  ·  a to pause`,
        }),
      isCancelled: () => stateManager.getState().autoplaySessionPaused,
    });
    if (recCountdown !== "cancelled") {
      return {
        status: "success",
        value: {
          type: "playlist-advance",
          titleInfo: {
            id: topRec.titleId,
            name: topRec.title,
            type: topRec.mediaKind === "movie" ? "movie" : "series",
          },
          mode: topRec.mediaKind === "anime" ? "anime" : "series",
        },
      };
    }
    this.updatePlaybackFeedback(context, { detail: null, note: null });
  }
}
```

> `recommendationRailItems` is the post-play rec list already computed near `:2634` — confirm it is in scope at this point; if it is computed _after_ this block, hoist the seed/load above the auto-continue (Task 7 makes it deterministic anyway). `topRec` fields (`titleId`/`title`/`mediaKind`) match `PlaybackRecommendationRailItem`.

- [ ] **Step 2:** `bun run --cwd apps/cli typecheck` — resolve scope/order of `recommendationRailItems`.

- [ ] **Step 3:** Run the playback unit tests: `bun run --cwd apps/cli test:unit 2>&1 | grep -iE "playback|0 fail|[0-9]+ fail"`. Expected: 0 fail.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/app/PlaybackPhase.ts
git commit -m "feat(playback): auto-continue into top recommendation when caught up (gated by autoplayRecommendations)"
```

> The episode + queue branches already use `resolveNextUp`'s priority implicitly (episode handled earlier at `:1582`, queue at `:2525`); leaving them as-is keeps this task small. A later refactor can route all three through `resolveNextUp` directly — out of scope here.

---

## Phase 3 — Post-play keys

### Task 4: Post-play `1/2/3` play-rec + `h` history + registry

**Files:** Modify `post-play-input.ts` (or the post-play shell `useInput` handler — find where post-play keys like `r`/`s`/`w` are matched), `keybindings.ts`.

> Find the post-play key handler: `grep -rn "post-replay\|input === \"r\"\|matchBinding(\"postPlayback\"" apps/cli/src`. Add number + `h` handling there. The rec items are `recommendationRailItems` (the same list shown as 1·2·3).

- [ ] **Step 1:** Register the keys in `keybindings.ts` `KEYBINDINGS`, in the `postPlayback` group:

```ts
  {
    id: "post-play-rec",
    chord: { input: "1" },
    display: "1·2·3",
    label: "Play a recommended title",
    scope: "postPlayback",
    group: "After playback",
  },
  {
    id: "post-history",
    chord: { input: "h" },
    label: "Open history / continue",
    scope: "postPlayback",
    group: "After playback",
  },
```

- [ ] **Step 2:** In the post-play input handler, before the existing matches, handle the digits and `h`:

```ts
if (overlayType === "post_play" && (input === "1" || input === "2" || input === "3")) {
  const rec = recommendationRailItems[Number(input) - 1];
  if (rec) {
    // play this recommendation now (mirror the queue-advance return path)
    resolvePostPlay({
      type: "play-recommendation",
      titleInfo: {
        id: rec.titleId,
        name: rec.title,
        type: rec.mediaKind === "movie" ? "movie" : "series",
      },
      mode: rec.mediaKind === "anime" ? "anime" : "series",
    });
    return;
  }
}
if (overlayType === "post_play" && input === "h") {
  // open history overlay
  container.stateManager.dispatch({
    type: "OPEN_OVERLAY",
    overlay: { type: "history", id: createSessionPickerId("history") },
  });
  return;
}
```

> `resolvePostPlay`/`play-recommendation`: match the existing post-play resolution mechanism (the same one `r`/`s` use). If a `play-recommendation` post-play result type does not exist, add it to the post-play result union and handle it in `PlaybackPhase` exactly like `playlist-advance` (play the given title). Confirm the exact dispatch shape against how `r` (replay) resolves.

- [ ] **Step 3:** `bun run --cwd apps/cli typecheck && bun run --cwd apps/cli lint`.

- [ ] **Step 4:** Run tests; commit:

```bash
git add apps/cli/src/app/post-play-input.ts apps/cli/src/app-shell/keybindings.ts apps/cli/src/app/PlaybackPhase.ts
git commit -m "feat(post-play): 1/2/3 plays a recommendation now, h opens history (registered keys)"
```

---

## Phase 4 — /queue panel

### Task 5: Remap `/queue` + Up Next panel

**Files:** Modify `command-registry.ts`; create `up-next-queue-shell.tsx`; create the `up_next` overlay (SessionState) + render in `root-overlay-shell.tsx`. Test: `up-next-queue-view.test.ts`.

- [ ] **Step 1:** In `command-registry.ts`: remove `"queue"` from the `downloads` aliases (line 188 → `["downloads", "download-jobs", "jobs"]`), and add a new command:

```ts
  {
    id: "up-next",
    label: "Up Next",
    aliases: ["queue", "up-next", "upnext", "now-playing-next"],
    description: "View and manage the Up Next queue",
  },
```

Add `"up-next"` to the `AppCommandId` union and the relevant availability lists (activePlayback, postPlayback, global).

- [ ] **Step 2:** Write a pure view-model + test for the panel rows from `queueService.getUnplayed()`:

```ts
// up-next-queue-view.test.ts
import { describe, expect, test } from "bun:test";
import { buildUpNextRows } from "@/app-shell/up-next-queue-shell";

describe("buildUpNextRows", () => {
  test("maps queue entries to rows with episode code", () => {
    const rows = buildUpNextRows([
      { id: "1", title: "Show", mediaKind: "series", titleId: "t", season: 1, episode: 3 } as never,
    ]);
    expect(rows[0]).toMatchObject({ title: "Show", code: "S01E03" });
  });
});
```

- [ ] **Step 3:** Implement `buildUpNextRows` + `UpNextQueueShell` (two-pane via `MediaListShell`, reusing `ListRow`). Panel keys handled in `root-overlay-shell.tsx` for the new `up_next` overlay: `Enter` → resolve picker with the entry (play now), `x`/Del → `queueService.remove(id)`, `c` → `queueService.clear()`.

- [ ] **Step 4:** `bun run --cwd apps/cli typecheck && bun run --cwd apps/cli lint && bun run --cwd apps/cli test:unit`. Commit:

```bash
git add -A
git commit -m "feat(queue): /queue opens the Up Next panel (view · play · remove · clear); downloads keep /downloads /jobs"
```

---

## Phase 5 — Up Next hint + enqueue entry points

### Task 6: Always-visible "Up next" hint + browse `q` enqueue

**Files:** Modify the active-playback status (`loading-shell.tsx` / `root-status-summary.ts`) + post-play shell to show `Up next: <title>`; `browse-shell.tsx` to wire the existing `q`.

- [ ] **Step 1:** Compute the next-up label where the playing/post-play status is built: call `resolveNextUp(...)` with `queueService.peekNext()`, the next episode, the top rec, `seriesDone`, and `config.autoplayRecommendations`; render `Up next: <title>` when non-null. Title for each kind: episode → `S..E..`, queue → `entry.title`, rec → `item.title`.

- [ ] **Step 2:** In `browse-shell.tsx`, the `q` key (registry `browse-queue`) currently exists as a binding; wire its handler to:

```ts
container.queueService.enqueueMediaItem(
  {
    titleId: option.value.id,
    title: option.value.title,
    mediaKind: mediaKindForResult(option.value),
  },
  { placement: "end", source: "browse" },
);
```

with a transient "Added to Up Next" feedback. (`mediaKindForResult` — reuse the existing result→kind helper.)

- [ ] **Step 3:** `bun run --cwd apps/cli typecheck && bun run --cwd apps/cli test:unit`. Commit:

```bash
git add -A
git commit -m "feat(up-next): always-visible 'Up next' hint + q enqueues from browse"
```

---

## Phase 6 — Existing-logic fixes (make it better)

### Task 7: Deterministic post-play recs + small rec posters

**Files:** Modify `post-playback-recommendations.ts` (the warm/seed path) + the post-play rec card render in `post-play-shell.tsx`.

- [ ] **Step 1:** Make the post-play rec load deterministic: a single bounded foreground fetch (≤1200ms, `Promise.race` with a timeout) before first paint, falling back to the warm cache, loaded at most once per post-play session. (Builds on `649e8930`.) Add/extend a unit test for the seed function asserting it returns the warm items synchronously when present.

- [ ] **Step 2:** Add a small poster to each `DiscoveryCard` (`post-play-shell.tsx`): resolve `usePosterPreview(card.posterUrl, { rows: 6, cols: 12, enabled: isWide && Boolean(card.posterUrl) })` and render it above the card title; degrade to text when absent. (`card.posterUrl` — thread the rec item's poster into the discovery card model.)

- [ ] **Step 3:** `bun run --cwd apps/cli typecheck && lint && test:unit`. Commit:

```bash
git add -A
git commit -m "fix(post-play): deterministic recommendation load + small poster thumbnails on rec cards"
```

---

## Phase 7 — Verify & document

### Task 8: Gates + docs + live-verify checklist

- [ ] **Step 1:** Full gate: `bun run typecheck && bun run lint && bun run test && bun run build` — all green.

- [ ] **Step 2:** Update the spec `Status:` to `Implemented`, and `.docs/ux-architecture.md` (post-play + queue surfaces) to mention the Up Next spine. Commit.

- [ ] **Step 3:** Live-verify (user TTY, no TTY here):
  - Finish a series → "Up next: <rec> in 5s · a to pause" → it plays the rec; `a` cancels and stays in post-play.
  - Post-play `1`/`2`/`3` plays that rec immediately; `h` opens history.
  - `q` on a browse row adds to Up Next; `/queue` shows it; `Enter` plays, `x` removes, `c` clears.
  - "Up next: …" hint shows during active playback + post-play.
  - Rec cards show small posters (wide terminal).
  - Confirm `n`/`p`/`s`/`r`/`e` are unchanged.

---

## Self-Review notes

- **Spec coverage:** §1 resolver → Task 2; §2 auto-continue → Tasks 1,3; §3 keybindings → Task 4 (+ registry); §4 hint+/queue → Tasks 5,6; §5 enqueue → Task 6; §6 existing-logic fixes → Task 7; §7 testing → every task + Task 8. Covered.
- **Type consistency:** `NextUp`, `MediaItemIdentity`, `QueueEntry`, `runAutoplayAdvanceCountdown` result (`"completed"|"cancelled"|"skipped"`), `PlaybackRecommendationRailItem` used consistently.
- **Confirm-at-execution placeholders (flagged inline, not gaps):** exact post-play result-union shape for `play-recommendation` (mirror `playlist-advance`); scope/order of `recommendationRailItems` in `PlaybackPhase`; the `mediaKindForResult` helper name; the `up_next` overlay wiring in `root-overlay-shell.tsx`. Each task says how to find the real symbol first.
