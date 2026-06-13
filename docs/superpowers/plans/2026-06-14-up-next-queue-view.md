# Up Next Queue View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a discoverable, manageable Up Next queue view (Variant B posters: block mini-poster per row + one Kitty hero), backed by the already-complete `QueueService`, with a keymap-collision guard so the new keys are safe.

**Architecture:** Pure `buildQueueView` derivation (mirrors `history-view.ts`) feeds a render-only `QueueShell` (mirrors `HistoryShell`), mounted as a new `overlay.type === "queue"` surface in `root-overlay-shell.tsx`. Play handoff reuses the root-selection bridge pattern (`root-history-bridge.ts`). Posters reuse `usePosterPreview` (`inkEmbedded:true` text minis + one Kitty hero) and the existing `fetchPoster` cache.

**Tech Stack:** TypeScript, React 19, Ink 7, Bun test runner, `apps/cli/test/harness/render-capture.ts`.

**Spec:** `docs/superpowers/specs/2026-06-14-up-next-queue-view-design.md`

**Key facts verified against code:**

- `QueueService` (`apps/cli/src/domain/queue/QueueService.ts`) has `getAll/getUnplayed/moveUp/moveDown/remove/clear/clearPlayed/peekNext/getStatus/listRecoverableSessions/restoreRecoverableSession`. Add `moveToTop/moveToBottom`.
- `usePosterPreview` text path needs `inkEmbedded: true` (line 91 of `image-pane.ts`: `if (!inkEmbedded && !allowKitty) return {kind:"none"}`). `UpNextThumbSlot` in `playback-playing-rail.tsx` is the working precedent (`inkEmbedded:true, preserveTerminalImages:true`).
- `fetchPoster` already caches per `resolved:RxC:renderer` + dedupes inflight — no new cache needed.
- Surfaces mount via `overlay.type` in `root-overlay-shell.tsx` (`overlay.type === "history"` branch ~line 1836 renders `<HistoryShell>`).
- Play handoff: `root-history-bridge.ts` (`waitForRootHistorySelection`/`resolveRootHistorySelection`/`buildRootHistorySelection`) + `command-router.ts` `openRootHistorySelection`. `PlaybackPhase.ts` already calls `queueService.advance()` on progression.
- Keymap registry: `keybindings.ts` `KEYBINDINGS` + `KeyScope`; mpv keys in `assets/mpv/kunai-bridge.lua`.

---

## Task 1: Keymap collision guard + register the new `queue` scope

**Files:**

- Test: `apps/cli/test/unit/app-shell/keybindings-collision.test.ts` (create)
- Modify: `apps/cli/src/app-shell/keybindings.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/unit/app-shell/keybindings-collision.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { bindingsForScope, formatChord, KEYBINDINGS, type KeyScope } from "@/app-shell/keybindings";

const SCOPES: readonly KeyScope[] = [
  "global",
  "editing",
  "browse",
  "search",
  "player",
  "postPlayback",
  "queue",
];

describe("keybinding collisions", () => {
  test.each(SCOPES)("no two live (non-helpOnly) bindings share a chord in scope %s", (scope) => {
    const seen = new Map<string, string>();
    for (const binding of bindingsForScope(scope)) {
      if (binding.helpOnly) continue;
      const chord = formatChord(binding.chord);
      const prior = seen.get(chord);
      expect(prior, `chord "${chord}" bound to both ${prior} and ${binding.id} in ${scope}`).toBe(
        undefined,
      );
      seen.set(chord, binding.id);
    }
  });

  test("every binding has a unique id", () => {
    const ids = KEYBINDINGS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: Run — expect a TYPE error / fail**

Run: `cd apps/cli && bun run typecheck`
Expected: FAIL — `"queue"` is not assignable to `KeyScope` yet.

- [ ] **Step 3: Add `queue` to `KeyScope`**

In `apps/cli/src/app-shell/keybindings.ts`, extend the scope union:

```ts
export type KeyScope =
  | "global"
  | "editing"
  | "browse"
  | "search"
  | "player"
  | "postPlayback"
  | "queue";
