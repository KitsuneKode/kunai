# Up Next Queue View — Design

**Status:** Draft for review
**Date:** 2026-06-14
**Surface:** New `QueueShell` in `apps/cli/src/app-shell`, mounted as a root overlay surface alongside `HistoryShell` / `DownloadManagerContent`.

## Problem

`QueueService` (`apps/cli/src/domain/queue/QueueService.ts`) is fully featured — `getAll` / `getUnplayed`, `moveUp` / `moveDown` (reorder), `remove`, `clear`, `clearPlayed`, `peekNext` / `advance`, `getStatus`, `listRecoverableSessions` / `restoreRecoverableSession`, `refillFromWatchlist` — but **nothing renders it**. The queue only ever surfaces as a single "Up next" card in the playback rail and post-play. Users can enqueue (the `playlist` command / `browse-queue` keybinding) but can never see, reorder, remove, or restore their queue. This spec adds the missing view.

## Goals

- A discoverable, full-screen-overlay **Up Next** surface that lists the queue and supports the management the service already provides: play, reorder, remove, clear, restore session.
- Poster art per the locked **Variant B / hybrid C** direction: a **block mini-poster on every list row** plus a **single real (Kitty) hero poster** for the selected item in the rail.
- Consistent with existing surfaces (reuse `MediaListShell`, `ListRow`, the fixed `SectionGroup`, viewport policy, dense chrome) and robust across widths/heights.

## Non-goals

- Cross-session queue merging UI beyond the existing `restoreRecoverableSession` (one-tap restore is in scope; a full session browser is not).
- Changing queue semantics/priority logic (`QueuePlanner`) — view only.
- Download queue, notifications, settings, playback, post-play posters — separate specs in the roadmap.

## Navigation & mount

- **Open:** add a new command `queue` (label "Up Next", aliases `queue`, `up-next`) to the app command registry (`apps/cli/src/app-shell/commands.ts` `AppCommandId` + `POST_PLAYBACK_SURFACE_COMMANDS` and the browse/root command sets) and a keybinding in `keybindings.ts` (e.g. global `u`). The existing `playlist` command (enqueue the highlighted title) stays unchanged; this is a distinct **open** action.
- **Mount:** render `QueueShell` in `root-overlay-shell.tsx` as a sibling surface to `HistoryShell`, gated by a `queue` surface state (follow the exact pattern used for history/download: a surface kind + render branch + Esc-to-close + footer task label).
- **Entry points:** the command/hotkey, and a "View queue" affordance from post-play and the playback rail's "Up next" card.

## Data flow

All derivation is pure and lives in a new `apps/cli/src/app-shell/queue-view.ts` (mirrors `history-view.ts`). The shell is render-only.

```
QueueService.getAll() ─┐
QueuePosterResolver ────┼─> buildQueueView(input) ─> QueueView ─> QueueShell
viewport / selectedId ─┘
```

### `buildQueueView(input): QueueView`

Input:

- `entries: readonly QueueEntry[]` — from `QueueService.getAll()` (played items keep their leading slots; unplayed form the manageable tail).
- `selectedId: string | null` — currently highlighted row.
- `resolvePoster: (titleId: string) => string | undefined` — poster URL resolver (see below).
- `recoverableSessions: number` — `listRecoverableSessions().length` (drives the restore affordance when the active queue is empty).
- `status: QueueStatus` — from `getStatus()` (unplayedCount, nextItem, isStale).

Output `QueueView`:

```ts
export type QueueRowState = "playing" | "pending" | "played";

export type QueueViewRow = {
  readonly id: string;
  readonly title: string;
  readonly episodeLabel: string; // "S02·E08" | "E08" | "Movie"
  readonly sourceLabel: string; // "from history" | "watchlist" | "post-play" | "added"
  readonly state: QueueRowState;
  readonly position: number; // 1-based display position among unplayed
  readonly posterUrl?: string; // for the mini-poster + hero
  readonly titleId: string;
};

export type QueueView = {
  readonly state: "empty" | "success";
  readonly rows: readonly QueueViewRow[]; // played (dim, leading) then unplayed
  readonly selectedIndex: number;
  readonly counts: { readonly unplayed: number; readonly total: number };
  readonly stale: boolean;
  readonly recoverableSessions: number;
  readonly rail: QueueRailModel | null; // selected row → hero rail model
  readonly emptyHint: string; // copy depends on recoverableSessions
};
```

