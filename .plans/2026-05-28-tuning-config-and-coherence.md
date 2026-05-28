# Tuning Config + Coherence Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Kunai's scattered runtime behavior user-configurable through one tuning namespace (config file + `KUNAI_TUNING_*` env), then remove the queue/playlist naming collision — both verified by tests.

**Architecture:** A single source-of-truth spec table (`tuning.ts`) defines every tunable runtime knob with default + min/max bounds. A pure `resolveTuning()` layers env over config-file overrides over defaults and clamps. `ConfigServiceImpl` exposes a resolved `tuning` getter; consumers read from it instead of module-level constants. Separately, the misnamed "playlist = queue" family is renamed to `Queue*` and moved under `domain/queue/`, leaving the durable user-playlist family untouched.

**Tech Stack:** Bun, TypeScript, `bun test` (via `bun run test`), Turborepo (`bun run typecheck` / `bun run lint`).

**Status of prerequisites (already landed on branch `design/sakura-canonical`):**

- `debug.log` untracked; `.gitignore` `*.log` fixed.
- Dead `CacheStoreImpl.ts` + test removed; `CacheEntry`/`isExpired` trimmed from `CacheStore.ts`.
- `CacheStore.ts` `DEFAULT_CACHE_TTL` now derives from `getDefaultTtlMs("stream-manifest")` (shared storage policy).
- `TODO.md` rewritten; `AGENTS.md` Fast Map pointers fixed.

**Conventions for the executor:**

- Runtime is Bun. Tests run with `bun run test` (NOT `bun test` directly). Single-file: `bun test <path>` is acceptable for the failing-test loop, but final verification uses `bun run test`.
- Commit after each task. Branch off `design/sakura-canonical` is fine; do not rebase the user's in-flight `apps/cli/src/app/PlaybackPhase.ts` work — Part B avoids touching it where possible and Part A must not touch it at all.

---

## Part A — Tuning Config Namespace

### File Structure (Part A)

- Create: `apps/cli/src/services/persistence/tuning.ts` — `TuningConfig` type, bounds spec, `DEFAULT_TUNING`, `resolveTuning()`.
- Create: `apps/cli/test/unit/services/persistence/tuning.test.ts` — resolver precedence + clamping tests.
- Modify: `apps/cli/src/services/persistence/ConfigService.ts` — add `tuning?: Partial<TuningConfig>` to `KitsuneConfig`; add `tuning: TuningConfig` to `ConfigService`.
- Modify: `apps/cli/src/services/persistence/ConfigStore.ts` — add `tuning: {}` to `DEFAULT_CONFIG`.
- Modify: `apps/cli/src/services/persistence/ConfigServiceImpl.ts` — add resolved `tuning` getter.
- Modify (consumer wiring, NON-god-files only): `apps/cli/src/app/episode-prefetch.ts`, `apps/cli/src/infra/player/PersistentMpvSession.ts`.
- Modify: `.docs/engineering-guide.md` — document the tuning namespace + env layer.

---

### Task A1: Tuning spec + resolver (pure module)

**Files:**

