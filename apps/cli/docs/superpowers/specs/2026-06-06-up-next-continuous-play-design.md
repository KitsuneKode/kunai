# Up Next — Continuous Play (Spec 1 of 3)

Date: 2026-06-06
Status: Approved (brainstorming) — pending implementation plan
Approach: **A** — a pure `resolveNextUp()` decision seam + the existing `QueueService` owning all queue management. (Considered B, a unified `UpNextService`; rejected to avoid refactoring the working episode-autoplay path.)

This is **Spec 1** of a 3-spec decomposition (see "Roadmap & cross-references" at the end):

1. **Up Next spine** (this doc) — continuous play + the basics of managing it.
2. Queue management — reorder, collapse, save-as-playlist, download-whole-queue.
3. Playlist authoring — mixed playlists, play-playlist → Up Next, viewing order, download-playlist.

## Goal

Press play once and the app keeps going: **next episode → your queue → a recommendation**, always with a visible, cancelable "Up next." Make playing/queuing from recommendations, search, and discover effortless (YouTube-style), reusing the queue/autoplay infrastructure that already exists.

## What already exists (reused, not rebuilt)

- **`QueueService`** (`apps/cli/src/domain/queue/QueueService.ts`): `enqueueMediaItem(item, { placement: "next" | "after-current-chain" | "end" })`, `peekNext`, `advance`, `remove(id)`, `clear`, `clearPlayed`, `getUnplayed`, `getAll`, `markCurrentPlayed`. Session-backed in SQLite (`playlist_queue`, `playback_queue_sessions`). **Placement (next/end), removal, clear already work.**
- **Episode autoplay** (`autoNext`) + **cross-title queue advance** with a cancelable countdown (`PlaybackPhase.ts:2517`, `runAutoplayAdvanceCountdown`).
- **Post-play recommendations** with enqueue (`enqueuePostPlaybackRecommendation`, `playback-recommendation-actions.ts`).
- **`DownloadService`** (offline downloads) — reused for batch download in Specs 2/3.

## 1. `resolveNextUp()` — the one new piece of logic (pure)

A pure, unit-tested decision function — the single seam that replaces the scattered next-up checks at `PlaybackPhase.ts:1582` (episode) and `:2517` (queue).

```ts
type NextUp =
  | { kind: "episode"; episode: EpisodeInfo }
  | { kind: "queue"; entry: QueueEntry }
  | { kind: "recommendation"; item: MediaItem };

function resolveNextUp(input: {
  readonly nextEpisode: EpisodeInfo | null; // released next episode of the current title, else null
  readonly queueHead: QueueEntry | undefined; // queueService.peekNext()
  readonly topRecommendation: MediaItem | null; // best post-play rec, or null
  readonly seriesDone: boolean; // caught up / finished the current title
  readonly autoplayRecommendations: boolean; // config setting
}): NextUp | null;
```

**Priority:** `nextEpisode` → `queueHead` → (`topRecommendation` **only when** `seriesDone && autoplayRecommendations`) → `null` (truly stop).

- _What it does:_ decide what plays next. _Depends on:_ the four inputs only — no I/O, no container. _Fully testable._
- Episode- vs title-level queue entries are handled identically (the entry already carries `season`/`episode`).

## 2. Auto-continue (YouTube-style)

- New config `autoplayRecommendations: boolean` (default **true**; `KitsuneConfig` + default + spread-backfill, same pattern as `favoriteSources`).
- On post-play, when `resolveNextUp` returns `{ kind: "recommendation" }`, run the **existing** `runAutoplayAdvanceCountdown` (5s, `Up next: <title> in 5s · a to pause`). Complete → play it; cancel → stay in post-play. This extends the same countdown the episode + queue paths already use; it does **not** add a new countdown mechanism.
- Honors `autoplayPaused` / `stopAfterCurrent` exactly like the existing advance (a failed-start no longer pauses autoplay — already fixed).

## 3. Play-from-recommendation keys (post-play)

On the post-play recommendation cards (1·2·3), wired in `post-play-input.ts` (no number handling today):

- **`1`/`2`/`3`** → play that recommendation **now** (jump to it).
- **`+`** → `enqueueMediaItem(rec, { placement: "end" })` — add to the end of Up Next.
- **`n`** → `enqueueMediaItem(rec, { placement: "next" })` — play next (insert at front).

