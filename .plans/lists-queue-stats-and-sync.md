# Lists, Up Next, Stats, and Sync — Historical Implementation Plan

Status: historical / partially superseded

> **Vocabulary supersession (2026-06-25):** Decision #1 below is no longer current product truth. Kunai now uses **Playlists** for durable named collections and **Up Next** for runtime playback order. `/playlist` and `/pl` are compatibility aliases for `/playlists`; `/queue` is a compatibility alias for `/up-next`; `/downloads` remains download jobs. See [ADR 0001](../.docs/adr/0001-personal-media-vocabulary.md) and [plan-implementation-truth.md](./plan-implementation-truth.md).

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. Each task is self-contained with tests before implementation. Read the Design Decisions table before touching any file — several assumptions in the original plan were corrected.

---

## Design Decisions (Grilled and Locked)

| #   | Decision               | Choice                                                                                                                                                                                                                                                         | Reason                                                                                                                                                                        |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Naming: playback queue | **Superseded.** Current product vocabulary is `/up-next` for runtime playback order, `/playlists` for durable collections, and `/downloads` for download jobs. Legacy `/playlist` remains an alias for `/playlists`; `/queue` remains an alias for `/up-next`. | The original `/playlist` decision avoided a download-job collision but blurred durable collections with playback order. ADR 0001 resolves that with one noun per user intent. |
| 2   | Stats data source      | **`history_progress` watch ledger** — `watched_seconds` (engaged time), `completed` / `completed_at`, `last_watched_at`; `playback_events` instrumented from mpv ticks                                                                                         | Stats v1 used duration/position overcount; ledger + events landed in migration `024` (2026-06).                                                                               |
| 3   | AniList OAuth          | **Localhost callback server** (temp `Bun.serve` on a random port, 60s window) + **PAT paste fallback**                                                                                                                                                         | AniList uses authorization code flow, not device code. No redirect receiver = no token. Localhost is the clean terminal-CLI approach.                                         |
| 4   | Token storage          | **`~/.config/kunai/sync-tokens.json`** written via `writeAtomicSecretJson` (`chmod 0o600` after rename)                                                                                                                                                        | `config.json` uses default umask (typically 644). Auth tokens grant write access to external accounts — they need a restricted file.                                          |
| 5   | `w` key in BrowseShell | **No interactive toggle** — search input is always live, `w` would conflict. **Read-only `[wl]` badge** on rows. Full watchlist actions in detail view, post-playback, `/playlist`, and command palette (`/wl`).                                               | Can't have plain letter shortcuts in a shell with a live text input.                                                                                                          |
| 6   | Smart playlist refill  | **Non-blocking** — SQLite sources fill synchronously (< 1 ms), discover recommendations fetch in background (fire-and-forget). Shows `◌ finding more…` spinner.                                                                                                | Episode-end → next episode must have zero added latency. Discover is a nice-to-have top-up, not a dependency.                                                                 |
| 7   | Calendar scope in v1   | Watchlist badge + Up Next action fall out naturally once `ListService` exists. **Week navigation (`[` / `]`) landed 2026-06.** Tracked-only tab + day filter in calendar UI.                                                                                   | Calendar infrastructure (day headers, group labels, sort) is already solid. Integration is trivial; navigation needs its own design pass.                                     |
| 8   | Streak definition      | **`completed = 1` OR `position_seconds ≥ 300` on a given UTC day**                                                                                                                                                                                             | Rewards real watching without counting accidental 10-second opens. Generous enough for long paused episodes.                                                                  |
| 9   | Playlist persistence   | **SQLite-persisted** (`playlist_queue` table). Shows "last active X days ago" if stale, offers `[c] clear` in one keypress.                                                                                                                                    | Playlist should survive app restart (pick up where you left off). Staleness UX prevents confusing old queues.                                                                 |
| 10  | Playlist auto-advance  | **5-second countdown cancel window** — `"Next: Title S01E04 in 5s  [space] cancel"`. Respects `toggle-autoplay` — if autoplay is off, banner waits indefinitely for Enter.                                                                                     | Identical to Netflix/Crunchyroll pattern. No surprise advances, but no friction either.                                                                                       |
| 11  | Sync ledger            | **Skipped in v1** — push-on-demand with no durable queue. Failures logged to diagnostics, header indicator turns amber.                                                                                                                                        | Build the UX and prove value first; harden with a ledger in v2 when failure patterns are known.                                                                               |
| 12  | Stats progress bars    | **Completed episodes + `watched_seconds`**, proportional bars; completion-rate and provider breakdown from ledger. No series total denominator.                                                                                                                | Total episode count per show from TMDB/AniList is still out of scope; engaged seconds fix overcount from duration fallback.                                                   |

---

## Architecture