- **Episode label:** from `season`/`episode`/`absoluteEpisode`/`mediaKind` (reuse the same formatting approach as history `episodeCode`; movies → "Movie").
- **Source label:** map `QueueEntry.source` (`"history"`, `"watchlist"`, `"post-play"`, `"manual"`, …) to friendly copy; unknown → "added".
- **State:** `playedAt` set → `played`; the first unplayed (== `peekNext`) → `playing`-eligible marker; rest → `pending`.
- **Empty hint:** if `recoverableSessions > 0` → "Queue is empty · press r to restore your last queue"; else → "Queue is empty · add from browse, history, or post-play (q)".

## Poster strategy (Variant B / hybrid)

### Resolver

`QueueEntry` has **no** poster URL. Add `apps/cli/src/app-shell/queue-poster-resolver.ts` exporting a `QueuePosterResolver` type `(titleId: string) => string | undefined` and a default implementation that looks up a persisted poster by `titleId` from the same source history uses (the history/catalog poster persistence — `view.rail.posterUrl` in history comes from persisted history). Missing → `undefined` (row falls back to an initials tile). The resolver is injected from `root-overlay-shell` so `buildQueueView` stays pure and testable.

### Rendering rules (the one-Kitty-image constraint)

- **List mini-posters (every visible row):** `usePosterPreview(url, { rows: 3, cols: 6, allowKitty: false, preserveTerminalImages: true, variant: "preview", debounceMs: 160 })`. `allowKitty: false` forces the **text/half-block** poster (`kind: "text"`, just coloured characters — many can coexist). `preserveTerminalImages: true` ensures a row render never calls `clearRenderedPosterImages()` and so never wipes the hero's Kitty image. No URL → small initials/colour tile (reuse the history tile look).
- **Hero (selected row only, wide rail):** the existing real-poster path (Kitty allowed) via `PreviewRail` / the history rail mechanism — exactly one Kitty image at a time, keyed on the selected `titleId`.
- **Caching:** mini-posters must be cached by `url + rows + cols` so scrolling/re-render doesn't re-run `chafa` per frame. Confirm `image-pane.fetchPoster` already caches text renders; if not, add a small in-process cache keyed on `url|rows|cols|variant`. (Risk flagged below.)
- **Capability fallback:** when the terminal has no image support, mini-posters degrade to initials tiles and the hero degrades to the framed initials tile we just added to `PreviewRail`. The view never blocks on art.

## Layout

Two-pane, reusing `MediaListShell` (list left, rail right; rail auto-hides < 124 cols):

```
 Up Next · 6 queued · this session
 ──────────────────────────────────────────────         ╭──────────────╮
  1 ▓▓ The Eminence in Shadow      S02·E08  ▶ playing     │  hero poster │
  2 ▓▓ Solo Leveling               S01·E02  from history  │  (selected)  │
 ▌3 ▓▓ Frieren                     S01·E12  watchlist     ╰──────────────╯
  4 ▓▓ Dan Da Dan                  S02·E03  post-play      Frieren
  5 ▓▓ Kaiju No.8                  S02·E01  watchlist      S01 · E12
                                                           ▶ play · ⏎
 ↑↓ select · ⏎ play · J/K reorder · x remove · c clear · r restore
```

- **Header:** "Up Next" + dim `· N queued · this session`; stale sessions add a quiet `· stale` tag.
- **List rows:** `position` · mini-poster cell · flex `title` · `episodeLabel` · `sourceLabel`/state. Played rows render dim above the unplayed tail. Reuse `ListRow` + `list-row-layout` column math; add a leading poster cell (fixed ~7 cols) ahead of the columns.
- **Rail (wide only):** hero poster of the selected row + title + episode + primary action hint; reuse `PreviewRail` model shape.
- **Responsive:** rail hidden < 124 cols (rows still show mini-posters); dense chrome (margins → 0) when `viewport.rows < 28`; standard windowing for long queues.