- Create: `apps/cli/src/services/persistence/tuning.ts`
- Test: `apps/cli/test/unit/services/persistence/tuning.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/cli/test/unit/services/persistence/tuning.test.ts
import { describe, expect, test } from "bun:test";
import { DEFAULT_TUNING, resolveTuning, tuningEnvKey } from "@/services/persistence/tuning";

describe("resolveTuning", () => {
  test("returns defaults when no overrides given", () => {
    expect(resolveTuning(undefined, {})).toEqual(DEFAULT_TUNING);
  });

  test("config-file override wins over default", () => {
    const result = resolveTuning({ episodePrefetchWaitBudgetMs: 5000 }, {});
    expect(result.episodePrefetchWaitBudgetMs).toBe(5000);
  });

  test("env override wins over config-file override", () => {
    const result = resolveTuning(
      { episodePrefetchWaitBudgetMs: 5000 },
      { KUNAI_TUNING_EPISODE_PREFETCH_WAIT_BUDGET_MS: "6000" },
    );
    expect(result.episodePrefetchWaitBudgetMs).toBe(6000);
  });

  test("clamps below the minimum bound", () => {
    const result = resolveTuning({ mpvReconnectBaseBackoffMs: 0 }, {});
    expect(result.mpvReconnectBaseBackoffMs).toBe(
      DEFAULT_TUNING.mpvReconnectBaseBackoffMs >= 100
        ? 100
        : DEFAULT_TUNING.mpvReconnectBaseBackoffMs,
    );
  });

  test("clamps above the maximum bound", () => {
    const result = resolveTuning({ mpvReconnectMaxBackoffMs: 10_000_000 }, {});
    expect(result.mpvReconnectMaxBackoffMs).toBe(120_000);
  });

  test("ignores non-numeric / NaN env values and falls back to config/default", () => {
    const result = resolveTuning(
      { titleDetailFetchTimeoutMs: 7000 },
      { KUNAI_TUNING_TITLE_DETAIL_FETCH_TIMEOUT_MS: "not-a-number" },
    );
    expect(result.titleDetailFetchTimeoutMs).toBe(7000);
  });

  test("tuningEnvKey converts camelCase field to KUNAI_TUNING_SCREAMING_SNAKE", () => {
    expect(tuningEnvKey("mpvReconnectBaseBackoffMs")).toBe(
      "KUNAI_TUNING_MPV_RECONNECT_BASE_BACKOFF_MS",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/cli/test/unit/services/persistence/tuning.test.ts`
Expected: FAIL — module `@/services/persistence/tuning` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/cli/src/services/persistence/tuning.ts
// =============================================================================
// Runtime tuning namespace
//
// Single source of truth for the runtime durations/budgets that used to live as
// scattered module constants. Each knob has a default and a [min,max] bound.
// Resolution order (last wins): DEFAULT_TUNING -> config-file override -> env.
// Env keys are `KUNAI_TUNING_<SCREAMING_SNAKE(field)>`.
// =============================================================================

export interface TuningConfig {
  // playback / mpv
  readonly mpvReconnectBaseBackoffMs: number;
  readonly mpvReconnectMaxBackoffMs: number;
  readonly mpvSubtitleAttachTimeoutMs: number;
  readonly streamStaleAfterMs: number;
  readonly gracefulExitHandlerTimeoutMs: number;
  // prefetch
  readonly episodePrefetchWaitBudgetMs: number;
  readonly episodePrefetchDefaultWaitBudgetMs: number;
  // network timeouts
  readonly titleDetailFetchTimeoutMs: number;
  readonly discordIpcTimeoutMs: number;
  readonly posterCacheTimeoutMs: number;
  readonly thumbnailTimeoutMs: number;
  // in-session caches
  readonly titleDetailCacheTtlMs: number;
  readonly discoveryCacheTtlMs: number;
  readonly surpriseCacheTtlMs: number;
  readonly nextReleaseTtlMs: number;
  // downloads
  readonly downloadHeartbeatIntervalMs: number;
  readonly downloadStalledHeartbeatMs: number;
  readonly downloadAbortGraceMs: number;
  readonly downloadInactiveWaitMs: number;
}