```
@kunai/storage (new tables + repositories)
  009_data_lists migration  →  lists, list_items, playlist_queue tables
  repositories/lists.ts     →  ListRepository
  repositories/queue.ts     →  QueueRepository / QueueService adapters

apps/cli/src/infra/fs/
  atomic-write.ts           →  + writeAtomicSecretJson (chmod 0o600)

apps/cli/src/services/persistence/
  SyncTokenStore.ts         →  read/write sync-tokens.json

apps/cli/src/domain/lists/
  types.ts                  →  shared types (List, ListItem, PlaylistItem, ListKind)
  ListService.ts            →  CRUD + findByTitleId, watchlist toggle
  QueueService.ts           →  Up Next enqueue, dequeue, advance, smartRefill, staleness
  StatsService.ts           →  aggregation from history_progress (streak, heatmap, totals)
  StatsFormatter.ts         →  ANSI heatmap, progress bars, digest, CSV/JSON

apps/cli/src/services/sync/
  SyncAdapter.ts            →  interface + shared types
  AniListAdapter.ts         →  localhost OAuth + PAT fallback, GraphQL mutations
  TmdbAdapter.ts            →  localhost OAuth, REST endpoints
  SyncService.ts            →  push-on-demand, banner, no ledger

apps/cli/src/app/
  browse-option-mappers.ts  →  + watchlist badge on search rows (read-only)
  calendar-results.ts       →  + watchlist badge + Up Next action on calendar rows

apps/cli/src/app-shell/
  domain/session/command-registry.ts  →  + watchlist, playlists, up-next, stats, sync command IDs
  workflows.ts              →  + watchlist / playlists / up-next / stats / sync command handlers
  ink-shell.tsx             →  + post-playback watchlist/up-next/fav actions
                                + 5-second countdown banner (Up Next advance banner)
                                + streak + sync health indicator in header

apps/cli/src/app/PlaybackPhase.ts     →  + Up Next advance hook after history save
                                          + first-episode sync nudge (one-time)
apps/cli/src/container.ts             →  wire new services
apps/cli/src/services/persistence/ConfigService.ts  →  + sync config flags (no tokens)
```

---

## SQLite Migration `009_data_lists`

```sql
-- Lists (watchlist, favorites, custom)
CREATE TABLE IF NOT EXISTS lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,        -- "watchlist" | "favorites" | "custom"
  color TEXT,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Default lists seeded by migration
-- INSERT OR IGNORE INTO lists VALUES ('watchlist','Watchlist','watchlist',null,null,0,...)
-- INSERT OR IGNORE INTO lists VALUES ('favorites','Favorites','favorites',null,null,1,...)

-- List items
CREATE TABLE IF NOT EXISTS list_items (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  title_id TEXT NOT NULL,
  media_kind TEXT NOT NULL,   -- "movie" | "series" | "anime"
  title TEXT NOT NULL,
  season INTEGER,
  episode INTEGER,
  notes TEXT,
  added_at TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_list_items_list_id
  ON list_items(list_id, sort_order ASC);
CREATE INDEX IF NOT EXISTS idx_list_items_title_id
  ON list_items(title_id, added_at DESC);

-- Up Next queue (playback order, not download jobs)
CREATE TABLE IF NOT EXISTS playlist_queue (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  media_kind TEXT NOT NULL,
  title_id TEXT NOT NULL,
  season INTEGER,
  episode INTEGER,
  absolute_episode INTEGER,
  priority INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,      -- "watchlist" | "search" | "continue" | "smart"
  added_at TEXT NOT NULL,
  played_at TEXT,
  session_id TEXT NOT NULL   -- groups items added in the same session
);

CREATE INDEX IF NOT EXISTS idx_playlist_queue_priority
  ON playlist_queue(priority DESC, added_at ASC);
CREATE INDEX IF NOT EXISTS idx_playlist_queue_session
  ON playlist_queue(session_id, priority DESC, added_at ASC);
```

---

## Phase 1 — Storage + Domain Foundation

### Task 1.1: SQLite migration + repositories

**Files:**

- Modify: `packages/storage/src/migrations.ts`
- Create: `packages/storage/src/repositories/lists.ts`
- Create: `packages/storage/src/repositories/playlist.ts`
- Test: `packages/storage/test/repositories/lists.test.ts`
- Test: `packages/storage/test/repositories/playlist.test.ts`

- [ ] Add `009_data_lists` migration to `dataMigrations` array in `migrations.ts`
- [ ] Seed default `watchlist` and `favorites` rows in the migration using `INSERT OR IGNORE`
- [ ] Create `ListRepository` with:
  - `createList(input)` / `deleteList(id)` / `getAllLists()` / `getList(id)`
  - `addItem(input)` / `removeItem(id)` / `findByTitleId(titleId)` / `isInList(listId, titleId)`
  - `moveItem(id, newSortOrder)`
- [ ] Create `PlaylistRepository` with:
  - `enqueue(item)` / `getAll()` / `getUnplayed()` / `markPlayed(id)` / `remove(id)`
  - `clear()` / `clearPlayed()` / `reorder(ids)` / `getLatestSessionId()`
- [ ] Write tests for both repositories — use an in-memory `new Database(":memory:")` pattern matching existing storage tests
- [ ] Run `bun run test packages/storage/test/`

---

### Task 1.2: `writeAtomicSecretJson` + `SyncTokenStore`

**Files:**

- Modify: `apps/cli/src/infra/fs/atomic-write.ts`
- Create: `apps/cli/src/services/persistence/SyncTokenStore.ts`
- Test: `apps/cli/test/unit/services/persistence/sync-token-store.test.ts`

- [ ] Add to `atomic-write.ts`:

```ts
import { chmod } from "node:fs/promises";

export async function writeAtomicSecretJson(targetPath: string, value: unknown): Promise<void> {
  await writeAtomicText(targetPath, JSON.stringify(value, null, 2));
  // Restrict to owner read/write only — tokens must not be world-readable
  await chmod(targetPath, 0o600);
}
```

- [ ] Create `SyncTokenStore`:

```ts
export interface SyncTokens {
  anilist?: { accessToken: string; expiresAt?: number };
  tmdb?: { sessionId: string; accountId: number };
}

export class SyncTokenStore {
  constructor(private readonly path: string) {}
  async read(): Promise<SyncTokens>;
  async write(tokens: SyncTokens): Promise<void>; // uses writeAtomicSecretJson
  async clear(target: "anilist" | "tmdb"): Promise<void>;
  isAniListConnected(): boolean;
  isTmdbConnected(): boolean;
}
```