Footer hints updated accordingly.

## 4. Always-visible "Up next" + `/queue` panel

- **Always-visible hint:** a one-line `Up next: <title>` on the active-playback status and post-play surfaces, derived from `resolveNextUp` so it reflects what _will_ actually play (episode/queue/rec). Lightweight — no new chrome.
- **`/queue` panel:** a two-pane surface (reuse `MediaListShell` + poster rail) listing `queueService.getUnplayed()`. Keys: `⏎` play now · `x`/`del` remove (`queueService.remove`) · `c` clear · `n` play-next / `+` end. (Reorder/collapse → Spec 2.)
- **Remap `/queue`:** today `/queue` aliases the downloads panel. Point `/queue` at the Up Next panel; downloads keep `/downloads` and `/jobs`. (Command-registry change — coordinate with the deferred `/streams` cleanup, Task 10.)

## 5. Enqueue entry points (episode- or title-level)

- **Post-play rec** — §3.
- **Search/browse row** — a key (e.g. `q`) enqueues the highlighted title (end). From the episode picker, enqueue **a specific episode**.
- **`/discover`** — add-to-queue from the recommendations surface.
- Playlists (`play playlist` → loads Up Next) → **Spec 3**.

## 6. Existing-logic fixes folded in (make it "much better")

These are correctness/quality fixes to the surfaces this spec touches — included because recommendations now drive auto-continue, so they must be reliable:

- **Recommendations reliability (warm-race).** Post-play recs "sometimes" don't appear because they warm in a background task whose result can miss first paint. Since `resolveNextUp` may depend on the top rec, make the post-play rec load **deterministic**: a bounded foreground fetch (≤ ~1200ms) before the post-play surface paints, loaded at most once per post-play session, with the warm cache as a fast path. (Builds on the prior `649e8930` fix; verify it actually populates.)
- **Small poster thumbnails on rec cards.** The post-play "you might also like" cards are text-only; add a small poster thumbnail per card (reuse `usePosterPreview`, same mechanism now used by the history rail). Wide-only; degrades to text.
- **`autoplayPaused` honesty.** Ensure the Up Next hint and auto-continue never fire when the user explicitly paused autoplay or set stop-after-current.

## 7. Testing

- `resolveNextUp`: episode-priority, queue-priority, rec-only-when (`seriesDone && setting`), `null` when nothing — pure unit tests.
- Placement: `next` vs `end` (mostly existing `QueuePlanner` coverage).
- Config: `autoplayRecommendations` default + backfill.
- `/queue` panel model: list/remove/clear over `getUnplayed`.
- Gate green: `bun run typecheck`, `bun run lint`, `bun run test`.
- **Live-verify (user TTY):** the rec auto-continue countdown, play-from-rec keys, the Up Next hint, and rec-card posters render correctly.

## Non-goals (Spec 1)

- Reorder, collapse, save-queue-as-playlist, download-whole-queue → **Spec 2**.
- Playlist authoring, play-playlist, viewing order, download-playlist → **Spec 3**.
- Poster _rendering_ ghosts (post-play overlap #13, history lines #8) — a separate Kitty-graphics investigation needing the user's terminal.

## Roadmap & cross-references (everything discussed, matched up)

**Shipped on main** (this session): tracks favorites + auto-select; #1 classification (+ backfill); #2 calendar day-strip sort; #3 filter-box gate; #4 history type filter; autoplay-no-pause-on-failed-start; single-season episode-picker escape; list-row status spill; tracks footer; #6 history poster persist/restore; #7 picker poster; installer Bun fix.

**This feature:** Spec 1 (here) → Spec 2 (queue management) → Spec 3 (playlist authoring).

**Still open elsewhere** (tracked in `2026-06-06-history-calendar-classification-findings.md`):

- **#5 series-%** — needs a reliable "episodes in series" denominator (deferred; `title.episodeCount` is ambiguous across seasons/anime).
- **Poster-ghost class** — post-play overlap (#13) + history broken lines (#8): real Kitty failed-image regions, TTY-only.
- **Task 10** — drop the redundant `/streams` umbrella command, add `/audio` `/subtitles` deep-links (coordinate with the `/queue` remap in §4).