```

- [ ] **Step 4: Run the collision test**

Run: `cd apps/cli && bun run test test/unit/app-shell/keybindings-collision.test.ts`
Expected: PASS (registry currently has no live dup chords; `queue` scope is empty so trivially passes).

- [ ] **Step 5: Document the undocumented live keys (mpv + overlay) as `helpOnly`**

Still in `keybindings.ts`, append to `KEYBINDINGS` a documentation group so the inventory is complete and the `?` overlay shows them. These are `helpOnly` (matched by mpv / list controllers, not here):

```ts
  // ── In player (mpv-owned; mirrors kunai-bridge.lua) — documentation only ──
  {
    id: "player-quality-alt",
    chord: { input: "v" },
    display: "v / V",
    label: "Choose quality (mpv key)",
    scope: "player",
    group: "In the player",
    helpOnly: true,
  },
  {
    id: "player-resume-open",
    chord: { input: "o" },
    label: "Open / resume prompt (mpv)",
    scope: "player",
    group: "In the player",
    helpOnly: true,
  },
```

> If grep of `assets/mpv/kunai-bridge.lua` and the overlay `useInput` handlers reveals more live keys absent from the registry (e.g. an autoskip key), add each here as a `helpOnly` entry in the right scope. The collision test then protects them.

- [ ] **Step 6: Run test + typecheck**

Run: `cd apps/cli && bun run typecheck && bun run test test/unit/app-shell/keybindings-collision.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/app-shell/keybindings.ts apps/cli/test/unit/app-shell/keybindings-collision.test.ts
git commit -m "feat(cli): add keymap collision guard and queue key scope"
```

---

## Task 2: Register the queue keybindings + open command

**Files:**

- Modify: `apps/cli/src/app-shell/keybindings.ts`
- Modify: `apps/cli/src/app-shell/commands.ts`

- [ ] **Step 1: Add queue bindings to `KEYBINDINGS`**

Append (the open key is global so it works from browse/post-play; the rest are `queue` scope):

```ts
  // ── Up Next queue ──
  {
    id: "queue-open",
    chord: { input: "Q", shift: true },
    display: "Shift+Q",
    label: "Open the Up Next queue",
    scope: "global",
    group: "Global",
    footerPriority: 45,
  },
  {
    id: "queue-play",
    chord: { named: "return" },
    label: "Play the selected item now",
    scope: "queue",
    group: "Up Next",
    footerPriority: 10,
  },
  {
    id: "queue-reorder",
    chord: { input: "J" },
    display: "J / K",
    label: "Move item down / up one slot",
    scope: "queue",
    group: "Up Next",
    footerPriority: 15,
  },
  {
    id: "queue-move-ends",
    chord: { input: "g" },
    display: "g / G",
    label: "Move to top (play next) / bottom",
    scope: "queue",
    group: "Up Next",
    footerPriority: 20,
  },
  {
    id: "queue-remove",
    chord: { input: "x" },
    label: "Remove the selected item",
    scope: "queue",
    group: "Up Next",
    footerPriority: 25,
  },
  {
    id: "queue-clear",
    chord: { input: "c" },
    display: "c / C",
    label: "Clear queue / clear played",
    scope: "queue",
    group: "Up Next",
  },
  {
    id: "queue-restore",
    chord: { input: "r" },
    label: "Restore your last queue",
    scope: "queue",
    group: "Up Next",
  },
];
```

> `K`/`G`/`C` are the shifted partners shown via `display`; they are matched explicitly in the shell input handler (Task 7), so they need no separate registry rows. The collision test only checks the canonical chord per id.

- [ ] **Step 2: Add the `queue` command id**

In `apps/cli/src/app-shell/commands.ts`, add `"queue"` to the `AppCommandId` union (find where ids like `"playlist"`, `"history"` are declared — in the command registry types) and include `"queue"` in `POST_PLAYBACK_SURFACE_COMMANDS` and the browse/root command sets next to `"history"`. Mirror exactly how `"history"` is registered (label "Up Next", aliases `queue`, `up-next`) in `domain/session/command-registry` where command metadata lives.

> Implementer: grep `"history"` across `commands.ts` + `domain/session/command-registry*` and add a parallel `"queue"` entry everywhere `"history"` appears as a surface-opening command.

- [ ] **Step 3: Verify**

Run: `cd apps/cli && bun run typecheck && bun run test test/unit/app-shell/keybindings-collision.test.ts`
Expected: PASS — `Shift+Q` is unique in `global`; queue-scope chords unique.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/app-shell/keybindings.ts apps/cli/src/app-shell/commands.ts
git commit -m "feat(cli): register Up Next queue keybindings and open command"
```