- [ ] Write tests: round-trip read/write, clear single target, gracefully returns `{}` when file missing
- [ ] Run `bun run test apps/cli/test/unit/services/persistence/sync-token-store.test.ts`

---

### Task 1.3: `ListService` domain

**Files:**

- Create: `apps/cli/src/domain/lists/types.ts`
- Create: `apps/cli/src/domain/lists/ListService.ts`
- Test: `apps/cli/test/unit/domain/lists/list-service.test.ts`

- [ ] Define in `types.ts`:

```ts
export type ListKind = "watchlist" | "favorites" | "custom";

export interface KunaiList {
  readonly id: string;
  readonly name: string;
  readonly kind: ListKind;
  readonly sortOrder: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ListItem {
  readonly id: string;
  readonly listId: string;
  readonly titleId: string;
  readonly mediaKind: "movie" | "series" | "anime";
  readonly title: string;
  readonly season?: number;
  readonly episode?: number;
  readonly addedAt: string;
  readonly sortOrder: number;
}

export interface AddToListInput {
  readonly listId: string;
  readonly titleId: string;
  readonly mediaKind: "movie" | "series" | "anime";
  readonly title: string;
  readonly season?: number;
  readonly episode?: number;
}
```

- [ ] Implement `ListService`:
  - `addToList(input: AddToListInput): ListItem`
  - `removeFromList(listId: string, titleId: string): void`
  - `toggleWatchlist(input: Omit<AddToListInput, "listId">): { added: boolean }` — add if absent, remove if present
  - `isInList(listId: string, titleId: string): boolean`
  - `getListItems(listId: string): readonly ListItem[]`
  - `getAllLists(): readonly KunaiList[]`
  - `createList(name: string, kind?: ListKind): KunaiList`
  - `deleteList(id: string): void` — guards against deleting "watchlist" / "favorites"
  - `getListsForTitle(titleId: string): readonly KunaiList[]` — which lists contain this title (for badge)

- [ ] Write tests: toggleWatchlist idempotency, deleteList guard, getListsForTitle returns correct lists
- [ ] Run `bun run test apps/cli/test/unit/domain/lists/list-service.test.ts`

---

### Task 1.4: `PlaylistService` domain

**Files:**

- Create: `apps/cli/src/domain/lists/PlaylistService.ts`
- Test: `apps/cli/test/unit/domain/lists/playlist-service.test.ts`

- [ ] Define `PlaylistItem` in `types.ts`:

```ts
export interface PlaylistItem {
  readonly id: string;
  readonly titleId: string;
  readonly title: string;
  readonly mediaKind: "movie" | "series" | "anime";
  readonly season?: number;
  readonly episode?: number;
  readonly source: "watchlist" | "search" | "continue" | "smart";
  readonly addedAt: string;
  readonly playedAt?: string;
  readonly sessionId: string;
}
```

- [ ] Implement `PlaylistService`:
  - `enqueue(items: Omit<PlaylistItem, "id" | "addedAt" | "sessionId">[]): void`
  - `getQueue(): readonly PlaylistItem[]` — unplayed only, priority order
  - `getAll(): readonly PlaylistItem[]` — includes played, for display
  - `advance(): PlaylistItem | null` — marks current as played, returns next unplayed
  - `remove(id: string): void`
  - `shuffle(): void` — Fisher-Yates on unplayed items, updates priority
  - `clearPlayed(): void`
  - `clear(): void`
  - `getSessionAge(): number | null` — ms since last `added_at` in current session
  - `isStale(thresholdMs = 7 * 24 * 60 * 60 * 1000): boolean` — > 7 days old
  - `startSmartRefill(opts: SmartRefillOpts): void` — non-blocking; fills from SQLite synchronously then fires discover background fetch

- [ ] `smartRefill` logic:
  1. **Synchronous**: query `history_progress` for in-progress titles (not fully completed), take top 5 newest; filter out already-queued `title_id`s
  2. **Synchronous**: query `list_items` WHERE `list_id = 'watchlist'`, take top 5; filter duplicates
  3. **Async (fire-and-forget)**: call `recommendationService.getRecommendations()` — on success, append up to 3 items; on failure, log to diagnostics silently

- [ ] Write tests: advance ordering, shuffle preserves played items, isStale threshold, smartRefill SQLite sources only (mock discover as always-failing)
- [ ] Run `bun run test apps/cli/test/unit/domain/lists/playlist-service.test.ts`

---

### Task 1.5: `StatsService` domain

**Files:**

- Create: `apps/cli/src/domain/lists/StatsService.ts`
- Test: `apps/cli/test/unit/domain/lists/stats-service.test.ts`

Data source: `HistoryRepository` (SQLite, synchronous). All aggregations are pure SQL + TypeScript, no network.

- [ ] Implement:

```ts
export interface HeatmapDay {
  readonly date: string; // "YYYY-MM-DD"
  readonly episodesWatched: number;
  readonly minutesWatched: number; // sum of duration_seconds/60 for completed + partial (≥300s)
  readonly level: 0 | 1 | 2 | 3; // 0=none, 1=<30m, 2=30-90m, 3=90m+
}

export interface ShowBreakdownItem {
  readonly titleId: string;
  readonly title: string;
  readonly mediaKind: string;
  readonly episodesWatched: number;
  readonly minutesWatched: number;
  readonly lastWatchedAt: string;
}

export interface StatsTotals {
  readonly episodesWatched: number;
  readonly minutesWatched: number;
  readonly uniqueTitles: number;
  readonly streakDays: number;
  readonly peakDay: { date: string; minutesWatched: number } | null;
}

class StatsService {
  monthlyHeatmap(year: number, month: number): HeatmapDay[];
  breakdownByShow(rangeDays: number): ShowBreakdownItem[];
  breakdownByProvider(rangeDays: number): { providerId: string; minutesWatched: number }[];
  totals(rangeDays: number): StatsTotals;
  streakDays(): number;
  exportJson(rangeDays: number): object;
  exportCsv(rangeDays: number): string;
}
```

- [ ] `streakDays()` implementation:
  - Query `history_progress` WHERE `(completed = 1 OR position_seconds >= 300)` GROUP BY `date(updated_at)` ORDER BY date DESC
  - Walk dates from today backwards; count consecutive days until gap

- [ ] `monthlyHeatmap()`:
  - Query completed/substantial rows for the month
  - Group by `date(updated_at)`, sum `duration_seconds` → minutes
  - Map minutes to intensity level: 0 = 0 min, 1 = 1–29 min, 2 = 30–89 min, 3 = 90+ min

- [ ] Write tests with seeded history rows; verify streak gaps break correctly, heatmap level thresholds
- [ ] Run `bun run test apps/cli/test/unit/domain/lists/stats-service.test.ts`

---

### Task 1.6: `StatsFormatter`

**Files:**

- Create: `apps/cli/src/domain/lists/StatsFormatter.ts`
- Test: `apps/cli/test/unit/domain/lists/stats-formatter.test.ts`

- [ ] Implement:

```ts
class StatsFormatter {
  // ANSI 256-color heatmap — 4 intensity levels
  // Level 0: \x1b[48;5;237m  (dim gray)
  // Level 1: \x1b[48;5;22m   (green dim)
  // Level 2: \x1b[48;5;28m   (green mid)
  // Level 3: \x1b[48;5;46m   (green bright)
  // Each day = one "█" block. Week rows: Mon Tue Wed Thu Fri Sat Sun
  formatHeatmap(days: HeatmapDay[], month: string): string;

  // Progress bar: ▓▓▓▓▓░░░░░  14 ep · 5h 20m
  // Bar width proportional to most-watched show in set (not series total)
  formatProgressBar(item: ShowBreakdownItem, maxMinutes: number, barWidth?: number): string;

  // Mon digest: "Week 20 · 12h across 7 shows · Streak: 14d 🔥"
  formatWeeklyDigest(totals: StatsTotals, shows: ShowBreakdownItem[]): string;

  formatProviderTable(rows: { providerId: string; minutesWatched: number }[]): string;
  formatCsv(shows: ShowBreakdownItem[]): string;
  formatJsonExport(totals: StatsTotals, shows: ShowBreakdownItem[], heatmap: HeatmapDay[]): object;
}
```

- [ ] Tests: heatmap renders 7 rows (Mon–Sun), progress bar proportional width, CSV quoting handles commas in titles
- [ ] Run `bun run test apps/cli/test/unit/domain/lists/stats-formatter.test.ts`

---

### Task 1.7: Wire into container + config

**Files:**

- Modify: `apps/cli/src/container.ts`
- Modify: `apps/cli/src/services/persistence/ConfigService.ts`

- [ ] Add to `KitsuneConfig`:

```ts
sync: {
  anilist: {
    enabled: boolean;
    tracker: boolean;
    list: boolean;
  }
  tmdb: {
    enabled: boolean;
    tracker: boolean;
    list: boolean;
  }
}
// All default false. Tokens live in sync-tokens.json, NOT here.
```

- [ ] Instantiate in `container.ts`:
  - `listRepository = new ListRepository(dataDb)`
  - `playlistRepository = new PlaylistRepository(dataDb)`
  - `listService = new ListService(listRepository)`
  - `playlistService = new PlaylistService(playlistRepository, listRepository, historyRepository)`
  - `statsService = new StatsService(historyRepository)`
  - `statsFormatter = new StatsFormatter()`
  - `syncTokenStore = new SyncTokenStore(join(kunaiPaths.configDir, "sync-tokens.json"))`

- [ ] Add all to `Container` interface
- [ ] Run `bun run typecheck`

---

## Phase 2 — Command Surface + Shell Integration

### Task 2.1: New command IDs

> **Current command truth:** use `watchlist`, `playlists`, `up-next`, `bookmark`, `follow`, `unfollow`, and `mute`. Legacy `wl`, `playlist`, `pl`, and `queue` are aliases, not separate product surfaces.

**Files:**

- Modify: `apps/cli/src/domain/session/command-registry.ts`

- [ ] Add to `AppCommandId`:
  ```ts
  | "wl"          // watchlist
  | "wl-add"      // add focused item to watchlist (detail/post-playback context)
  | "wl-remove"   // remove from watchlist
  | "playlists"   // durable named collections
  | "up-next"     // runtime playback order
  | "playlist-add" // legacy command id; displayed as Add to Up Next
  | "stats"       // stats overview
  | "sync"        // sync status / push / pull
  | "sync-connect-anilist"
  | "sync-connect-tmdb"
  ```
- [ ] Add definitions (label, aliases, description) for each
- [ ] Add `watchlist`, `playlists`, `up-next`, `stats`, `sync` to appropriate command contexts
- [ ] Add `bookmark` and `playlist-add` to current-title / playback contexts
- [ ] Update `command-registry-contexts.test.ts` to match new order
- [ ] Run `bun run test apps/cli/test/unit/domain/session/`

