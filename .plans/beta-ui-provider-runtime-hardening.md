# Beta UI And Provider Runtime Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Kunai beta playback and shell UX deterministic by unifying picker/modal state, provider source inventory caching, provider-internal retry, provider fallback, catalog/trending cache policy, and hardsub/source/quality/language display.

**Architecture:** Providers return normalized source inventory and own provider-specific source retry. The playback runtime owns cache orchestration, user intent, fallback, and abort policy. The Ink shell renders one modal/picker system over persistent surfaces, with commands and footer actions derived from one command registry.

**Tech Stack:** Bun runtime, TypeScript, Ink/React, mpv IPC, `@kunai/types`, `@kunai/core`, `@kunai/providers`, `@kunai/storage`, SQLite.

---

## Routing Docs

Read these before implementation:

- [.docs/playback-source-inventory-contract.md](../.docs/playback-source-inventory-contract.md)
- [.docs/ux-architecture.md](../.docs/ux-architecture.md)
- [.docs/engineering-guide.md](../.docs/engineering-guide.md)
- [.plans/provider-result-contract.md](./provider-result-contract.md)
- [.plans/search-service.md](./search-service.md)
- [.plans/cli-ux-overhaul.md](./cli-ux-overhaul.md)
- [.plans/series-catalog-end-state-and-upcoming-episode-ux.md](./series-catalog-end-state-and-upcoming-episode-ux.md)

Useful provider evidence:

- `apps/experiments/README.md`
- `apps/experiments/scratchpads/provider-vidking/VIDKING_NETWORK_ANALYSIS.md`
- `apps/experiments/scratchpads/provider-miruro/MIRURO_BACKEND_REPORT.md`
- `apps/experiments/scratchpads/provider-rivestream/RIVESTREAM_DECRYPT_REPORT.md`
- `.docs/provider-dossiers/`

## Decisions Locked For This Plan

- Keep Bun as the source-runtime requirement for beta. Do not spend beta reliability time on a Node/npm-only source path.
- Reduce onboarding friction with packaged binary/install checks later, not by replacing Bun APIs now.
- Do not introduce Zustand for beta shell state. Adapt `SessionStateManager` to React with selector hooks first.
- Provider-internal source retry happens before provider fallback.
- Source/quality/subtitle pickers read normalized cached inventory and should not recompute unrelated provider work.
- The UI must distinguish hard-sub, soft-sub, audio language, dub availability, and unknown availability.
- Trending/discovery belongs in catalog/search services and should use deterministic cache/in-flight behavior like other metadata.

## File Structure

Expected files to create:

- `apps/cli/src/app-shell/use-session-selector.ts`: React hook around `SessionStateManager` using `useSyncExternalStore`.
- `apps/cli/src/app-shell/picker-controller.ts`: typed picker request/result model.
- `apps/cli/src/app-shell/picker-overlay.tsx`: one reusable modal picker view.
- `apps/cli/src/app-shell/input-router.ts`: focused input/modal/global command routing helpers.
- `apps/cli/src/services/playback/SourceInventoryService.ts`: source inventory cache/read/write helpers over `SourceInventoryRepository`.
- `apps/cli/src/services/playback/PlaybackResolveService.ts`: cache lookup, provider resolve, fallback, abort, trace persistence.
- `apps/cli/src/services/catalog/CatalogDiscoveryService.ts`: deterministic trending/discovery service over current `discovery-lists` behavior.
- `apps/cli/test/unit/app-shell/picker-controller.test.ts`: picker state behavior.
- `apps/cli/test/unit/app-shell/input-router.test.ts`: input ownership behavior.
- `apps/cli/test/unit/services/playback/source-inventory-service.test.ts`: cache key and inventory behavior.
- `apps/cli/test/unit/services/playback/playback-resolve-service.test.ts`: provider retry/fallback/abort behavior.
- `apps/cli/test/unit/services/catalog/catalog-discovery-service.test.ts`: trending cache and in-flight behavior.