---

## Task 3: `QueueService.moveToTop` / `moveToBottom`

**Files:**

- Modify: `apps/cli/src/domain/queue/QueueService.ts`
- Test: `apps/cli/test/unit/domain/queue/queue-service-reorder.test.ts` (create; mirror existing queue service test setup — grep `new QueueService(` in tests for the in-memory repo fixture)

- [ ] **Step 1: Write the failing test**

Create the test using the same in-memory `QueueRepository` fixture the existing QueueService tests use (copy that fixture):

```ts
import { describe, expect, test } from "bun:test";
// import { makeQueueServiceWithEntries } from "<existing test helper or inline fixture>";

describe("QueueService reorder ends", () => {
  test("moveToTop puts an unplayed item first among unplayed, after played", () => {
    const { service, ids } = setup(["A", "B", "C"]); // all unplayed
    expect(service.moveToTop(ids.C)).toBe(true);
    expect(service.getUnplayed().map((e) => e.title)).toEqual(["C", "A", "B"]);
  });

  test("moveToBottom puts an unplayed item last", () => {
    const { service, ids } = setup(["A", "B", "C"]);
    expect(service.moveToBottom(ids.A)).toBe(true);
    expect(service.getUnplayed().map((e) => e.title)).toEqual(["B", "C", "A"]);
  });

  test("no-op returns false when already at the end", () => {
    const { service, ids } = setup(["A", "B"]);
    expect(service.moveToTop(ids.A)).toBe(false);
    expect(service.moveToBottom(ids.B)).toBe(false);
  });
});
```

> `setup(titles)` builds a `QueueService` over an in-memory repo and enqueues the titles; return the service and a title→id map. Reuse the fixture pattern already present in the repo's queue tests.

- [ ] **Step 2: Run — expect fail**

Run: `cd apps/cli && bun run test test/unit/domain/queue/queue-service-reorder.test.ts`
Expected: FAIL — `moveToTop`/`moveToBottom` not defined.

- [ ] **Step 3: Implement**

In `QueueService.ts`, add after `moveDown` (reuse the `moveUnplayed` shape):

```ts
  private moveUnplayedToEnd(id: string, end: "top" | "bottom"): boolean {
    const all = this.repo.getAll(this.sessionId);
    const played = all.filter((entry) => entry.playedAt !== undefined);
    const unplayed = all.filter((entry) => entry.playedAt === undefined);
    const index = unplayed.findIndex((entry) => entry.id === id);
    if (index < 0) return false;
    const target = end === "top" ? 0 : unplayed.length - 1;
    if (index === target) return false;
    const [moved] = unplayed.splice(index, 1);
    if (!moved) return false;
    if (end === "top") unplayed.unshift(moved);
    else unplayed.push(moved);
    this.repo.setQueuePositions([...played, ...unplayed].map((entry) => entry.id));
    return true;
  }

  moveToTop(id: string): boolean {
    return this.moveUnplayedToEnd(id, "top");
  }

  moveToBottom(id: string): boolean {
    return this.moveUnplayedToEnd(id, "bottom");
  }
```

- [ ] **Step 4: Run — expect pass**

Run: `cd apps/cli && bun run test test/unit/domain/queue/queue-service-reorder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/domain/queue/QueueService.ts apps/cli/test/unit/domain/queue/queue-service-reorder.test.ts
git commit -m "feat(queue): add moveToTop and moveToBottom"
```

---

## Task 4: `queue-view.ts` pure builder

**Files:**

