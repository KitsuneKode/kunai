# Personal Media Vocabulary And Keybindings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Kunai's saved-media, release-attention, sharing, command palette, and keybinding layers use one clear vocabulary: Playlists are durable collections, Watchlist is the built-in watch-later playlist, Up Next is playback order, and Follow/Mute control release attention.

**Architecture:** Deepen four modules: Command Registry, Playlist, Up Next, and Attention. Command labels, aliases, visibility, and keybindings become the product-facing interface; storage and existing repositories remain adapters behind those modules.

**Tech Stack:** Bun, TypeScript, Ink, SQLite via `@kunai/storage`, existing render-capture test harness.

## Current Status

First slice completed on 2026-06-25:

- Command vocabulary: `watchlist`, `playlists`, `up-next`, `bookmark`, `follow`, `unfollow`, `mute`, `share`, and `/provider` are represented in the command surface.
- Compatibility aliases: `/playlist` and `/pl` resolve to `/playlists`; `/queue` resolves to `/up-next`.
- Browse command palette: stable watch/library/provider surfaces are prioritized; noisy experimental/advanced commands are removed from the first page.
- Media action semantics: `add-to-watchlist`, `add-to-playlist`, and `add-to-up-next` are distinct; `add-to-playlist` no longer writes to Watchlist without a playlist choice.
- Attention semantics: `unfollow` maps to neutral `implicit`; `mute` remains explicit suppression.
- Generated metadata: `apps/docs/lib/generated-metadata.json` reflects `playlists`, `up-next`, and `unfollow`.

Verification run for the first slice:

- `bun run fmt`
- `bun run typecheck`
- `bun run lint`
- `bun run build`
- targeted command/media-action/notification/search tests

Remaining slices should start from the codebase and ADR truth, not from the unchecked boxes below as if no work has landed.

## Global Constraints

- Use `bun`, `bunx`, and `bun run`; do not use `bun test` directly.
- Do not silently remove legacy aliases; keep compatibility aliases while changing displayed labels.
- Do not route video through playlist sharing or exports.
- Exported playlist documents must never include stream URLs, request headers, cookies, auth tokens, or local file paths.
- Printable keys must not hijack focused text input.
- The command registry is the authority for labels, aliases, availability, disabled reasons, and palette grouping.
- The keybinding registry is the authority for app-owned shortcuts, footer hints, help copy, and collision tests.
- Keep `/downloads` for download jobs and `/up-next` for playback order.
- Verification gates: `bun run typecheck`, `bun run lint`, `bun run fmt`, and targeted tests named in each task.

---

## File Structure

### Command And Keybinding Files

- Modify `apps/cli/src/domain/session/command-registry.ts`
  - Add/rename command ids and labels.
  - Add grouping metadata or a grouping helper.
  - Hide/demote experimental and advanced commands from default contexts.
- Modify `apps/cli/src/app-shell/commands.ts`
  - Keep post-playback and overlay contexts aligned with the registry.
- Modify `apps/cli/src/app-shell/search-browse-command-ids.ts`
  - Keep browse palette small and focused.
- Modify `apps/cli/src/app-shell/keybindings.ts`
  - Add bindings for `/playlists`, `/up-next`, attention actions, and any renamed actions.
  - Preserve global bindings and collision rules.
- Modify `docs/users/commands-and-shortcuts.mdx` and `.docs/keybindings.md`
  - Update user-facing command/keybinding vocabulary.

### Personal Media Files

- Modify `apps/cli/src/domain/lists/ListService.ts`
  - Treat Watchlist as the built-in playlist concept at the app interface.
- Modify `apps/cli/src/services/playlists/DurablePlaylistService.ts`
  - Ensure playlist loading/export uses the locked vocabulary and safe document rules.
- Modify `apps/cli/src/domain/queue/QueueService.ts`
  - Rename outward-facing copy and source labels to Up Next where needed.
- Modify `apps/cli/src/services/media-actions/MediaActionRouter.ts`
  - Split add-to-playlist from add-to-watchlist and add-to-up-next.