---

### Task 2.2: `/wl` command workflows

**Files:**

- Create: `apps/cli/src/app-shell/commands/list-commands.ts`
- Modify: `apps/cli/src/app-shell/workflows.ts`

- [ ] `openWatchlistOverlay(container)`:
  - Picker of watchlist items; each row shows title + media kind + `added_at` relative date
  - `Enter` opens detail (same workflow as history picker → resolve to playback)
  - `x` removes from watchlist (confirm)
  - Footer: `[enter] play · [x] remove · [/] commands · [esc] close`

- [ ] `addFocusedResultToWatchlist(container, result)`:
  - Calls `listService.toggleWatchlist(...)`, returns `{ added: boolean }`
  - Dispatches `SET_PLAYBACK_FEEDBACK` note: `"Added to Watchlist"` or `"Removed from Watchlist"`

- [ ] `openListPicker(container, result)`:
  - Shows all lists; user selects one to add/remove
  - Used by `W` in detail view and post-playback

- [ ] Wire `/wl` command in `workflows.ts` → `openWatchlistOverlay`
- [ ] Run `bun run typecheck`

---

### Task 2.3: `/up-next` command workflows

> **Current command truth:** `/up-next` opens runtime playback order. `/playlist` opens durable Playlists through its compatibility alias.

**Files:**

- Create: `apps/cli/src/app-shell/commands/playlist-commands.ts`
- Modify: `apps/cli/src/app-shell/workflows.ts`

- [ ] `openPlaylistOverlay(container)`:
  - Shows unplayed items in priority order with `▸` indicator on "up next"
  - If `playlistService.isStale()`: renders "Last active X days ago · [c] clear" above list
  - Footer: `[enter] play now · [↑↓] reorder · [x] remove · [s] shuffle · [c] clear played · [esc] close`

- [ ] `addToPlaylist(container, result, source)`:
  - Calls `playlistService.enqueue(...)`, dispatches feedback note

- [ ] Wire `/up-next` command → Up Next overlay/workflow
- [ ] Keep `/queue` as a compatibility alias for `/up-next`
- [ ] Run `bun run typecheck`

---

### Task 2.4: `/stats` command workflows

**Files:**

- Create: `apps/cli/src/app-shell/commands/stats-commands.ts`
- Modify: `apps/cli/src/app-shell/workflows.ts`

- [ ] `openStatsOverlay(container, opts?)`:
  - Computes `statsService.monthlyHeatmap()` + `totals(30)` + `breakdownByShow(30)`
  - Renders via `StatsFormatter` — heatmap first, then show breakdown bars, then totals line
  - Keys: `[h] heatmap · [s] by show · [p] by provider · [e] export json · [esc] close`
  - Export writes to `~/kunai-stats-YYYY-MM-DD.json` and prints path

- [ ] If no history: shows "Nothing to show yet. Watch your first episode!" with action links
- [ ] Wire `/stats` command → `openStatsOverlay`
- [ ] Run `bun run typecheck`

---

### Task 2.5: Read-only watchlist badge on BrowseShell rows

**Files:**

- Modify: `apps/cli/src/app/browse-option-mappers.ts`
- Modify: `apps/cli/src/app-shell/ink-shell.tsx` (BrowseShell search call)

- [ ] Thread `listService` into the BrowseShell search pipeline
- [ ] In `toBrowseResultOption`, add watchlist check:

```ts
const inWatchlist = listService?.isInList("watchlist", result.id) ?? false;
// Append to previewBadge or add a dedicated field
// Recommended: previewBadge takes priority over displayBadge from calendar
const wlBadge = inWatchlist ? "wl✓" : null;
```

- [ ] Render `wl✓` as a dim suffix on the row — it should not displace the episode/rating badge
- [ ] No key handler added to BrowseShell — badge is purely visual
- [ ] Run `bun run typecheck`

---

### Task 2.6: Calendar Watchlist badge + Up Next action

**Files:**

- Modify: `apps/cli/src/app/calendar-results.ts`

- [ ] Pass `listService` into `loadCalendarResults`; add `inWatchlist` flag to each row via `displayBadge` field
- [ ] In `toCalendarSearchResult`, enrich `previewFacts` with:
  - "In watchlist" fact (tone: success) when `inWatchlist`
  - "Add to Up Next" action hint in the detail overlay footer
- [ ] Confirm Watchlist and Up Next actions work in the detail overlay when opened from calendar
- [ ] Run `bun run typecheck`

---

### Task 2.7: Detail view Watchlist + Up Next actions

**Files:**

- Modify: `apps/cli/src/app-shell/workflows.ts` — detail picker action context

- [ ] In the detail view picker (opened from search result Enter), add actions:
  - `w` → `toggleWatchlist` → feedback note
  - `W` → `openListPicker` (multi-list)
  - Add to Up Next → feedback note
  - Add to a durable playlist → opens a playlist picker
  - Footer updates: play, Watchlist, Up Next, info, back
- [ ] Run `bun run typecheck`

---

### Task 2.8: Post-playback Watchlist + Up Next + experimental Favorites actions

**Files:**

- Modify: `apps/cli/src/app/PlaybackPhase.ts` — post-playback option building

- [ ] In the post-playback options picker, add:
  - `[f] add to favorites` — calls `listService.addToList({ listId: "favorites", ... })`
  - `[w] add to watchlist` / `[r] remove from watchlist` — conditional on current watchlist state
  - Add to Up Next — enqueues current title's next episode