Expected files to modify:

- `apps/cli/src/container.ts`: wire `SourceInventoryRepository` and playback/catalog services.
- `apps/cli/src/domain/types.ts`: add CLI-facing availability display fields only if not already covered by `@kunai/types`.
- `apps/cli/src/services/providers/Provider.ts`: add optional resolve preferences only if needed; prefer existing `StreamRequest` plus provider-result contract.
- `apps/cli/src/app/PlaybackPhase.ts`: replace local provider resolve/cache/fallback/source switching with `PlaybackResolveService`.
- `apps/cli/src/app/source-quality.ts`: make source/quality/subtitle/hardsub option builders consume full inventory deterministically.
- `apps/cli/src/app/discovery-lists.ts`: move behind catalog service or keep as implementation detail.
- `apps/cli/src/app/anime-metadata.ts`: keep title aliases cached and projected; avoid refetch for display preference.
- `apps/cli/src/app-shell/ink-shell.tsx`: split browse/playback/list/picker pieces out.
- `apps/cli/src/app-shell/root-picker-bridge.ts`: remove after modal picker state replaces promise bridge.
- `apps/cli/src/app-shell/root-overlay-shell.tsx`: render shared picker overlay instead of bespoke picker logic where possible.
- `apps/cli/src/domain/session/SessionState.ts`: add typed modal/picker state if needed.
- `apps/cli/src/domain/session/command-registry.ts`: make command keys/footer visibility the source of truth.
- `README.md`: document beta runtime requirement, packaged-binary direction, controls, and troubleshooting after behavior lands.

## Task 1: Session Selector Hook

**Files:**
- Create: `apps/cli/src/app-shell/use-session-selector.ts`
- Test: `apps/cli/test/unit/app-shell/use-session-selector.test.tsx`

- [x] **Step 1: Write tests for selector updates**

Create a test that mounts a tiny Ink/React component against a fake `SessionStateManager`, selects one field, dispatches an unrelated transition, and verifies the selected component does not receive a changed value.

- [x] **Step 2: Implement `useSessionSelector`**

Use `useSyncExternalStore` with:

```ts
export function useSessionSelector<T>(
  stateManager: SessionStateManager,
  selector: (state: SessionState) => T,
): T
```

The hook should subscribe to `stateManager.subscribe`, read `stateManager.getState()`, and return the selected value.

- [x] **Step 3: Replace broad root subscriptions**

Start with `AppRoot` and root overlay reads. Do not migrate every component yet; this task proves the pattern.

- [x] **Step 4: Verify**

Run:

```sh
bun run typecheck
bun run test -- apps/cli/test/unit/app-shell/use-session-selector.test.tsx
```

## Task 2: Unified Picker Model

**Files:**
- Create: `apps/cli/src/app-shell/picker-controller.ts`
- Create: `apps/cli/src/app-shell/picker-overlay.tsx`
- Test: `apps/cli/test/unit/app-shell/picker-controller.test.ts`

- [x] **Step 1: Define picker state**

Model:

```ts
type PickerRequest = {
  id: string;
  title: string;
  subtitle: string;
  options: readonly ShellPickerOption<string>[];
  initialIndex?: number;
  filterQuery?: string;
  emptyMessage?: string;
};

type PickerResult =
  | { type: "selected"; id: string; value: string }
  | { type: "cancelled"; id: string };
```

- [x] **Step 2: Add reducer helpers**

Implement pure helpers for filter changes, selection movement, `Esc` clear-filter vs cancel, and confirm.

- [x] **Step 3: Render one modal picker**

Build `PickerOverlay` with bounded rows from `getShellViewportPolicy`, optional companion detail, and footer actions from the shared command model.

- [x] **Step 4: Migrate one picker path**

Migrate `openSourcePicker` first because it is playback-critical and already uses normalized inventory.

- [x] **Step 5: Verify**

Run:

```sh
bun run typecheck
bun run test -- apps/cli/test/unit/app-shell/picker-controller.test.ts
```

## Task 3: Remove Promise Picker Bridge

**Files:**
- Modify: `apps/cli/src/app-shell/root-picker-bridge.ts`
- Modify: `apps/cli/src/app-shell/workflows.ts`
- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx`
- Modify: `apps/cli/src/domain/session/SessionState.ts`

- [x] **Step 1: Add typed picker modal transitions**

Add state transitions equivalent to:

```ts
OPEN_PICKER
UPDATE_PICKER_FILTER
MOVE_PICKER_SELECTION
RESOLVE_PICKER
CANCEL_PICKER
```

Use existing `activeModals` if possible; do not add a second overlay stack.

- [x] **Step 2: Replace `waitForRootPicker()` call sites**

Replace season, episode, subtitle, source, quality, and anime episode picker waits with typed modal requests and command results.

- [x] **Step 3: Delete or quarantine `root-picker-bridge.ts`**

After call sites are gone, remove the module or leave a deprecated wrapper only if tests still need it.

- [x] **Step 4: Verify cancel behavior**

Add tests for:

- first `Esc` clears non-empty filter
- second `Esc` cancels picker
- command palette open/close preserves picker filter and selection

Run:

```sh
bun run typecheck
bun run test -- apps/cli/test/unit/app-shell
```

## Task 4: Input Ownership Router

**Files:**
- Create: `apps/cli/src/app-shell/input-router.ts`
- Modify: `apps/cli/src/app-shell/shell-command-ui.tsx`
- Modify: `apps/cli/src/app-shell/shell-frame.tsx`
- Modify: `apps/cli/src/app-shell/ink-shell.tsx`
- Test: `apps/cli/test/unit/app-shell/input-router.test.ts`

- [x] **Step 1: Encode input priority**

Implement priority:

1. hard global: `Ctrl+C`
2. command palette when open
3. top modal/picker
4. focused text input
5. surface shortcuts

- [ ] **Step 2: Route `/`, `Esc`, `?`, and footer shortcuts centrally**

Remove duplicate direct handling where possible. Keep local handlers only for domain-specific actions after input routing decides ownership.

- [x] **Step 3: Verify no swallowed keys**

Tests should cover `/` from search input, picker filter, playback surface, and modal overlay.

Run:

```sh
bun run test -- apps/cli/test/unit/app-shell/input-router.test.ts
```

## Task 5: Source Inventory Cache Service

**Files:**
- Create: `apps/cli/src/services/playback/SourceInventoryService.ts`
- Modify: `apps/cli/src/container.ts`
- Test: `apps/cli/test/unit/services/playback/source-inventory-service.test.ts`

- [x] **Step 1: Wire `SourceInventoryRepository`**

`@kunai/storage` already exports `SourceInventoryRepository`. Add it to the cache DB side of `createContainer`.

- [x] **Step 2: Implement inventory key builder**

Key parts must include provider id, schema version, media kind, title id, episode identity, audio mode, subtitle language, runtime class when relevant.

- [x] **Step 3: Store full `ProviderResolveResult`**

Do not store only the selected stream. Preserve sources, variants, streams, subtitles, failures, trace, selected stream id, and cache policy.

- [x] **Step 4: Verify key isolation**

Tests must prove these do not collide:

- same provider, same episode, different sub/dub mode
- same provider, same episode, different subtitle language
- same title/episode across two providers
- same inventory with different selected quality does not create a new inventory key when all qualities were discovered upfront

Run:

```sh
bun run test -- apps/cli/test/unit/services/playback/source-inventory-service.test.ts
```

## Task 6: Playback Resolve Service

**Files:**
- Create: `apps/cli/src/services/playback/PlaybackResolveService.ts`
- Modify: `apps/cli/src/app/PlaybackPhase.ts`
- Test: `apps/cli/test/unit/services/playback/playback-resolve-service.test.ts`

- [x] **Step 1: Extract resolve orchestration from `PlaybackPhase`**

Move cache lookup, provider ordering, resolve attempts, provider fallback, and diagnostics event creation into `PlaybackResolveService`.

- [x] **Step 2: Implement abort semantics**

Represent:

- hard abort: no cache mutation after abort
- soft abandon: current playback does not switch back, but healthy finished inventory may be cached

- [x] **Step 3: Preserve existing playback start-intent semantics**

Do not regress:

- next/previous starts at beginning with Ctrl+R prompt when resume exists
- quality change resumes without prompt
- source change restarts with Ctrl+R prompt
- reload continues

- [x] **Step 4: Verify**

Run existing playback golden tests plus new resolve-service tests:

```sh
bun run test -- apps/cli/test/unit/services/playback/playback-resolve-service.test.ts
bun run test -- apps/cli/test/unit/app
```

## Task 7: Provider-Internal Source Retry Contract

**Files:**
- Modify: `packages/types/src/index.ts`
- Modify: `packages/core/src/resolver.ts`
- Modify: `packages/providers/src/vidking/direct.ts`
- Modify: `packages/providers/src/allmanga/direct.ts`
- Test: `packages/core/test/core.test.ts`
- Test: `packages/providers/test/providers.test.ts`

- [x] **Step 1: Make retry policy explicit**

Use existing `ProviderRetryPolicy` and trace event types. Do not add a second retry model.

- [x] **Step 2: VidKing source retry**

VidKing should retry retryable source failures per `VIDKING_SERVERS`, record `source:start`, `source:failed`, `retry:scheduled`, and `provider:exhausted`.

- [x] **Step 3: AllManga source handling**

AllManga should preserve all raw source-derived streams and variants. It should not collapse separate source families into one fake source when evidence exists.

- [x] **Step 4: Verify provider traces**

Tests must assert trace events include source id, attempt number, selected stream id, hard-sub language where relevant, and failures.

Run:

```sh
bun run test -- packages/core/test/core.test.ts packages/providers/test/providers.test.ts
```

## Task 8: Source, Quality, Subtitle, And Hardsub UI

**Files:**
- Modify: `apps/cli/src/app/source-quality.ts`
- Modify: `apps/cli/src/app/PlaybackPhase.ts`
- Modify: `apps/cli/src/app-shell/panel-data.ts`
- Modify: `apps/cli/src/app-shell/root-status-summary.ts`
- Test: `apps/cli/test/unit/app/source-quality.test.ts`

- [x] **Step 1: Add display builders**

Build display rows that distinguish:

- source/mirror
- quality
- protocol/container
- audio language
- hard-sub language
- soft subtitle count and selected language
- availability: available, unavailable, unknown

- [ ] **Step 2: Avoid unrelated subtitle calls**

If provider hard-sub satisfies the configured mode and `subLang` does not request soft subtitles, do not call unrelated external subtitle services.

- [x] **Step 3: Keep source and quality changes inventory-only**

Changing source/quality must select a candidate from inventory unless the candidate is explicitly deferred or expired.

- [x] **Step 4: Verify**

Run:

```sh
bun run test -- apps/cli/test/unit/app/source-quality.test.ts
```

## Task 9: Catalog, Anime Aliases, And Trending Determinism

**Files:**
- Create: `apps/cli/src/services/catalog/CatalogDiscoveryService.ts`
- Modify: `apps/cli/src/app/discovery-lists.ts`
- Modify: `apps/cli/src/app/anime-metadata.ts`
- Modify: `apps/cli/src/app/SearchPhase.ts`
- Test: `apps/cli/test/unit/services/catalog/catalog-discovery-service.test.ts`

- [x] **Step 1: Wrap discovery in a service**

Keep current TMDB/AniList implementation, but expose deterministic service methods:

```ts
loadTrending(mode, signal)
clearTrendingCache()
```

- [x] **Step 2: Preserve in-flight dedupe**

Current `discoveryInflight` behavior should move into the service or remain as a private implementation detail.

- [ ] **Step 3: Make anime title preference projection-only**

Switching English/Romaji/native/provider display must use cached `titleAliases`. It must not trigger another AniList or provider search when aliases exist.

- [ ] **Step 4: Model sub/dub availability honestly**

Search result details may show available/unavailable/unknown, but should not assume provider playability without evidence.

- [x] **Step 5: Verify**

Run:

```sh
bun run test -- apps/cli/test/unit/services/catalog/catalog-discovery-service.test.ts
```

## Task 10: Persistent Modal UI And Layout Bounds

**Files:**
- Modify: `apps/cli/src/app-shell/ink-shell.tsx`
- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx`
- Modify: `apps/cli/src/app-shell/shell-frame.tsx`
- Modify: `apps/cli/src/app-shell/layout-policy.ts`
- Test: `apps/cli/test/unit/app-shell/layout-policy.test.ts`