- Modify `apps/cli/src/services/media-actions/create-container-media-action-router.ts`
  - Stop routing `add-to-playlist` to watchlist.
- Modify `apps/cli/src/services/attention/*`
  - Add explicit unfollow behavior if missing.

### Shell Surface Files

- Modify `apps/cli/src/app-shell/workflows/shell-workflows.ts`
  - Rename `/playlist` workflow to durable Playlists where applicable.
  - Route `/up-next` to the playback queue surface.
  - Keep import/export gated or under Playlists.
- Modify `apps/cli/src/app-shell/root-overlay-shell.tsx`
  - Ensure Up Next overlay copy and key handling match keybinding registry.
- Modify `apps/cli/src/app-shell/queue-shell.tsx`
  - Display Up Next vocabulary.
- Modify `apps/cli/src/app-shell/details-panel.ts`
  - Update guidance copy: Watchlist, Playlists, Up Next, Follow.
- Modify `apps/cli/src/app-shell/post-play-view.ts`
  - Update post-play action labels and attention copy.

### Tests

- Modify `apps/cli/test/unit/app-shell/command-registry.coverage.test.ts`
- Modify `apps/cli/test/unit/domain/session/command-registry-contexts.test.ts`
- Modify `apps/cli/test/unit/app-shell/command-router.test.ts`
- Modify `apps/cli/test/unit/app-shell/keybindings.test.ts`
- Modify `apps/cli/test/unit/app-shell/keybindings-collision.test.ts`
- Modify `apps/cli/test/unit/services/media-actions/MediaActionRouter.test.ts`
- Modify `apps/cli/test/unit/services/media-actions/create-container-media-action-router.test.ts`
- Modify `apps/cli/test/unit/domain/queue/QueueService.test.ts`
- Modify `apps/cli/test/unit/services/playlists/DurablePlaylistService.test.ts`

---

## Orchestrator Strategy

Use six agents with disjoint ownership where possible:

1. **Command Vocabulary Agent**
   - Owns command registry, command contexts, command palette grouping, user-facing command docs.
2. **Personal Media Action Agent**
   - Owns MediaActionRouter and container action adapters.
3. **Playlist And Watchlist Agent**
   - Owns built-in Watchlist as playlist semantics and durable playlist service copy.
4. **Up Next Agent**
   - Owns queue/Up Next naming and route separation from playlists.
5. **Attention Agent**
   - Owns follow/unfollow/mute semantics and notification/release copy.
6. **Keybinding Agent**
   - Owns keybinding registry parity, collision tests, help/footer docs.

The orchestrator should integrate in this order:

1. Command vocabulary.
2. Media action semantics.
3. Playlist/watchlist and Up Next surfaces.
4. Attention semantics.
5. Keybinding parity.
6. Docs and full verification.

## Remaining Execution Order

1. **Keybindings + help/footer parity**
   - Align `apps/cli/src/app-shell/keybindings.ts`, help copy, footer hints, and command docs with `/playlists`, `/up-next`, `/provider`, `follow`, `unfollow`, and `mute`.
   - Add collision tests for dispatchable command-backed shortcuts.
2. **Watchlist attention completion**
   - Add Unfollow to Watchlist detail/submenu paths when a title is explicitly followed.
   - Keep Mute distinct from Unfollow.
3. **Durable playlist manager**
   - Add rename/delete/add-to-specific-playlist flows.
   - Keep import/export behind `playlistSharing` until UX is polished.
4. **Real `add-to-playlist` picker**
   - Any surface exposing durable playlist add must choose a playlist first.
   - Do not reintroduce a Watchlist fallback.
5. **Experimental feature gating**
   - Decide product role for Favorites, Sync, Random, Surprise, recompute, provider-health reset, clear-cache, export-diagnostics, and report-issue.
   - Keep stable default palette small.
6. **Docs and metadata**
   - Update `.docs/keybindings.md`, `.docs/features/playlists.md`, `.docs/features/queue.md`, user command docs, and generated metadata after command changes.

---

### Task 1: Command Vocabulary And Palette Grouping

**Files:**