- [ ] Run `bun run typecheck`

---

## Phase 3 — Up Next Auto-Advance

### Task 3.1: Wire Up Next into playback continuation

**Files:**

- Modify: `apps/cli/src/app/PlaybackPhase.ts`

- [ ] After history save at episode end, check `container.queueService.getStatus()` / next unplayed item
- [ ] If Up Next has items AND `config.autoNext` is true:
  - Show 5-second countdown banner: `"Next: {title} S{s}E{e} in 5s  ·  [space] cancel  [enter] play now"`
  - Use `setTimeout(5000)` with `clearTimeout` on any keypress
  - On timeout: call `playlistService.advance()` → resolve next episode
  - On space/escape: cancel, go to normal post-playback screen
  - On Enter: immediate advance
- [ ] If `config.autoNext` is false: show indefinite banner waiting for Enter; space/esc cancels
- [ ] Write test: advance → marks item played → returns next unplayed (pure PlaylistService test, no PlaybackPhase mock needed)
- [ ] Run `bun run typecheck`

---

### Task 3.2: Smart refill hook

**Files:**

- Modify: `apps/cli/src/app/PlaybackPhase.ts`

- [ ] After playlist advance (when queue drops below 3 unplayed items), call `playlistService.startSmartRefill(opts)` — fire-and-forget, no await
- [ ] Smart refill never blocks the 5-second countdown — it runs in parallel
- [ ] Playlist overlay shows `◌ finding more…` at the bottom while background fetch is in-flight (tracked via a `refilling: boolean` field on `PlaylistService`)
- [ ] Run `bun run typecheck`

---

### Task 3.3: Playlist exhaust fallback

**Files:**

- Modify: `apps/cli/src/app/PlaybackPhase.ts` or `workflows.ts`

- [ ] When playlist is exhausted (advance returns `null`) and smart refill produced nothing:

```
Playlist complete.  N episodes watched.

  1. Continue {in-progress title} S01E04  (next unwatched)
  2. Play from Watchlist  (N items)
  3. [/] Search   [r] Repeat playlist   [q] Quit
```

- [ ] "Continue" option: queries `history_progress` for the most recently updated incomplete title
- [ ] "Play from Watchlist": takes the first unwatched watchlist item and enqueues it
- [ ] "Repeat": re-marks all played items as unplayed (`playedAt = null`), re-advances from top
- [ ] Run `bun run typecheck`

---

## Phase 4 — Sync

### Task 4.1: `SyncAdapter` interface + types

**Files:**

- Create: `apps/cli/src/services/sync/types.ts`
- Create: `apps/cli/src/services/sync/SyncAdapter.ts`
- Test: `apps/cli/test/unit/services/sync/sync-adapter-contract.test.ts`

- [ ] Define in `types.ts`:

```ts
export interface ProgressInput {
  titleId: string;
  title: string;
  mediaKind: "anime" | "series" | "movie";
  season?: number;
  episode?: number;
  completed: boolean;
  score?: number; // 0–100
}

export interface ListItemInput {
  titleId: string;
  title: string;
  mediaKind: "anime" | "series" | "movie";
  listKind: "watchlist" | "favorites";
}

export interface PulledItem extends ListItemInput {
  remoteId: string;
  status: string;
}

export type SyncResultStatus = "ok" | "skipped" | "failed";
export interface SyncResult {
  status: SyncResultStatus;
  error?: string;
}

export interface ConnectResult {
  success: boolean;
  error?: string;
}
```

- [ ] Define `SyncAdapter` interface:

```ts
export interface SyncAdapter {
  readonly id: "anilist" | "tmdb";
  isConnected(): boolean;
  connect(): Promise<ConnectResult>; // starts auth flow
  disconnect(): Promise<void>;
  pushProgress(input: ProgressInput): Promise<SyncResult>;
  pushListItems(items: ListItemInput[]): Promise<SyncResult[]>;
  pullRecentItems(days: number): Promise<PulledItem[]>;
}
```

- [ ] Write contract test: any adapter mock must satisfy the interface; verify push/pull return shapes
- [ ] Run `bun run test apps/cli/test/unit/services/sync/`

---

### Task 4.2: `AniListAdapter`

**Files:**

- Create: `apps/cli/src/services/sync/AniListAdapter.ts`
- Test: `apps/cli/test/unit/services/sync/anilist-adapter.test.ts`

- [ ] `connect()` flow:
  1. Find a free port with `Bun.listen` on 0
  2. Build authorize URL: `https://anilist.co/api/v2/oauth/authorize?client_id={id}&redirect_uri=http://localhost:{port}/callback&response_type=code`
  3. Open in browser: `Bun.spawn(["xdg-open", url])` on Linux, `open` on macOS
  4. Serve callback with `Bun.serve()` for 60s; on GET `/callback?code=...`:
     - POST `https://anilist.co/api/v2/oauth/token` with code
     - Store `accessToken` in `SyncTokenStore`
     - Return a "Connected! You can close this tab." response
  5. If 60s elapses: return `{ success: false, error: "Auth timed out" }`
  6. **PAT fallback**: if the env or user provides a PAT directly, skip the server and store directly

- [ ] `pushProgress()`: `SaveMediaListEntry` GraphQL mutation — maps `completed` → `COMPLETED`, in-progress → `CURRENT`, watchlist → `PLANNING`

- [ ] `pushListItems()`: batch `SaveMediaListEntry` mutations

- [ ] `pullRecentItems(days)`: `MediaListCollection` query filtered by `updatedAt >= now - days`