## Interactions

| Key                      | Action                                         | Service call                                                                                                                  |
| ------------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `↑` / `↓`                | move selection                                 | —                                                                                                                             |
| `⏎`                      | play selected now                              | mark prior played + start playback for the selected entry (wire through the existing playback-start path; see Open Questions) |
| `J` / `K` (or `]` / `[`) | reorder selected down/up among unplayed        | `moveDown(id)` / `moveUp(id)`                                                                                                 |
| `x`                      | remove selected                                | `remove(id)`                                                                                                                  |
| `c`                      | clear queue (confirm)                          | `clear()`                                                                                                                     |
| `C`                      | clear played only                              | `clearPlayed()`                                                                                                               |
| `r`                      | restore last recoverable session (empty state) | `restoreRecoverableSession(id)`                                                                                               |
| `Esc`                    | close surface                                  | —                                                                                                                             |

Reorder/remove re-run `buildQueueView` from the service's fresh `getAll()` so the view always reflects persisted truth. Selection stays on the moved item after reorder.

## States

- **Empty (no recoverable):** centered hint + "add from browse/history/post-play".
- **Empty (recoverable):** hint + `r restore` affordance; pressing `r` restores and repopulates.
- **Single item / played-only:** valid; played rows dim, no unplayed tail → "nothing queued next".
- **Stale session:** header `· stale` tag (older than 3 days per `STALE_THRESHOLD_MS`).
- **No poster:** initials tile (row) / framed initials (hero).
- **Narrow / short:** rail hidden / dense chrome as above.

## Components & files

**New**

- `apps/cli/src/app-shell/queue-view.ts` — `buildQueueView`, types, label helpers (pure).
- `apps/cli/src/app-shell/queue-shell.tsx` — `QueueShell` (render-only), the mini-poster row cell.
- `apps/cli/src/app-shell/queue-poster-resolver.ts` — `QueuePosterResolver` type + default impl.

**Modified**

- `root-overlay-shell.tsx` — mount `QueueShell`, wire `QueueService` + resolver + input handlers, footer task label, Esc/close.
- `commands.ts` — add `queue` command id + include in relevant command sets.
- `keybindings.ts` — add open-queue binding (and the in-surface reorder/remove/clear/restore bindings).
- `container.ts` — expose the poster resolver dependency if not already reachable.

## Testing

- **`queue-view.test.ts`** (pure): episode/source label mapping; played-then-unplayed ordering; 1-based positions; state derivation (playing/pending/played); empty vs recoverable hint; rail model for selected.
- **`queue-shell.test.tsx`** (render-capture): full-frame snapshots at 72/100/140 + short height; assert no detached rule lines / clean rows (reuse the schedule/history harness patterns); rail shows on wide only.
- **Interaction/logic:** reorder keeps selection on moved item; remove updates positions; empty→restore path. (Logic via the pure builder + thin handler tests; avoid driving real playback.)
- Mini-poster fallback to initials tile when resolver returns `undefined`.

## Risks / open questions

1. **Play wiring:** starting playback for an arbitrary queue entry must reuse the existing session-start flow (`apps/cli/src/main.ts` / session-flow), not a new path. Exact handoff (how `⏎` from the queue hands an entry to the player and advances the queue) to be confirmed against the current playback-start code during planning.
2. **Mini-poster performance:** many rows × `chafa` text renders. Mitigation: text-mode only, small `cols`, debounce, and a URL+size cache. If `image-pane` lacks a text-render cache, add one in the plan.
3. **Poster resolver source of truth:** confirm the persisted-poster lookup history uses is reachable by `titleId` for arbitrary queue items (some queue items may never have been watched → no poster → initials tile, which is acceptable).
4. **Open-key collision:** confirm `u` (or chosen key) is free in the global keymap.

## Rollout

Single PR/branch behind the normal quality gate (typecheck/lint/test/build) + a render-capture smoke. No migration (storage unchanged). Block mini-poster polish/perf tuning can iterate after first ship without changing the surface contract.
