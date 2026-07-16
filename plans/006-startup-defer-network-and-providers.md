# Plan 006: Defer AniList sync and lazy-load providers so the shell paints before network/scraper work

> **Executor instructions**: Follow step by step; verify each step; STOP on any
> STOP condition; update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 4b351cb0..HEAD -- apps/cli/src/container/bootstrap-persistence.ts apps/cli/src/container/bootstrap-providers.ts apps/cli/src/services/sync/AniListAdapter.ts apps/cli/src/main.ts`
> Mismatch vs excerpts → STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none — but it shares `main.ts` with plan 001 and `bootstrap-providers.ts` with plan 007; sequence those rather than running them in parallel with this plan
- **Category**: perf
- **Planned at**: commit `4b351cb0`, 2026-07-16

## Why this matters

Time-to-first-frame is the sum of every bootstrap cost, and two of them don't belong on the pre-paint path:

1. **AniList sync init does a blocking network round-trip before first paint.** For any AniList-connected user, `createContainer` awaits `AniListAdapter.init()`, which issues a GraphQL POST to fetch the username. On a slow link that's hundreds of ms to seconds; if AniList is unreachable, the launch hangs until timeout — all before the TUI paints.
2. **All six provider scraper modules are imported eagerly every launch** regardless of mode. An anime-only or YouTube-only session still loads and evaluates every scraper (parsers, regex tables, config) pre-paint.

Deferring the username refresh (only the sync UI needs it) and loading only the reachable providers eagerly makes launch feel immediate. This plan is the highest-leverage slice of the broader "skeleton-first boot" goal — the full skeleton-first mount is deliberately NOT planned in this set (see `plans/README.md` → Deferred); do not attempt it here.

## Current state

### AniList — `apps/cli/src/container/bootstrap-persistence.ts:273-277`

```ts
const anilistAdapter = new AniListAdapter(syncTokenStore);
const TMDB_PUBLIC_KEY = process.env.KUNAI_TMDB_API_KEY ?? "<public client key literal>";
const tmdbAdapter = new TmdbAdapter(syncTokenStore, TMDB_PUBLIC_KEY);
await Promise.all([anilistAdapter.init(), tmdbAdapter.init()]); // AniList init hits the network
```

`apps/cli/src/services/sync/AniListAdapter.ts:29-47`:

```ts
async init(): Promise<void> {
    const tokens = await this.tokenStore.load();
    if (tokens.anilist) {
      this.accessToken = tokens.anilist.accessToken;
      this.userId = tokens.anilist.userId;
      await this.refreshUsername();          // <-- GraphQL POST to anilist.co
    }
}
private async refreshUsername(): Promise<void> {
    if (!this.accessToken) return;
    try {
      const res = await this.gql<ViewerResponse>(`query { Viewer { id name } }`);
      this.username = res.data.Viewer.name;
      this.userId = res.data.Viewer.id;
    } catch { this.accessToken = undefined; }
}
```

`main.ts:569` awaits `createContainer(...)`; `main.ts:757` then calls `launchSessionApp`. Nothing paints until `createContainer` fully resolves.

### Providers — `apps/cli/src/container/bootstrap-providers.ts:41-55`

```ts
const [
  { videasyProviderModule },
  { vidlinkProviderModule },
  { rivestreamProviderModule },
  { allmangaProviderModule },
  { miruroProviderModule },
  { youtubeProviderModule },
] = await Promise.all([
  import("@kunai/providers/videasy"),
  import("@kunai/providers/vidlink"),
  import("@kunai/providers/rivestream"),
  import("@kunai/providers/allmanga"),
  import("@kunai/providers/miruro"),
  import("@kunai/providers/youtube"),
]);
```

The engine keys modules by id (`orderProviderModulesByPriority`, `createProviderEngine`), so modules can be registered lazily as long as fallback across modes still resolves them.

Repo conventions: DI container built in `container/*`; `isAnimeProvider: true` places a provider in anime mode (CLAUDE.md); conventional commits.

## Commands you will need

| Purpose      | Command                                   | Expected                                       |
| ------------ | ----------------------------------------- | ---------------------------------------------- |
| Typecheck    | `bun run typecheck`                       | exit 0                                         |
| Lint         | `bun run lint`                            | exit 0                                         |
| CLI tests    | `bun run --cwd apps/cli test`             | pass                                           |
| One file     | `cd apps/cli && bun run test:file <path>` | pass                                           |
| Manual smoke | `bun run dev` then `bun run dev -- -a`    | shell paints promptly; playback still resolves |

## Scope

**In scope**:

- `apps/cli/src/services/sync/AniListAdapter.ts`
- `apps/cli/src/container/bootstrap-persistence.ts`
- `apps/cli/src/container/bootstrap-providers.ts`
- `apps/cli/src/main.ts` (only to kick a post-mount background refresh, if needed)
- Tests under `apps/cli/test/unit/` for the two behaviors

**Out of scope**:

- `TmdbAdapter.init` (already token-file only — leave it).
- Provider engine internals (`packages/core`) — only change _when_ modules are imported, not how they resolve.
- The full container-mount reordering (skeleton-first mount) — deliberately unplanned follow-up; do not attempt it here.

## Git workflow

- Branch: `advisor/006-startup-defer`
- Commits: `perf(sync): defer anilist username refresh off the boot path` and `perf(providers): lazy-load non-active provider modules`

## Steps

### Step 1: Split AniList `init` from network refresh

Change `AniListAdapter.init()` to only load tokens from disk (set `accessToken`/`userId`), and NOT call `refreshUsername()`. Add a public method (e.g. `ensureUsername()` / `refreshInBackground()`) that performs the GraphQL fetch, callable lazily.

**Verify**: `bun run typecheck` → exit 0.

### Step 2: Trigger the refresh after mount, not before paint

After `launchSessionApp` (or at first open of the sync surface), fire `anilistAdapter.ensureUsername()` as a background task (`void adapter.ensureUsername().catch(() => {})`). The username is only needed by sync UI; ensure that UI reads a possibly-not-yet-loaded username gracefully (show a neutral placeholder until it lands). Find the sync UI consumers with `grep -rn "username" apps/cli/src/services/sync apps/cli/src/app-shell` and confirm none assume it's populated at boot.

**Verify**: `bun run --cwd apps/cli test` → pass (existing sync tests still green).

### Step 3: Lazy-load non-active providers

Change `bootstrap-providers.ts` so only the provider(s) reachable in the _current_ session mode are imported eagerly, and the rest are imported on first cross-mode fallback or mode switch. Approach:

- Determine the active mode at bootstrap (anime vs movie/series vs youtube) — check how mode is known at this point (`grep -rn "isAnimeProvider\|mode" apps/cli/src/container/bootstrap-providers.ts apps/cli/src/main.ts`).
- Eagerly import the modules for the active mode; wrap the others in lazy factories the engine calls on demand.
- If the engine registry requires all modules up front and cannot accept lazy registration, keep the `Promise.all` but STOP and report that lazy provider loading needs an engine change (defer to a follow-up) — do NOT half-migrate.

**Verify**: `bun run dev -- -a` resolves an anime stream; `bun run dev` resolves a movie stream — both still work (fallback across modes intact). `bun run --cwd apps/cli test` → pass.

### Step 4: Tests

- AniList: `init()` does not perform a network call (inject a fake `gql` and assert it is not invoked during `init`; assert `ensureUsername()` does invoke it).
- Providers: a bootstrap in anime mode does not eagerly import the movie-only modules (assert via a spy on the lazy factory, or assert the eager set excludes them). Model after existing `apps/cli/test/unit/container/*` tests if present (`ls apps/cli/test/unit/container/`).

**Verify**: run the new test files → pass.

### Step 5: Full gates + manual smoke

**Verify**: `bun run typecheck && bun run lint && bun run --cwd apps/cli test` → all exit 0. Manually: `bun run dev` paints the shell without a visible network stall even with an AniList token present (temporarily point the AniList base URL at an unroutable host if you want to prove the non-blocking behavior, then revert).

## Done criteria

- [ ] `bun run typecheck`, `bun run lint` exit 0; CLI tests pass
- [ ] `AniListAdapter.init` performs no network call (test proves it)
- [ ] Non-active provider modules are not eagerly imported (test proves it) OR a STOP was reported explaining the engine blocker
- [ ] `bun run dev` and `bun run dev -- -a` both still resolve and play a stream
- [ ] No files outside scope modified; `plans/README.md` row updated

## STOP conditions

- The provider engine cannot register modules lazily without an internal change (report; land only the AniList half).
- The sync UI hard-depends on `username` being present at mount and can't tolerate a placeholder — report before changing UI.
- Deferring the refresh breaks an existing sync test whose intent is "username available after container build" — reconcile with the maintainer intent, don't just delete the assertion.

## Maintenance notes

- If a future skeleton-first-mount plan is written, this deferral folds into its background-lane model — coordinate so the refresh trigger isn't wired twice. File-overlap note: plan 001 also edits `main.ts` (crash handlers, `:838-903` — different region) and plan 007 also edits `bootstrap-providers.ts` (engine ctor `:83` vs this plan's import block `:41-55`) — land sequentially to avoid merge conflicts.
- Reviewer: confirm AniList errors during background refresh can't crash the app (they must be swallowed, matching the existing `catch`).
- The TMDB public client key literal at `bootstrap-persistence.ts:274` is a distributed client key, not a private secret — out of scope; do not treat as a credential finding.