- [ ] Write tests with mocked `fetch` — verify GraphQL shape, status mapping, token refresh on 401
- [ ] Run `bun run test apps/cli/test/unit/services/sync/anilist-adapter.test.ts`

---

### Task 4.3: `TmdbAdapter`

**Files:**

- Create: `apps/cli/src/services/sync/TmdbAdapter.ts`
- Test: `apps/cli/test/unit/services/sync/tmdb-adapter.test.ts`

- [ ] `connect()` flow:
  1. `GET /authentication/token/new` → request token
  2. Build authorize URL: `https://www.themoviedb.org/authenticate/{token}?redirect_to=http://localhost:{port}/callback`
  3. Open browser, serve callback
  4. `POST /authentication/session/new` with token → session ID
  5. `GET /account` → account ID
  6. Store `{ sessionId, accountId }` in `SyncTokenStore`

- [ ] `pushListItems()`: `POST /account/{id}/watchlist` + `POST /account/{id}/favorite`

- [ ] `pullRecentItems(days)`: `GET /account/{id}/watchlist/movies` + `/watchlist/tv` + `/favorite/movies` + `/favorite/tv` — merge, deduplicate

- [ ] Note: TMDB does not support episode progress tracking — `pushProgress` returns `{ status: "skipped" }` for TMDB

- [ ] Write tests with mocked fetch
- [ ] Run `bun run test apps/cli/test/unit/services/sync/tmdb-adapter.test.ts`

---

### Task 4.4: `SyncService` (push-on-demand, no ledger)

**Files:**

- Create: `apps/cli/src/services/sync/SyncService.ts`
- Test: `apps/cli/test/unit/services/sync/sync-service.test.ts`

- [ ] Implement:

```ts
class SyncService {
  // Push-on-demand: collect diff from local state, show banner, execute
  async push(target: "anilist" | "tmdb" | "all"): Promise<SyncPushResult>;

  // Silent fire-and-forget tracker push (called by PlaybackPhase after episode end)
  trackerPush(input: ProgressInput): void;

  // Pull recent remote items into local lists
  async pull(target: "anilist" | "tmdb", days?: number): Promise<SyncPullResult>;

  // Connection status
  getStatus(): { anilist: SyncStatus; tmdb: SyncStatus };
  // SyncStatus = "connected" | "disconnected" | "error"
}
```

- [ ] `push()` collects all `list_items` that haven't been pushed yet (compare by `added_at` — items newer than last push timestamp stored in config)
- [ ] Shows diff banner in a picker overlay: `"Push 3 items to AniList? [y] yes [n] no [d] details"`
- [ ] On confirm: calls adapter, collects results, shows summary: `"Synced 3 items ✓"` or `"2 synced · 1 failed (see /diagnostics)"`
- [ ] `trackerPush()`: fire-and-forget, no banner, logs failures to diagnostics, turns header indicator amber on failure
- [ ] Write tests: push with no connected adapter returns graceful message; pull merges without duplicates
- [ ] Run `bun run test apps/cli/test/unit/services/sync/sync-service.test.ts`

---

### Task 4.5: `/sync` command workflows + settings

**Files:**

- Create: `apps/cli/src/app-shell/commands/sync-commands.ts`
- Modify: `apps/cli/src/app-shell/workflows.ts`

- [ ] `openSyncStatus(container)`: shows connection status per service with last-push timestamp
- [ ] `connectAniList(container)`: calls `aniListAdapter.connect()`, shows auth URL, waits, shows result
- [ ] `connectTmdb(container)`: same for TMDB
- [ ] `disconnectSync(container, target)`: calls `adapter.disconnect()`, confirms
- [ ] `runSyncPush(container, target)`: calls `syncService.push(target)` with diff banner
- [ ] `runSyncPull(container, target, days)`: calls `syncService.pull(target, days)` with diff banner
- [ ] Wire all to command registry
- [ ] Add sync section to settings overlay: enabled toggle, tracker toggle, list toggle, connect/disconnect action per service
- [ ] Run `bun run typecheck`

---

## Phase 5 — Polish + Header Signals

### Task 5.1: Streak + sync health indicator in header

**Files:**

- Modify: `apps/cli/src/app-shell/root-status-summary.ts`
- Modify: `apps/cli/src/app-shell/ink-shell.tsx`

- [ ] Add `streak?: number` and `syncHealth?: "ok" | "warn" | "error"` to `RootStatusSummary`

- [ ] In `buildRootStatusSummary`, compute:
  - `streak = statsService.streakDays()` — pure SQLite, fast
  - `syncHealth`: read last sync result from `syncService.getStatus()` — "warn" if any adapter has a failed last push, "error" if token expired

- [ ] Render in top bar, after the brand label (compact, never wraps):

```
Kunai  🔥 14d · sync✓                          ready
```

- [ ] `sync✓` = green (palette.teal), `sync⚠` = amber, `sync✗` = red
- [ ] Only show streak if ≥ 2 days (1-day streak is just "today", not worth displaying)
- [ ] Only show sync indicator if at least one service is connected
- [ ] Run `bun run typecheck`

---

### Task 5.2: Weekly digest (Monday first launch)

**Files:**

- Modify: `apps/cli/src/app/PlaybackPhase.ts` or `apps/cli/src/main.ts` (startup hook)