- [ ] **Step 1: Split `ink-shell.tsx`**

Extract root shell mounting, browse surface, playback surface, list/picker surface, and command palette into focused files.

- [ ] **Step 2: Use full viewport predictably**

For each supported size class, define bounded regions:

- header/status
- main content
- optional right panel
- modal overlay
- footer

- [ ] **Step 3: History right panel**

History should show a right-side detail panel when width allows:

- title and episode
- progress bar
- provider
- last watched
- resume/replay action availability
- source/subtitle summary when known

- [ ] **Step 4: Remove duplicated shortcut rows**

Footer should show only live actions. Help/command palette carries full shortcut detail.

- [ ] **Step 5: Verify**

Run:

```sh
bun run test -- apps/cli/test/unit/app-shell/layout-policy.test.ts
bun run --cwd apps/cli test:vhs:browse
bun run --cwd apps/cli test:vhs:help
```

## Task 11: README And Onboarding

**Files:**
- Modify: `README.md`
- Modify: `.docs/quickstart.md`
- Modify: `.docs/cli-reference.md`

- [x] **Step 1: Document Bun stance**

State that source installs require Bun for beta. Note that packaged binaries are the preferred future path for users who should not need to install Bun manually.

- [x] **Step 2: Document playback controls**

Controls must match actual behavior after Tasks 2-10:

- next/previous
- replay
- reload/recover
- source
- quality
- provider fallback
- subtitles/audio where available
- command palette

- [x] **Step 3: Document troubleshooting**

Include mpv missing, provider exhausted, subtitle unavailable, hardsub-only, and diagnostics export.

## Task 12: Verification And Regression Gate

**Files:**
- Modify tests as needed under `apps/cli/test/unit/`, `packages/core/test/`, `packages/providers/test/`, and `packages/storage/test/`.

- [ ] **Step 1: Run focused tests after each task**

Use the task-specific commands above.

- [ ] **Step 2: Run full local gate**

Run:

```sh
bun run typecheck
bun run lint
bun run test
```

- [ ] **Step 3: Manual smoke**

Manually verify:

- source change does not recompute inventory when candidates are cached
- quality change resumes at current point
- source change restarts with Ctrl+R prompt
- provider fallback shows source/provider exhaustion reason
- hardsub-only streams do not claim soft subtitles
- trending loads once per mode and reuses cache/in-flight work
- history detail panel fits wide and narrow terminals

## Completion Criteria

- Pickers and modals have one state model.
- No active runtime path depends on `root-picker-bridge`.
- Source/quality/subtitle choices are inventory selections, not blind re-resolves.
- Provider-internal retry and provider fallback are separated and traceable.
- Hard-sub, soft-sub, audio, dub, and unknown availability are visibly distinct.
- Trending/discovery follows the same deterministic cache/in-flight rules as other metadata.
- README and quickstart match the real beta runtime.
- `bun run typecheck`, `bun run lint`, and `bun run test` pass.