- Modify: `apps/cli/src/domain/session/command-registry.ts`
- Modify: `apps/cli/src/app-shell/commands.ts`
- Modify: `apps/cli/src/app-shell/search-browse-command-ids.ts`
- Test: `apps/cli/test/unit/domain/session/command-registry-contexts.test.ts`
- Test: `apps/cli/test/unit/app-shell/command-registry.coverage.test.ts`

**Interfaces:**

- Consumes: existing `AppCommandId`, `COMMANDS`, `COMMAND_CONTEXTS`, `resolveCommands`.
- Produces:
  - stable command labels for `watchlist`, `playlists`, `up-next`, `bookmark`, `follow`, `unfollow`, `mute`, `share`
  - compatibility aliases for `playlist`, `pl`, and `queue`
  - reduced default browse/root command contexts

- [ ] **Step 1: Write failing command label tests**

Add tests asserting:

```ts
expect(command("watchlist")?.label).toBe("Watchlist");
expect(command("playlists")?.label).toBe("Playlists");
expect(command("up-next")?.label).toBe("Up Next");
expect(commandByAlias("playlist")?.id).toBe("playlists");
expect(commandByAlias("queue")?.id).toBe("up-next");
```

Run:

```sh
bun run --cwd apps/cli test:file test/unit/domain/session/command-registry-contexts.test.ts
```

Expected: fail because `playlists` and `up-next` are missing or aliases resolve to old ids.

- [ ] **Step 2: Update command ids and aliases**

In `command-registry.ts`:

- add `playlists`
- add `up-next`
- add `unfollow`
- keep `playlist` only as an alias for `playlists`
- keep `queue` only as an alias for `up-next`
- keep `bookmark` as an alias/verb for Watchlist toggle

Do not delete legacy `playlist-add` until Task 2 replaces its effect.

- [ ] **Step 3: Add command grouping metadata**

Add a command group field or helper returning:

```ts
type AppCommandGroup = "Core" | "Playback" | "Attention" | "Advanced" | "Experimental";
```

Map:

- Core: search, continue, watchlist, playlists, up-next, download, downloads, library, share, settings, help
- Playback: next, previous, pick-episode, replay, source, quality, audio, subtitle, recover, fallback
- Attention: follow, unfollow, mute, notifications, calendar
- Advanced: diagnostics, export-diagnostics, clear-cache, reset-provider-health, recompute, report-issue
- Experimental: sync, favorites, random, surprise if the product wants them demoted

- [ ] **Step 4: Reduce browse/root palette defaults**

In `search-browse-command-ids.ts`, keep the browse palette focused:

```ts
continue, watchlist, playlists, up-next, recommendation, calendar,
download, downloads, library, history, settings, diagnostics, help, quit
```

Keep advanced commands available through diagnostics/help contexts, not first-page browse palette.

- [ ] **Step 5: Run targeted tests**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/domain/session/command-registry-contexts.test.ts
bun run --cwd apps/cli test:file test/unit/app-shell/command-registry.coverage.test.ts
```

Expected: pass.

---

### Task 2: Personal Media Action Semantics

**Files:**

- Modify: `apps/cli/src/domain/media/media-action-policy.ts`
- Modify: `apps/cli/src/services/media-actions/MediaActionRouter.ts`
- Modify: `apps/cli/src/services/media-actions/create-container-media-action-router.ts`
- Test: `apps/cli/test/unit/services/media-actions/MediaActionRouter.test.ts`
- Test: `apps/cli/test/unit/services/media-actions/create-container-media-action-router.test.ts`

**Interfaces:**

- Consumes: Task 1 command vocabulary.
- Produces:
  - `add-to-watchlist`
  - `add-to-playlist`
  - `add-to-up-next`
  - `follow`
  - `unfollow`
  - `mute`

- [ ] **Step 1: Write failing router tests**

Add/adjust tests:

```ts
await router.run({ actionId: "add-to-watchlist", item, source: "search" });
expect(calls).toContain("watchlist");

await router.run({ actionId: "add-to-playlist", item, source: "details" });
expect(calls).toContain("playlist-picker");