- [ ] Check on startup: is today Monday AND has no digest been shown this week (persist flag in config as `lastWeeklyDigestShownAt: string | null`)?
- [ ] If yes AND `statsService.totals(7).episodesWatched > 0`:
  - Show a dismissible overlay before the normal browse shell
  - Content: `StatsFormatter.formatWeeklyDigest(totals, shows)`
  - Keys: `[d] dismiss · [/] stats`
  - On dismiss: update `lastWeeklyDigestShownAt` in config
- [ ] Run `bun run typecheck`

---

### Task 5.3: First-episode sync nudge

**Files:**

- Modify: `apps/cli/src/app/PlaybackPhase.ts`

- [ ] After saving history for the very first completed episode ever (check `statsService.totals(9999).episodesWatched === 1`), AND no sync service is connected:
  - Show one-time prompt: `"Sync progress to AniList or TMDB? [y] setup  [n] not now"`
  - If "n": set `config.syncNudgeDismissedAt = now` — never shown again
  - If "y": open `/sync` connect flow
- [ ] Add `syncNudgeDismissedAt?: string` to `KitsuneConfig`
- [ ] Run `bun run typecheck`

---

### Task 5.4: Final checks

- [ ] Run `bun run typecheck` — 0 errors across all 8 packages
- [ ] Run `bun run lint` — 0 warnings
- [ ] Run `bun run fmt` — 0 changes
- [ ] Run `bun run test` — all pass (expect 671+ tests)
- [ ] Commit: `chore: finalize lists-playlist-stats-sync implementation`

---

## Non-Goals (explicit)

- No sync ledger / durable push queue in v1 — push-on-demand only
- No IMDb sync — no public write API
- No cross-domain ID reconciliation — anime → AniList, series/movies → TMDB, strictly separated
- No background daemon for auto-sync — tracker push is fire-and-forget on episode end only
- No per-day minute heatmap from `playback_events` in v1 — uses `history_progress.duration_seconds`
- No interactive `w` key in BrowseShell — live text input conflict; badge is read-only
- No series total denominator in stats progress bars — avoids N+1 TMDB calls
- No week navigation in calendar — separate calendar polish pass after this plan ships

---

## Failure Modes

| Failure                             | Behavior                                                            |
| ----------------------------------- | ------------------------------------------------------------------- |
| Sync network error                  | Log to diagnostics. Header `sync✓` → `sync⚠` amber. No blocking.    |
| Auth token expired                  | `sync✗` red in header. Prompt re-auth on next manual sync only.     |
| Duplicate push                      | Adapter checks remote before insert. Skip + log. No error surfaced. |
| Playlist item unavailable           | Advance to next item. Log warning to diagnostics.                   |
| Smart refill discover timeout       | Items not added. Playlist shows what it has. No error surfaced.     |
| Empty stats query                   | Show action-links: `[/] Search  [d] Discover  [h] History`          |
| Localhost auth server port conflict | Try next 3 ports; fall back to PAT paste flow with clear message.   |

---

## Key Files Map

| File                                                  | Action                                        |
| ----------------------------------------------------- | --------------------------------------------- |
| `packages/storage/src/migrations.ts`                  | Add `009_data_lists`                          |
| `packages/storage/src/repositories/lists.ts`          | Create                                        |
| `packages/storage/src/repositories/queue.ts`          | Current owner for Up Next persistence         |
| `apps/cli/src/infra/fs/atomic-write.ts`               | Add `writeAtomicSecretJson`                   |
| `apps/cli/src/services/persistence/SyncTokenStore.ts` | Create                                        |
| `apps/cli/src/domain/lists/types.ts`                  | Create                                        |
| `apps/cli/src/domain/lists/ListService.ts`            | Create                                        |
| `apps/cli/src/domain/queue/QueueService.ts`           | Current owner for Up Next behavior            |
| `apps/cli/src/domain/lists/StatsService.ts`           | Create                                        |
| `apps/cli/src/domain/lists/StatsFormatter.ts`         | Create                                        |
| `apps/cli/src/services/sync/types.ts`                 | Create                                        |
| `apps/cli/src/services/sync/SyncAdapter.ts`           | Create                                        |
| `apps/cli/src/services/sync/AniListAdapter.ts`        | Create                                        |
| `apps/cli/src/services/sync/TmdbAdapter.ts`           | Create                                        |
| `apps/cli/src/services/sync/SyncService.ts`           | Create                                        |
| `apps/cli/src/app-shell/commands/list-commands.ts`    | Create                                        |
| `apps/cli/src/app-shell/workflows/shell-workflows.ts` | Current owner for Playlists and Up Next flows |
| `apps/cli/src/app-shell/commands/stats-commands.ts`   | Create                                        |
| `apps/cli/src/app-shell/commands/sync-commands.ts`    | Create                                        |
| `apps/cli/src/domain/session/command-registry.ts`     | Add 8 command IDs                             |
| `apps/cli/src/app/browse-option-mappers.ts`           | Add `[wl✓]` badge                             |
| `apps/cli/src/app/calendar-results.ts`                | Add Watchlist badge + Up Next action          |
| `apps/cli/src/app-shell/workflows.ts`                 | Wire all new commands                         |
| `apps/cli/src/app/PlaybackPhase.ts`                   | Up Next advance + tracker push + sync nudge   |
| `apps/cli/src/app-shell/root-status-summary.ts`       | Streak + sync health                          |
| `apps/cli/src/app-shell/ink-shell.tsx`                | Header render + countdown banner              |
| `apps/cli/src/container.ts`                           | Wire all new services                         |
| `apps/cli/src/services/persistence/ConfigService.ts`  | Sync config flags + nudge timestamp           |
| `.plans/roadmap.md`                                   | Mark this plan as in-progress                 |