- Create: `apps/cli/src/app-shell/queue-view.ts`
- Test: `apps/cli/test/unit/app-shell/queue-view.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";

import { buildQueueView } from "@/app-shell/queue-view";
import type { QueueEntry } from "@kunai/storage";

function entry(p: Partial<QueueEntry> & { id: string; title: string }): QueueEntry {
  return {
    mediaKind: "anime",
    titleId: p.title,
    priority: 0,
    source: "manual",
    addedAt: "2026-06-14T00:00:00Z",
    sessionId: "s1",
    status: "pending",
    ...p,
  } as QueueEntry;
}

const base = {
  selectedId: null,
  resolvePoster: () => undefined,
  recoverableSessions: 0,
};

describe("buildQueueView", () => {
  test("empty with no recoverable sessions", () => {
    const v = buildQueueView({ entries: [], ...base });
    expect(v.state).toBe("empty");
    expect(v.emptyHint).toContain("add from");
  });

  test("empty with recoverable session hints restore", () => {
    const v = buildQueueView({ entries: [], ...base, recoverableSessions: 1 });
    expect(v.emptyHint).toContain("restore");
  });

  test("orders played first then unplayed, with 1-based unplayed positions", () => {
    const entries = [
      entry({ id: "1", title: "Done", playedAt: "2026-06-14T01:00:00Z" }),
      entry({ id: "2", title: "Next", season: 2, episode: 8 }),
      entry({ id: "3", title: "Later", episode: 3 }),
    ];
    const v = buildQueueView({ entries, ...base, selectedId: "2" });
    expect(v.rows.map((r) => r.state)).toEqual(["played", "playing", "pending"]);
    expect(v.rows[1]!.position).toBe(1);
    expect(v.rows[1]!.episodeLabel).toBe("S02·E08");
    expect(v.rows[2]!.episodeLabel).toBe("E03");
    expect(v.selectedIndex).toBe(1);
    expect(v.counts).toEqual({ unplayed: 2, total: 3 });
  });

  test("maps source labels and resolves posters", () => {
    const entries = [entry({ id: "2", title: "Next", source: "history" })];
    const v = buildQueueView({ entries, ...base, resolvePoster: (id) => `http://p/${id}` });
    expect(v.rows[0]!.sourceLabel).toBe("from history");
    expect(v.rows[0]!.posterUrl).toBe("http://p/Next");
    expect(v.rail?.posterUrl).toBe("http://p/Next");
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `cd apps/cli && bun run test test/unit/app-shell/queue-view.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `queue-view.ts`**

```ts
import type { QueueEntry } from "@kunai/storage";

export type QueueRowState = "playing" | "pending" | "played";

export type QueueViewRow = {
  readonly id: string;
  readonly title: string;
  readonly episodeLabel: string;
  readonly sourceLabel: string;
  readonly state: QueueRowState;
  readonly position: number;
  readonly posterUrl?: string;
  readonly titleId: string;
};

export type QueueRailModel = {
  readonly title: string;
  readonly episodeLabel: string;
  readonly sourceLabel: string;
  readonly posterUrl?: string;
};

export type QueueView = {
  readonly state: "empty" | "success";
  readonly rows: readonly QueueViewRow[];
  readonly selectedIndex: number;
  readonly counts: { readonly unplayed: number; readonly total: number };
  readonly stale: boolean;
  readonly recoverableSessions: number;
  readonly rail: QueueRailModel | null;
  readonly emptyHint: string;
};

export type BuildQueueViewInput = {
  readonly entries: readonly QueueEntry[];
  readonly selectedId: string | null;
  readonly resolvePoster: (titleId: string) => string | undefined;
  readonly recoverableSessions: number;
  readonly stale?: boolean;
};

function episodeLabel(entry: QueueEntry): string {
  if (entry.mediaKind === "movie") return "Movie";
  const ep = entry.episode ?? entry.absoluteEpisode;
  if (entry.season !== undefined && entry.episode !== undefined) {
    return `S${String(entry.season).padStart(2, "0")}·E${String(entry.episode).padStart(2, "0")}`;
  }
  return ep !== undefined ? `E${String(ep).padStart(2, "0")}` : "—";
}

function sourceLabel(source: string): string {
  switch (source) {
    case "history":
      return "from history";
    case "watchlist":
      return "watchlist";
    case "post-play":
      return "post-play";
    default:
      return "added";
  }
}