await router.run({ actionId: "add-to-up-next", item, source: "search" });
expect(calls).toContain("queue");
```

Expected: fail because current `add-to-playlist` writes watchlist.

- [ ] **Step 2: Split action ids**

In `media-action-policy.ts`, replace ambiguous `add-to-playlist` use with explicit ids:

```ts
| "add-to-watchlist"
| "add-to-playlist"
| "add-to-up-next"
```

Keep compatibility at command-dispatch level, not by making the action id ambiguous.

- [ ] **Step 3: Update `MediaActionRouter` dependencies**

Change deps shape so:

- watchlist adapter calls `listService.addToWatchlist`
- playlist adapter opens/uses durable playlist intent
- queue adapter calls `queueService.enqueueMediaItem`
- attention adapter supports follow/unfollow/mute

- [ ] **Step 4: Update container adapter**

In `create-container-media-action-router.ts`, route:

- `add-to-watchlist` -> `container.listService.addToWatchlist`
- `add-to-up-next` -> `container.queueService.enqueueMediaItem`
- `add-to-playlist` -> return unsupported unless caller supplies a playlist picker adapter, or call a real durable playlist adapter when available

The important invariant: `add-to-playlist` must not silently write Watchlist.

- [ ] **Step 5: Run targeted tests**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/services/media-actions/MediaActionRouter.test.ts
bun run --cwd apps/cli test:file test/unit/services/media-actions/create-container-media-action-router.test.ts
```

Expected: pass.

---

### Task 3: Playlist And Watchlist Surfaces

**Files:**

- Modify: `apps/cli/src/domain/lists/ListService.ts`
- Modify: `apps/cli/src/services/playlists/DurablePlaylistService.ts`
- Modify: `apps/cli/src/app-shell/workflows/shell-workflows.ts`
- Modify: `apps/cli/src/app-shell/details-panel.ts`
- Test: `apps/cli/test/unit/services/playlists/DurablePlaylistService.test.ts`
- Test: existing or new `apps/cli/test/unit/domain/lists/*`

**Interfaces:**

- Consumes: Task 1 commands and Task 2 action ids.
- Produces:
  - Watchlist as built-in playlist semantics
  - custom durable playlists
  - load playlist into Up Next
  - safe import/export copy and gating

- [ ] **Step 1: Write failing built-in Watchlist tests**

Assert:

```ts
expect(service.getWatchlist()).toEqual(repo.getItems("watchlist"));
expect(() => service.deleteList("watchlist")).toThrow();
```

If delete guards already exist elsewhere, update tests to match current behavior.

- [ ] **Step 2: Lock durable playlist export safety**

In `DurablePlaylistService.test.ts`, assert exported JSON does not contain:

```ts
http;
headers;
cookie;
token;
localPath;
```

Expected: pass or fail depending on current provider hints shape. Fix only if needed.

- [ ] **Step 3: Update playlist workflow copy**

In `shell-workflows.ts`:

- `/playlists` opens durable playlist manager.
- `/watchlist` opens built-in Watchlist.
- `/up-next` opens playback queue/Up Next.
- "Save queue as durable playlist" becomes "Save Up Next as playlist".
- "Play saved playlist" becomes "Load playlist into Up Next".

- [ ] **Step 4: Gate incomplete playlist sharing**

If `container.featureFlags.playlistSharing` is false, import/export actions must not show in stable playlist manager. They may show with disabled copy only under an explicit experimental/advanced group.

- [ ] **Step 5: Run targeted tests**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/services/playlists/DurablePlaylistService.test.ts
bun run --cwd apps/cli test:file test/unit/domain/lists
```

Expected: pass.

---

### Task 4: Up Next Separation

**Files:**

- Modify: `apps/cli/src/domain/queue/QueueService.ts`
- Modify: `apps/cli/src/app-shell/queue-shell.tsx`
- Modify: `apps/cli/src/app-shell/queue-view.ts`
- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx`
- Modify: `apps/cli/src/app-shell/workflows/shell-workflows.ts`
- Test: `apps/cli/test/unit/domain/queue/QueueService.test.ts`
- Test: `apps/cli/test/unit/app-shell/queue-view.test.ts`
- Test: `apps/cli/test/unit/app-shell/queue-shell.test.tsx`