interface TuningBound {
  readonly default: number;
  readonly min: number;
  readonly max: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

// Defaults mirror the constants they replace; bounds keep user input sane.
const TUNING_SPEC: Readonly<Record<keyof TuningConfig, TuningBound>> = {
  mpvReconnectBaseBackoffMs: { default: 1_800, min: 100, max: 60_000 },
  mpvReconnectMaxBackoffMs: { default: 16_000, min: 1_000, max: 120_000 },
  mpvSubtitleAttachTimeoutMs: { default: 8_000, min: 1_000, max: 60_000 },
  streamStaleAfterMs: { default: 10 * MIN, min: MIN, max: 2 * HOUR },
  gracefulExitHandlerTimeoutMs: { default: 2_000, min: 250, max: 30_000 },
  episodePrefetchWaitBudgetMs: { default: 8_000, min: 500, max: 60_000 },
  episodePrefetchDefaultWaitBudgetMs: { default: 3_000, min: 250, max: 60_000 },
  titleDetailFetchTimeoutMs: { default: 8_000, min: 1_000, max: 60_000 },
  discordIpcTimeoutMs: { default: 10_000, min: 1_000, max: 60_000 },
  posterCacheTimeoutMs: { default: 10_000, min: 1_000, max: 60_000 },
  thumbnailTimeoutMs: { default: 12_000, min: 1_000, max: 60_000 },
  titleDetailCacheTtlMs: { default: 5 * MIN, min: 10_000, max: HOUR },
  discoveryCacheTtlMs: { default: 30 * MIN, min: MIN, max: 24 * HOUR },
  surpriseCacheTtlMs: { default: 10 * MIN, min: MIN, max: 24 * HOUR },
  nextReleaseTtlMs: { default: 2 * HOUR, min: MIN, max: 24 * HOUR },
  downloadHeartbeatIntervalMs: { default: 15_000, min: 1_000, max: 120_000 },
  downloadStalledHeartbeatMs: { default: 90_000, min: 5_000, max: 600_000 },
  downloadAbortGraceMs: { default: 2_500, min: 250, max: 60_000 },
  downloadInactiveWaitMs: { default: 5_000, min: 250, max: 120_000 },
};

const TUNING_FIELDS = Object.keys(TUNING_SPEC) as (keyof TuningConfig)[];

export const DEFAULT_TUNING: TuningConfig = Object.freeze(
  Object.fromEntries(TUNING_FIELDS.map((field) => [field, TUNING_SPEC[field].default])) as Record<
    keyof TuningConfig,
    number
  >,
) as TuningConfig;

export function tuningEnvKey(field: keyof TuningConfig): string {
  return `KUNAI_TUNING_${field.replace(/([A-Z])/g, "_$1").toUpperCase()}`;
}

function clamp(value: number, bound: TuningBound): number {
  return Math.max(bound.min, Math.min(bound.max, Math.trunc(value)));
}

function pickNumber(...candidates: (number | undefined)[]): number | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function parseEnvNumber(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function resolveTuning(
  override?: Partial<TuningConfig>,
  env: Record<string, string | undefined> = process.env,
): TuningConfig {
  const resolved = {} as Record<keyof TuningConfig, number>;
  for (const field of TUNING_FIELDS) {
    const bound = TUNING_SPEC[field];
    const chosen = pickNumber(
      parseEnvNumber(env[tuningEnvKey(field)]),
      override?.[field],
      bound.default,
    );
    resolved[field] = clamp(chosen ?? bound.default, bound);
  }
  return resolved as TuningConfig;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/cli/test/unit/services/persistence/tuning.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/services/persistence/tuning.ts apps/cli/test/unit/services/persistence/tuning.test.ts
git commit -m "feat(config): add runtime tuning namespace + resolver"
```

---

### Task A2: Wire `tuning` into the config service

**Files:**

- Modify: `apps/cli/src/services/persistence/ConfigService.ts`
- Modify: `apps/cli/src/services/persistence/ConfigStore.ts:22-86` (the `DEFAULT_CONFIG` object)
- Modify: `apps/cli/src/services/persistence/ConfigServiceImpl.ts`
- Test: `apps/cli/test/unit/services/persistence/tuning.test.ts` (extend)

- [ ] **Step 1: Add types to `ConfigService.ts`**

At the top imports add:

```ts
import type { TuningConfig } from "./tuning";
```

In `interface KitsuneConfig`, add (near the end, before the closing brace):

```ts
  /** Optional runtime tuning overrides. Unset keys fall back to DEFAULT_TUNING / KUNAI_TUNING_* env. */
  tuning?: Partial<TuningConfig>;
```

In `interface ConfigService extends KitsuneConfig`, add a resolved accessor:

```ts
  /** Fully-resolved tuning values (defaults < config override < env). */
  readonly tuning: TuningConfig;
```

> Note: `ConfigService` extends `KitsuneConfig` whose `tuning` is `Partial<TuningConfig> | undefined`. Redeclaring as the resolved `TuningConfig` narrows it — TypeScript permits this for an interface extension since `TuningConfig` is assignable to `Partial<TuningConfig> | undefined`. If tsc complains, rename `KitsuneConfig.tuning` to `tuningOverrides` instead and keep `ConfigService.tuning` as the resolved getter. (Decide at Step 4 based on tsc output.)

- [ ] **Step 2: Add default to `ConfigStore.ts`**

In `DEFAULT_CONFIG`, add after `lastWeeklyDigestShownAt: null,`:

```ts
  tuning: {},
```

- [ ] **Step 3: Add the resolved getter to `ConfigServiceImpl.ts`**

Add import:

```ts
import { resolveTuning } from "./tuning";
import type { TuningConfig } from "./tuning";
```

Add getter (place it next to the other getters, e.g. after `get powerSaverAllowManualArtwork()`):

```ts
  get tuning(): TuningConfig {
    return resolveTuning(this.config.tuning);
  }
```

- [ ] **Step 4: Verify typecheck + run the service test**

Run: `bun run typecheck`
Expected: PASS. If `ConfigService.tuning` redeclaration errors, apply the `tuningOverrides` fallback from Task A2 Step 1 (rename the `KitsuneConfig` field to `tuningOverrides`, update `DEFAULT_CONFIG` key to `tuningOverrides: {}`, and `ConfigServiceImpl` getter to `resolveTuning(this.config.tuningOverrides)`).

- [ ] **Step 5: Add an integration test**

Append to `tuning.test.ts`:

```ts
import { ConfigServiceImpl } from "@/services/persistence/ConfigServiceImpl";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";

describe("ConfigService.tuning", () => {
  test("exposes resolved defaults with no overrides", async () => {
    const store = {
      load: async () => ({ ...DEFAULT_CONFIG }),
      save: async () => {},
      reset: async () => {},
    };
    const service = await ConfigServiceImpl.load(store);
    expect(service.tuning).toEqual(DEFAULT_TUNING);
  });

  test("applies a config-file tuning override", async () => {
    const store = {
      load: async () => ({ ...DEFAULT_CONFIG, tuning: { thumbnailTimeoutMs: 20_000 } }),
      save: async () => {},
      reset: async () => {},
    };
    const service = await ConfigServiceImpl.load(store);
    expect(service.tuning.thumbnailTimeoutMs).toBe(20_000);
  });
});
```

> If you applied the `tuningOverrides` fallback in Step 4, change the override key here to `tuningOverrides`.

- [ ] **Step 6: Run + commit**

Run: `bun test apps/cli/test/unit/services/persistence/tuning.test.ts`
Expected: PASS.

```bash
git add apps/cli/src/services/persistence/ConfigService.ts apps/cli/src/services/persistence/ConfigStore.ts apps/cli/src/services/persistence/ConfigServiceImpl.ts apps/cli/test/unit/services/persistence/tuning.test.ts
git commit -m "feat(config): expose resolved tuning from ConfigService"
```

---

### Task A3: Migrate the prefetch consumer

**Files:**

- Modify: `apps/cli/src/app/episode-prefetch.ts:5-6,68-81`

**Context:** `resolveEpisodePrefetchWaitBudget(progress)` currently returns module constants `EPISODE_PREFETCH_WAIT_BUDGET_MS` / `EPISODE_PREFETCH_DEFAULT_WAIT_BUDGET_MS`. Make it accept budgets so callers pass `config.tuning` values, while keeping the constants as the default arg (no behavior change, no caller breakage).

- [ ] **Step 1: Change the function signature (keep constants as defaults)**

Replace the body region of `resolveEpisodePrefetchWaitBudget` (lines ~68-81) with:

```ts
export function resolveEpisodePrefetchWaitBudget(
  progress?: EpisodePrefetchProgress,
  budgets: { activeMs: number; idleMs: number } = {
    activeMs: EPISODE_PREFETCH_WAIT_BUDGET_MS,
    idleMs: EPISODE_PREFETCH_DEFAULT_WAIT_BUDGET_MS,
  },
): number {
  if (
    progress?.exactStreamCacheHit ||
    progress?.sourceInventoryHit ||
    progress?.candidateStreamsReturned ||
    progress?.providerResolveActive ||
    progress?.fallbackAttemptStarted ||
    progress?.streamValidationActive ||
    progress?.videoReady
  ) {
    return budgets.activeMs;
  }
  return budgets.idleMs;
}
```

- [ ] **Step 2: Verify no caller breaks**

Run: `bun run typecheck`
Expected: PASS (callers using the 1-arg form still work via defaults).

- [ ] **Step 3: Point the caller at config tuning**

Find the call site that passes `getProgress`/`progress` into `adoptEpisodePrefetchBundle` (search): `grep -rn "resolveEpisodePrefetchWaitBudget\|adoptEpisodePrefetchBundle" apps/cli/src`. In the non-god-file caller (NOT `PlaybackPhase.ts` — leave that one on defaults to avoid touching in-flight work), pass:

```ts
resolveEpisodePrefetchWaitBudget(progress, {
  activeMs: config.tuning.episodePrefetchWaitBudgetMs,
  idleMs: config.tuning.episodePrefetchDefaultWaitBudgetMs,
});
```

If the only caller is `PlaybackPhase.ts`, SKIP this step and record in the commit message that wiring is deferred until the PlaybackPhase decomposition (the signature change alone is the deliverable here).

- [ ] **Step 4: Run + commit**

Run: `bun run typecheck && bun test apps/cli/test/unit/services/persistence/tuning.test.ts`

```bash
git add apps/cli/src/app/episode-prefetch.ts
git commit -m "refactor(prefetch): accept tuning-driven wait budgets"
```

---

### Task A4: Migrate the mpv reconnect backoff consumer

**Files:**

- Modify: `apps/cli/src/infra/player/PersistentMpvSession.ts:74-75` and the backoff computation site.

**Context:** `IN_PROCESS_RECONNECT_BASE_BACKOFF_MS` (1800) and `IN_PROCESS_RECONNECT_MAX_BACKOFF_MS` (16000) drive reconnect backoff. The session already reads config (`mpvInProcessStreamReconnect*`). Thread `tuning` values through.

- [ ] **Step 1: Locate the backoff usage**

Run: `grep -n "IN_PROCESS_RECONNECT_BASE_BACKOFF_MS\|IN_PROCESS_RECONNECT_MAX_BACKOFF_MS\|config\." apps/cli/src/infra/player/PersistentMpvSession.ts | head -40`
Identify where the session receives config/tuning. If the session already holds a `config`/`ConfigService` reference, read `config.tuning.mpvReconnectBaseBackoffMs` / `...MaxBackoffMs` at the backoff computation. Keep the module constants ONLY as the fallback default used when no config is present in tests.

- [ ] **Step 2: Replace the constant reads at the computation site**

At the backoff math, substitute the two constants with the resolved tuning values (held in a local captured at construction or read from the config reference). Do not change the backoff formula — only the source of the two numbers.

- [ ] **Step 3: Verify**

Run: `bun run typecheck`
Expected: PASS.
Run: `bun run test 2>&1 | tail -20`
Expected: existing PersistentMpvSession tests (if any) still PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/infra/player/PersistentMpvSession.ts
git commit -m "refactor(mpv): drive reconnect backoff from tuning config"
```

---

### Task A5: Document the tuning namespace

**Files:**

- Modify: `.docs/engineering-guide.md` (append a "Runtime tuning" section)

- [ ] **Step 1: Append docs**

Add a section listing: where tuning lives (`tuning.ts`), the resolution order (default < config `tuning: {...}` < `KUNAI_TUNING_*` env), the env-key derivation rule with one example (`mpvReconnectBaseBackoffMs` → `KUNAI_TUNING_MPV_RECONNECT_BASE_BACKOFF_MS`), and a note that every knob is clamped to a `[min,max]` bound. Reference `apps/cli/src/services/persistence/tuning.ts` as the source of truth for the full key list.

- [ ] **Step 2: Commit**

```bash
git add .docs/engineering-guide.md
git commit -m "docs(config): document runtime tuning namespace"
```

---

### Task A6: Final verification (Part A)

- [ ] **Step 1:** Run `bun run typecheck` — Expected: PASS.
- [ ] **Step 2:** Run `bun run lint` — Expected: 0 errors (pre-existing warnings OK).
- [ ] **Step 3:** Run `bun run test 2>&1 | tail -30` — Expected: all suites PASS.
- [ ] **Step 4:** Run `bun run fmt`.
- [ ] **Step 5:** Commit any fmt changes: `git commit -am "chore: fmt"`.

---

## Part B — Queue / Playlist Naming Collision

> **Precondition:** The user's in-flight changes to `apps/cli/src/app/PlaybackPhase.ts` must be committed or stashed first (`git status` should show it clean) — this rename touches that file. If it is still dirty, STOP and ask before proceeding.

**Why:** Two distinct concepts share the "playlist" name. The **play-queue** family (`repositories/playlist.ts` → `PlaylistRepository`, `PlaylistItem`, wrapped by `domain/lists/PlaylistService`, which calls `domain/queue/QueuePlanner`) collides with the **durable user-playlist** family (`repositories/playlists.ts` → `PlaylistsRepository`, `UserPlaylistRecord`, `services/playlists/DurablePlaylistService`). Rename only the queue family to `Queue*`.

### File Structure (Part B)

- Rename: `packages/storage/src/repositories/playlist.ts` → `packages/storage/src/repositories/queue.ts`
- Rename: `apps/cli/src/domain/lists/PlaylistService.ts` → `apps/cli/src/domain/queue/QueueService.ts`
- Rename tests: `apps/cli/test/unit/domain/lists/PlaylistService.test.ts` → `apps/cli/test/unit/domain/queue/QueueService.test.ts`
- Modify: `packages/storage/src/index.ts`, `packages/storage/test/attention-storage.test.ts`, `packages/storage/test/storage.test.ts`
- Modify: `apps/cli/src/container.ts`, `apps/cli/src/app-shell/workflows.ts`, `apps/cli/src/app/PlaybackPhase.ts`, `apps/cli/src/services/playlists/PlaylistProjectionService.ts` (queue-item usages only)

### Identifier rename map

| Old                                    | New                           |
| -------------------------------------- | ----------------------------- |
| `PlaylistRepository`                   | `QueueRepository`             |
| `PlaylistItem`                         | `QueueEntry`                  |
| `PlaylistItemInput`                    | `QueueEntryInput`             |
| `PlaylistService` (domain/lists)       | `QueueService` (domain/queue) |
| `PlaylistStatus`                       | `QueueStatus`                 |
| `playlistRepository` (container field) | `queueRepository`             |
| `playlistService` (container field)    | `queueService`                |

> `QueueEntry` (not `QueueItem`) avoids colliding with the existing `QueueItemStatus` type already in `playlist.ts`. Keep `QueueSession*` names as-is. Do NOT touch `PlaylistsRepository`, `DurablePlaylistService`, `UserPlaylist*`, or `durablePlaylistService`.

### Task B1: Establish the green baseline

- [ ] **Step 1:** Confirm tree clean: `git status` — `PlaybackPhase.ts` must NOT be modified. If dirty, STOP.
- [ ] **Step 2:** `bun run test 2>&1 | tail -20` — record the passing baseline.

### Task B2: Rename the storage repository

**Files:** `packages/storage/src/repositories/playlist.ts`, `packages/storage/src/index.ts`, both storage test files.

- [ ] **Step 1:** `git mv packages/storage/src/repositories/playlist.ts packages/storage/src/repositories/queue.ts`
- [ ] **Step 2:** In `queue.ts`, rename `PlaylistRepository`→`QueueRepository`, `PlaylistItem`→`QueueEntry`, `PlaylistItemInput`→`QueueEntryInput`. Update the file header comment to say "Play queue repository".
- [ ] **Step 3:** In `packages/storage/src/index.ts:67-75`, update the export source path to `./repositories/queue` and the exported names (`QueueRepository`, `QueueEntry`, `QueueEntryInput`, plus the unchanged `QueueSession*`).
- [ ] **Step 4:** In `packages/storage/test/attention-storage.test.ts` and `packages/storage/test/storage.test.ts`, replace `PlaylistRepository`→`QueueRepository` and `PlaylistItem`→`QueueEntry`.
- [ ] **Step 5:** Run: `bun --filter @kunai/storage test 2>&1 | tail -20` (or `bun run test`) — Expected: PASS.
- [ ] **Step 6:** Commit: `git add -A && git commit -m "refactor(storage): rename PlaylistRepository to QueueRepository"`

### Task B3: Move + rename the domain service

**Files:** `apps/cli/src/domain/lists/PlaylistService.ts` → `apps/cli/src/domain/queue/QueueService.ts`, its test, `apps/cli/src/container.ts`.

- [ ] **Step 1:** `git mv apps/cli/src/domain/lists/PlaylistService.ts apps/cli/src/domain/queue/QueueService.ts`
- [ ] **Step 2:** `mkdir -p apps/cli/test/unit/domain/queue && git mv apps/cli/test/unit/domain/lists/PlaylistService.test.ts apps/cli/test/unit/domain/queue/QueueService.test.ts`
- [ ] **Step 3:** In `QueueService.ts`: rename class `PlaylistService`→`QueueService`, type `PlaylistStatus`→`QueueStatus`; update imports from `@kunai/storage` to `QueueRepository`, `QueueEntry`, `QueueEntryInput`; the `import { planMediaQueuePlacement } from "../queue/QueuePlanner"` becomes `from "./QueuePlanner"` (now same dir); update the `import type { ListService } from "./ListService"` to `from "../lists/ListService"`.
- [ ] **Step 4:** In `QueueService.test.ts`: update import path to `@/domain/queue/QueueService`, names to `QueueService`; update `@kunai/storage` names to `QueueRepository`.
- [ ] **Step 5:** In `container.ts`: import path `./domain/queue/QueueService`, type `QueueService`, repo import `QueueRepository`; rename fields `playlistRepository`→`queueRepository`, `playlistService`→`queueService` (lines ~30,196,202,289,335). Leave `durablePlaylistService` untouched.
- [ ] **Step 6:** Run: `bun run typecheck` — fix any remaining references it reports.
- [ ] **Step 7:** Commit: `git add -A && git commit -m "refactor(queue): move PlaylistService to domain/queue/QueueService"`

### Task B4: Update remaining consumers (god files)

**Files:** `apps/cli/src/app-shell/workflows.ts:345`, `apps/cli/src/app/PlaybackPhase.ts`, `apps/cli/src/services/playlists/PlaylistProjectionService.ts`.

- [ ] **Step 1:** Run `bun run typecheck 2>&1 | grep -i "playlistService\|PlaylistItem\|PlaylistRepository\|PlaylistStatus"` to list exact remaining breakages with file:line.
- [ ] **Step 2:** For each: `import("@/domain/lists/PlaylistService").PlaylistService` → `import("@/domain/queue/QueueService").QueueService`; `container.playlistService` → `container.queueService`; `PlaylistItem` type usages → `QueueEntry`. In `PlaylistProjectionService.ts`, only change the queue-entry type imports (the `PlaylistItem` from `@kunai/storage`), NOT the durable-playlist projection logic.
- [ ] **Step 3:** Run: `bun run typecheck` — Expected: PASS (zero matches for the old names except `DurablePlaylist*`/`UserPlaylist*`).
- [ ] **Step 4:** Run: `bun run test 2>&1 | tail -30` — Expected: PASS.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "refactor(queue): finish QueueService/QueueEntry rename across consumers"`

### Task B5: Final verification (Part B)

- [ ] **Step 1:** `grep -rn "PlaylistRepository\|PlaylistService\b\|PlaylistItem\b" apps packages --include="*.ts" | grep -v "Durable\|UserPlaylist\|PlaylistsRepository"` — Expected: empty.
- [ ] **Step 2:** `bun run typecheck && bun run lint && bun run test 2>&1 | tail -20` — Expected: green.
- [ ] **Step 3:** `bun run fmt && git commit -am "chore: fmt"` (if changes).

---

## Part C — Deep Audit (investigation, NOT build)

> These produce **findings + recommendation docs**, not code changes. Each is an independent read-only investigation. Do them as separate sessions; write each result to `.docs/` and link from `.plans/roadmap.md`. Do NOT trust existing plan docs as ground truth — read the code (per `plan-implementation-truth.md`: code wins).

### Task C1: Airing-episode / "new episodes" handling

- Read: `apps/cli/src/services/release-reconciliation/*`, `apps/cli/src/services/catalog/CatalogScheduleService.ts`, `packages/storage/src/repositories/release-progress-cache.ts`, `schedule-cache.ts`.
- Answer: how are newly-aired episodes detected, deduped, surfaced, and cached? Where are the gaps for long-running anime (cour boundaries, absolute vs season/episode numbering, fillers)? Output `.docs/audit-airing-episodes.md`.

### Task C2: mpv / IPC lifecycle

- Read: `apps/cli/src/infra/player/PersistentMpvSession.ts`, `mpv-telemetry.ts`, `PlayerControlServiceImpl.ts`, `mpv.ts`, `.docs/mpv-in-process-reconnect.md`.
- Answer: reconnect/stall correctness, socket cleanup edge cases, cross-platform IPC parity, where the 1446-line session should be decomposed. Output `.docs/audit-mpv-ipc.md`.

### Task C3: Queues, playlists, and a browse detail-view shortcut

- Read: `apps/cli/src/app-shell/workflows.ts` (queue/playlist flows), `apps/cli/src/app-shell/pickers/*`, `apps/cli/src/app-shell/line-editor.ts`, `domain/session/command-registry.ts`.
- Answer: how to open a detailed title view from browse via a hotkey WITHOUT the key being captured by the search input box (study the Claude Code pattern: a raw-mode key menu / mode gate before the text field gains focus; cross-ref the legacy `[c]` bug in `TODO.md`). Propose the keybinding + focus-state model. Output `.docs/audit-browse-shortcuts.md`.

### Task C4: Provider engine cycle + packaging/modernization

- Read: `apps/cli/src/services/playback/PlaybackResolveService.ts`, `PlaybackResolveCoordinator.ts`, `SourceInventoryService.ts`, `packages/providers/src/*`, `.docs/providers.md`, `runtime-boundary-map.md`.
- Answer: where the resolve/fallback cycle duplicates logic, what should be extracted into `@kunai/*` packages, and the dual-cache keying consolidation (the manifest-driven `stream-resolve-cache.ts` keying vs the `sha256(url)` keying in `SqliteCacheStoreImpl`). Output `.docs/audit-provider-engine.md`.

---

## Self-Review notes (for the executor)

- Part A is fully independent and safe to run first; it does not touch the god files except the optional A3 Step 3 / A4 (which read config only).
- Part B is gated on a clean `PlaybackPhase.ts`. If still dirty, run Part A only and report.
- `bun run test` is the project gate (not `bun test`). Single-file `bun test <path>` is for the inner TDD loop only.
- Type names are consistent across tasks: `QueueRepository`, `QueueEntry`, `QueueEntryInput`, `QueueService`, `QueueStatus`, `TuningConfig`, `DEFAULT_TUNING`, `resolveTuning`, `tuningEnvKey`.