export function buildQueueView(input: BuildQueueViewInput): QueueView {
  const played = input.entries.filter((e) => e.playedAt !== undefined);
  const unplayed = input.entries.filter((e) => e.playedAt === undefined);
  const total = input.entries.length;

  if (total === 0) {
    return {
      state: "empty",
      rows: [],
      selectedIndex: 0,
      counts: { unplayed: 0, total: 0 },
      stale: input.stale ?? false,
      recoverableSessions: input.recoverableSessions,
      rail: null,
      emptyHint:
        input.recoverableSessions > 0
          ? "Queue is empty · press r to restore your last queue"
          : "Queue is empty · add from browse, history, or post-play (q)",
    };
  }

  const firstUnplayedId = unplayed[0]?.id;
  const ordered = [...played, ...unplayed];
  let unplayedPos = 0;
  const rows: QueueViewRow[] = ordered.map((entry) => {
    const isPlayed = entry.playedAt !== undefined;
    if (!isPlayed) unplayedPos += 1;
    return {
      id: entry.id,
      title: entry.title,
      episodeLabel: episodeLabel(entry),
      sourceLabel: sourceLabel(entry.source),
      state: isPlayed ? "played" : entry.id === firstUnplayedId ? "playing" : "pending",
      position: isPlayed ? 0 : unplayedPos,
      posterUrl: input.resolvePoster(entry.titleId),
      titleId: entry.titleId,
    };
  });

  const selectedIndex = Math.max(
    0,
    rows.findIndex((r) => r.id === input.selectedId),
  );
  const selected = rows[selectedIndex] ?? rows[0];
  const rail: QueueRailModel | null = selected
    ? {
        title: selected.title,
        episodeLabel: selected.episodeLabel,
        sourceLabel: selected.sourceLabel,
        posterUrl: selected.posterUrl,
      }
    : null;

  return {
    state: "success",
    rows,
    selectedIndex,
    counts: { unplayed: unplayed.length, total },
    stale: input.stale ?? false,
    recoverableSessions: input.recoverableSessions,
    rail,
    emptyHint: "",
  };
}
```

- [ ] **Step 4: Run — expect pass**

Run: `cd apps/cli && bun run test test/unit/app-shell/queue-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/queue-view.ts apps/cli/test/unit/app-shell/queue-view.test.ts
git commit -m "feat(cli): add pure buildQueueView derivation"
```

---

## Task 5: Queue poster resolver

**Files:**

- Create: `apps/cli/src/app-shell/queue-poster-resolver.ts`
- Test: `apps/cli/test/unit/app-shell/queue-poster-resolver.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";

import { createQueuePosterResolver } from "@/app-shell/queue-poster-resolver";