**Interfaces:**

- Consumes: Task 1 `/up-next` command and Task 3 playlist load behavior.
- Produces: one user-facing Up Next surface for playback queue/order.

- [ ] **Step 1: Write failing copy tests**

Add render/copy assertions:

```ts
expect(frame).toContain("Up Next");
expect(frame).not.toContain("Playlist Queue");
```

- [ ] **Step 2: Replace user-facing queue copy**

Use "Up Next" for the playback queue everywhere visible.

Allowed implementation names can remain `QueueService` and `playlist_queue` for now. Do not perform storage renames in this pass.

- [ ] **Step 3: Route `/up-next` to the queue overlay**

Update command dispatcher/routing so `/up-next` opens the root queue overlay.

Legacy `/queue` should resolve to `/up-next`.

- [ ] **Step 4: Preserve `/downloads` meaning**

Assert `/downloads` still opens download jobs and is not confused with Up Next.

- [ ] **Step 5: Run targeted tests**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/domain/queue/QueueService.test.ts
bun run --cwd apps/cli test:file test/unit/app-shell/queue-view.test.ts
bun run --cwd apps/cli test:file test/unit/app-shell/queue-shell.test.tsx
```

Expected: pass.

---

### Task 5: Attention Follow, Unfollow, And Mute

**Files:**

- Modify: `packages/storage/src/repositories/followed-titles.ts`
- Modify: `apps/cli/src/services/attention/FollowedTitleService.ts`
- Modify: `apps/cli/src/services/attention/build-attention-refresh-candidates.ts`
- Modify: `apps/cli/src/app-shell/workflows/shell-workflows.ts`
- Modify: `apps/cli/src/app-shell/post-play-view.ts`
- Test: `packages/storage/test/attention-storage.test.ts`
- Test: `apps/cli/test/unit/services/release-reconciliation/enqueue-release-reconciliation.test.ts`

**Interfaces:**

- Consumes: Task 2 attention action ids.
- Produces:
  - follow = explicit release attention
  - unfollow = neutral/implicit state
  - mute = suppress release attention

- [ ] **Step 1: Write failing unfollow tests**

Assert:

```ts
repo.upsert({ titleId, preference: "following", ... });
service.unfollow(titleId);
expect(repo.get(titleId)?.preference).toBe("implicit");
```

If the chosen implementation deletes the row instead, test the exact chosen neutral behavior consistently.

- [ ] **Step 2: Implement unfollow semantics**

Prefer setting preference to `implicit` if the code already treats implicit as neutral. Otherwise delete explicit preference rows and update consumers to treat missing as implicit.

- [ ] **Step 3: Update user-facing copy**

Use:

- "Follow releases"
- "Unfollow releases"
- "Mute release nudges"

Do not say Follow means saving to Watchlist.

- [ ] **Step 4: Update notification/release eligibility**

Ensure:

- following -> calendar shelf and notifications eligible
- implicit -> heuristic/recent-interest behavior only
- muted -> no shelf/no notification

- [ ] **Step 5: Run targeted tests**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/services/release-reconciliation/enqueue-release-reconciliation.test.ts
bun run --cwd packages/storage test:file test/attention-storage.test.ts
```

If the package script does not support `test:file`, use the repo's existing targeted test command shape for storage tests.

---

### Task 6: Keybinding Parity And Familiar Shortcuts

**Files:**