describe("createQueuePosterResolver", () => {
  test("returns a persisted poster url by titleId", () => {
    const resolve = createQueuePosterResolver({
      getPosterUrl: (id) => (id === "t1" ? "http://p/t1.jpg" : undefined),
    });
    expect(resolve("t1")).toBe("http://p/t1.jpg");
    expect(resolve("t2")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `cd apps/cli && bun run test test/unit/app-shell/queue-poster-resolver.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
export type QueuePosterResolver = (titleId: string) => string | undefined;

export type QueuePosterSource = {
  /** Look up a persisted poster URL by titleId (history/catalog backed). */
  readonly getPosterUrl: (titleId: string) => string | undefined;
};

/** Pure factory so the resolver is trivially testable and injectable. */
export function createQueuePosterResolver(source: QueuePosterSource): QueuePosterResolver {
  return (titleId: string) => source.getPosterUrl(titleId);
}
```

> The real `getPosterUrl` is wired in Task 7 from the same persisted-poster source `HistoryShell` uses (history rail `posterUrl`). Grep how `buildHistoryView`/history obtains `rail.posterUrl` and reuse that lookup (history repo / catalog poster cache) keyed by `titleId`.

- [ ] **Step 4: Run — expect pass**; **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/queue-poster-resolver.ts apps/cli/test/unit/app-shell/queue-poster-resolver.test.ts
git commit -m "feat(cli): add queue poster resolver"
```

---

## Task 6: `QueueShell` render + mini-poster cell + tests

**Files:**

- Create: `apps/cli/src/app-shell/queue-shell.tsx`
- Test: `apps/cli/test/unit/app-shell/queue-shell.test.tsx`

- [ ] **Step 1: Write the failing render test**

```tsx
import { expect, test } from "bun:test";
import React from "react";

import { QueueShell } from "@/app-shell/queue-shell";
import { buildQueueView } from "@/app-shell/queue-view";
import type { QueueEntry } from "@kunai/storage";

import { captureFrame } from "../../harness/render-capture";

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g");

function entry(id: string, title: string, season: number, episode: number): QueueEntry {
  return {
    id,
    title,
    titleId: title,
    mediaKind: "anime",
    season,
    episode,
    priority: 0,
    source: "watchlist",
    addedAt: "2026-06-14T00:00:00Z",
    sessionId: "s1",
    status: "pending",
  } as QueueEntry;
}

function frame(cols: number): string {
  const view = buildQueueView({
    entries: [entry("1", "The Eminence in Shadow", 2, 8), entry("2", "Frieren", 1, 12)],
    selectedId: "1",
    resolvePoster: () => undefined,
    recoverableSessions: 0,
  });
  return captureFrame(
    <QueueShell
      view={view}
      columns={cols}
      listWidth={Math.min(cols - 8, 96)}
      rowWidth={Math.min(cols - 12, 92)}
    />,
    { columns: cols },
  ).replace(ANSI, "");
}

test.each([72, 100, 140])("renders queue rows cleanly at %i cols", (cols) => {
  const out = frame(cols);
  expect(out).toContain("Up Next");
  expect(out).toContain("The Eminence in Shadow");
  expect(out).toContain("S02·E08");
  const detached = out.split("\n").filter((l) => l.trim().length > 0 && /^─+$/.test(l.trim()));
  expect(detached).toHaveLength(0);
});

test("empty state shows the hint", () => {
  const view = buildQueueView({
    entries: [],
    selectedId: null,
    resolvePoster: () => undefined,
    recoverableSessions: 0,
  });
  const out = captureFrame(<QueueShell view={view} columns={100} listWidth={92} rowWidth={88} />, {
    columns: 100,
  }).replace(ANSI, "");
  expect(out).toContain("Queue is empty");
});
```

- [ ] **Step 2: Run — expect fail**

Run: `cd apps/cli && bun run test test/unit/app-shell/queue-shell.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `queue-shell.tsx`**

Mirror `history-shell.tsx`. Use `MediaListShell` (list + rail), `SectionGroup` for the header rule, `ListRow` + `buildMediaListRowColumns`/`computeMediaListRowLayout` for rows, and a leading mini-poster cell. Render-only.

```tsx
import { Box, Text } from "ink";
import React from "react";

import type { QueueView, QueueViewRow } from "./queue-view";
import { ClaudeTabRow } from "./primitives/ClaudeTabRow";
import { buildMediaListRowColumns, computeMediaListRowLayout } from "./primitives/list-row-layout";
import { ListRow } from "./primitives/ListRow";
import { MediaListShell } from "./primitives/MediaListShell";
import { SectionGroup } from "./primitives/SectionGroup";
import { StateBlock } from "./primitives/StateBlock";
import { palette } from "./shell-theme";
import { usePosterPreview } from "./use-poster-preview";

function initialsOf(title: string): string {
  return (
    title
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .slice(0, 2)
      .join("") || "?"
  );
}

/** Text-mode mini-poster (inkEmbedded so many can coexist with one Kitty hero). */
function MiniPoster({ url, title }: { readonly url?: string; readonly title: string }) {
  const { poster } = usePosterPreview(url, {
    rows: 2,
    cols: 4,
    enabled: Boolean(url),
    variant: "preview",
    inkEmbedded: true,
    preserveTerminalImages: true,
    debounceMs: 160,
  });
  if (poster.kind !== "none") return <Text>{poster.placeholder}</Text>;
  return <Text color={palette.dim}>{initialsOf(title)}</Text>;
}

function QueueRow({
  row,
  selected,
  rowWidth,
}: {
  readonly row: QueueViewRow;
  readonly selected: boolean;
  readonly rowWidth: number;
}) {
  const layout = computeMediaListRowLayout(rowWidth - 5, { hasEpisode: true });
  const stateLabel =
    row.state === "playing" ? "▶ playing" : row.state === "played" ? "played" : row.sourceLabel;
  const stateColor = row.state === "playing" ? palette.ok : palette.muted;
  return (
    <Box flexDirection="row">
      <Box width={5}>
        <MiniPoster url={row.posterUrl} title={row.title} />
      </Box>
      <Box flexGrow={1}>
        <ListRow
          selected={selected}
          rowWidth={rowWidth - 5}
          flexColumnIndex={layout.flexColumnIndex}
          columns={buildMediaListRowColumns({
            title: row.title,
            episodeCode: row.episodeLabel,
            statusLabel: stateLabel,
            statusColor: stateColor,
            statusDim: row.state !== "playing",
            layout,
          })}
        />
      </Box>
    </Box>
  );
}

export function QueueShell({
  view,
  columns,
  listWidth,
  rowWidth,
}: {
  readonly view: QueueView;
  readonly columns: number;
  readonly listWidth: number;
  readonly rowWidth: number;
}) {
  const list = (
    <Box flexDirection="column" flexGrow={1}>
      <SectionGroup
        label="Up Next"
        tag={`${view.counts.unplayed} queued${view.stale ? " · stale" : ""}`}
        marginTop={0}
      />
      {view.state === "empty" ? (
        <StateBlock
          model={{ kind: "empty", title: "Nothing queued", detail: view.emptyHint }}
          width={rowWidth}
        />
      ) : (
        view.rows.map((row, index) => (
          <QueueRow
            key={row.id}
            row={row}
            selected={index === view.selectedIndex}
            rowWidth={rowWidth}
          />
        ))
      )}
    </Box>
  );

  return (
    <Box flexDirection="column" flexGrow={1} marginTop={1} paddingX={1}>
      <MediaListShell
        columns={columns}
        listWidth={listWidth}
        list={list}
        railModel={
          view.rail
            ? {
                title: view.rail.title,
                subtitle: view.rail.episodeLabel,
                posterUrl: view.rail.posterUrl,
                posterState: "idle",
                facts: [{ label: "Source", value: view.rail.sourceLabel, tone: "muted" }],
              }
            : null
        }
        railWidth={32}
      />
    </Box>
  );
}
```

> If the `PreviewRailModel` shape differs from the inline object above, adapt to the real type imported from `primitives/PreviewRail.model` (the test will catch a type mismatch). The hero poster in the rail uses the existing `PreviewRail` Kitty path automatically via `MediaListShell`.

- [ ] **Step 4: Run — expect pass** (`bun run typecheck` first, then the test)

Run: `cd apps/cli && bun run typecheck && bun run test test/unit/app-shell/queue-shell.test.tsx`
Expected: PASS at 72/100/140 + empty.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/queue-shell.tsx apps/cli/test/unit/app-shell/queue-shell.test.tsx
git commit -m "feat(cli): add QueueShell render with text mini-posters"
```

---

## Task 7: Mount the surface + wire input, play handoff, footer

**Files:**

- Create: `apps/cli/src/app-shell/root-queue-bridge.ts` (mirror `root-history-bridge.ts`)
- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx`
- Modify: `apps/cli/src/app-shell/command-router.ts`

- [ ] **Step 1: Create the queue bridge**

Copy `root-history-bridge.ts` to `root-queue-bridge.ts`, renaming the symbols (`RootQueueSelection`, `waitForRootQueueSelection`, `resolveRootQueueSelection`, `hasPendingRootQueueSelection`, `buildRootQueueSelection`). The selection payload mirrors `RootHistorySelection` (titleId, season, episode, mediaKind) so it feeds the same playback-start path.

- [ ] **Step 2: Add the open route in `command-router.ts`**

Mirror `openRootHistorySelection`: add `openRootQueueSelection(container, ...)` that opens the `queue` overlay and `await waitForRootQueueSelection()`. Route `action === "queue"` to it (next to the existing `action === "history"` cases at lines ~158/232).

- [ ] **Step 3: Mount `QueueShell` in `root-overlay-shell.tsx`**

Mirror the `overlay.type === "history"` branch (the render block ~line 1836 and the input/footer handling). Specifically:

- Add `{ type: "queue" as const }` overlay creation where `{ type: "history" as const }` is produced (action mapping ~line 786).
- Build the view: `buildQueueView({ entries: container.queueService.getAll(), selectedId, resolvePoster, recoverableSessions: container.queueService.listRecoverableSessions().length, stale: container.queueService.getStatus().isStale })`. Inject `resolvePoster` via `createQueuePosterResolver({ getPosterUrl })` where `getPosterUrl` reuses the same persisted-poster lookup history uses.
- Add a render branch: `if (overlay.type === "queue") { return ( ...<QueueShell view=... columns=... listWidth=... rowWidth=... /> ) }` mirroring the history block's width math.
- Input handler (queue scope): `↑/↓` move `selectedId`; `Enter` → `resolveRootQueueSelection(buildRootQueueSelection(selectedEntry))` (and close); `J`/`K` → `moveDown/moveUp`; `g`/`G` → `moveToTop/moveToBottom`; `x` → `remove`; `c`/`C` → `clear`/`clearPlayed`; `r` (empty) → `restoreRecoverableSession(listRecoverableSessions()[0].id)`; `Esc` → close. After each mutation, re-read `getAll()` into state so the view reflects truth; keep `selectedId` on the moved/edited item.
- Footer task label: `taskLabel="Up Next  ·  ⏎ play, J/K reorder, g/G ends, x remove, c clear, r restore, Esc close"` (mirror the history/download footer strings ~line 1772/1872).

- [ ] **Step 4: Wire the open hotkey**

Where global keys are matched in the root input layer (where `Shift+Q` would arrive), route `queue-open` → open the queue overlay (same entry as the `queue` command). Confirm via `matchBinding("global", input, key)?.id === "queue-open"` or the existing global-key dispatch.

- [ ] **Step 5: Typecheck + full suite + lint**

Run: `cd apps/cli && bun run typecheck && bun run lint && bun run test`
Expected: green. Fix any type mismatches against the real `PreviewRailModel`/overlay types.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/app-shell/root-queue-bridge.ts apps/cli/src/app-shell/root-overlay-shell.tsx apps/cli/src/app-shell/command-router.ts
git commit -m "feat(cli): mount Up Next queue surface with play/reorder/manage wiring"
```

---

## Task 8: Manual smoke + verification gate

- [ ] **Step 1: Quality gate**

Run: `cd apps/cli && bun run typecheck && bun run lint && bun run test && bun run build`
Expected: all green; build succeeds.

- [ ] **Step 2: Manual smoke (real terminal)**

```sh
bun run dev
```

Enqueue a few titles (browse `q`), open with `Shift+Q` (and `/queue`). Verify: rows show mini-posters (or initials), selected item shows the hero poster in the rail; `J/K`/`g/G` reorder and selection follows; `x` removes; `c` clears (confirm); `Enter` starts playback of the selected item and the queue advances; `Esc` closes. Resize narrow↔wide (rail hides < 124) and short height (dense chrome).

- [ ] **Step 3: Finish the branch**

Use superpowers:finishing-a-development-branch.

---

## Self-Review

**Spec coverage:** keymap consolidation+test (T1), queue keys + open command (T2), moveToTop/Bottom (T3), buildQueueView (T4), poster resolver (T5), QueueShell + text mini-posters + render tests (T6), mount/input/play-handoff/footer (T7), gate+smoke (T8). Variant B posters via `inkEmbedded:true` + one Kitty hero (T6). YouTube-style reorder (T2/T3/T7).

**Placeholders:** New pure files have full code. Integration tasks (T2 command-registry, T7 root-overlay/command-router) reference exact mirror targets (`"history"` registration, `overlay.type === "history"` branch, `root-history-bridge.ts`, `openRootHistorySelection`) with specific anchors rather than fabricated code for the 1900-line file — the implementer copies the proven pattern.

**Type consistency:** `QueueView`/`QueueViewRow`/`QueueRailModel` defined in T4, consumed in T6/T7. `moveToTop/moveToBottom` defined T3, used T7. `QueuePosterResolver` defined T5, used T7. `queue` scope/keys defined T1/T2, used T7 + collision test.

**Risks resolved:** poster cache exists (no new cache); text-mini flag corrected to `inkEmbedded:true`; play handoff = history-bridge pattern; open key `Shift+Q` guarded by the collision test.