- Modify: `apps/cli/src/app-shell/keybindings.ts`
- Modify: `apps/cli/src/app-shell/post-play-footer-actions.ts`
- Modify: `apps/cli/src/app-shell/playback-session-key-hints.ts`
- Modify: `apps/cli/src/app-shell/browse-shell.tsx`
- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx`
- Test: `apps/cli/test/unit/app-shell/keybindings.test.ts`
- Test: `apps/cli/test/unit/app-shell/keybindings-collision.test.ts`
- Test: `apps/cli/test/unit/app-shell/post-play-footer-actions.test.ts`

**Interfaces:**

- Consumes: Task 1 command ids.
- Produces: registry-backed shortcuts and help/footer parity.

- [ ] **Step 1: Write failing keybinding tests**

Assert:

```ts
expect(bindingForCommand("watchlist")).toBeDefined();
expect(bindingForCommand("playlists")).toBeDefined();
expect(bindingForCommand("up-next")).toBeDefined();
expect(resolveKeybinding(["global", "browse"], "/", key)).toMatchCommandPalette();
```

- [ ] **Step 2: Preserve hard globals**

Ensure these remain global:

- `/` command palette
- `?` help when not text-focused
- `Esc` close/back
- `Ctrl+C` hard exit

- [ ] **Step 3: Add familiar surface bindings**

Use:

- browse result focus: `q` add to Up Next, `w` add/remove Watchlist or open Watchlist action where current behavior requires
- playback/post-play: `n`, `p`, `e`, `a`, `u`, `x`, `d`, `s`, `/`
- lists/playlists/up-next: arrows, Enter, `x` remove, `a` add, `m` menu, `/`

Do not bind printable keys in focused search/filter/input fields.

- [ ] **Step 4: Update help/footer derivation**

Where possible, footer hints and help overlay labels must read from `KEYBINDINGS`.

Do not duplicate shortcut text in surface copy unless the existing helper cannot support the surface yet.

- [ ] **Step 5: Run targeted tests**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/app-shell/keybindings.test.ts
bun run --cwd apps/cli test:file test/unit/app-shell/keybindings-collision.test.ts
bun run --cwd apps/cli test:file test/unit/app-shell/post-play-footer-actions.test.ts
```

Expected: pass.

---

### Task 7: User-Facing Docs And Verification

**Files:**

- Modify: `.docs/features/playlists.md`
- Modify: `.docs/features/queue.md`
- Modify: `.docs/keybindings.md`
- Modify: `docs/users/commands-and-shortcuts.mdx`
- Test: relevant docs/build checks if available

**Interfaces:**

- Consumes: Tasks 1-6.
- Produces: docs matching implemented vocabulary and shortcuts.

- [ ] **Step 1: Update feature docs**

Use:

- Playlist = durable collection
- Watchlist = built-in playlist
- Up Next = playback queue
- Follow = release attention
- Mute = suppress attention

- [ ] **Step 2: Update command docs**

Document:

```text
/watchlist
/playlists
/up-next
/follow
/unfollow
/mute
/share
/downloads
/library
```

Include compatibility aliases but do not headline old names.

- [ ] **Step 3: Run full gates**

Run:

```sh
bun run typecheck
bun run lint
bun run fmt
bun run test
```

Expected: all pass, except pre-existing unrelated dirty-worktree failures must be reported with exact failing files.

- [ ] **Step 4: Optional build gate**

If implementation touched broad command/docs/shell areas, run:

```sh
bun run build
```

Expected: pass.

---

## Execution Notes For Orchestrator

- Start with Task 1. Do not let later agents invent their own names.
- Keep write scopes disjoint where possible.
- The working tree may already contain unrelated user changes; do not revert them.
- If an agent finds existing code already partially implements a step, it should update tests and copy to match the locked vocabulary rather than rewrite the module.
- If a command id rename creates too much churn, keep the old id internally and change label/alias semantics first. User-visible truth matters more than internal rename purity in this pass.

## Self-Review

- Spec coverage: all locked terms from the design spec map to tasks.
- Placeholder scan: no TBD/TODO placeholders are present.
- Type consistency: plan uses `playlists`, `up-next`, `follow`, `unfollow`, `mute`, and legacy aliases consistently.
- Risk: exact test command shape for storage package may need adjustment by executor based on package scripts.

## Execution Options

Plan complete and saved to `docs/superpowers/plans/2026-06-25-personal-media-vocabulary-and-keybindings.md`. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.

Recommended: Subagent-Driven, because command vocabulary, media actions, playlist/up-next surfaces, attention, and keybindings are separable enough for parallel or staged agents.
