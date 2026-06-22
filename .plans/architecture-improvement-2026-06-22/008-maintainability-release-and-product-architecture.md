# Plan 008: Maintainability, Release Notes, and Product Architecture

Status: implemented
Priority: P1
Effort: L
Risk: Medium
Created: 2026-06-22

## Problem

Kunai is gaining mature runtime pieces, but the codebase still has places where adding a feature means editing several unrelated files. That is the exact failure mode a long-lived TUI should avoid.

Current evidence:

- `apps/cli/src/app-shell/keybindings.ts` is the intended shortcut registry, but runtime handling is still being migrated.
- `apps/cli/src/app-shell/ink-shell.tsx` and `root-overlay-shell.tsx` remain large mixed-ownership files.
- `SessionStateManager` and `useSessionSelector` exist, but root content and helper screens still have module-global subscriber paths.
- Release versioning is handled by Changesets, and root changelog mirroring exists via `scripts/sync-root-changelog.ts`, but docs-style release notes and GitHub release bodies are not generated from one release artifact.
- `turbo.json` has basic tasks, but repo architecture guards, package-boundary checks, and release-note generation are not first-class Turbo tasks.
- Root `package.json` duplicates workspace dependency versions across packages instead of using a centralized dependency policy.

## Goal

Make Kunai boring to extend:

- A new app shortcut should be added once to a typed registry, mapped once to an action, and automatically appear in help/footer UI.
- A new provider-facing feature should live behind core/provider/storage/service seams rather than leaking into app-shell or infra.
- A new release should generate package changelog, root changelog, docs release page data, and GitHub release body from one source.
- CI should run the smallest reliable checks for PRs and the full release-safe gates for main/release.
- Package dependency versions should be centralized and auditable.

## Non-Goals

- Do not introduce user-configurable keybindings until internal runtime paths are canonical.
- Do not replace `SessionStateManager` with Zustand for canonical session state.
- Do not redesign the whole TUI before shell state and action ownership are stable.
- Do not rewrite Changesets; extend it with generated artifacts.
- Do not adopt a dependency catalog format until current Bun support and lockfile behavior are verified.

## Design Principles

### Single Source of Truth

Every product action should have one canonical record:

```text
keybinding/action registry -> availability resolver -> dispatcher -> UI hints/help
```

No footer-only shortcuts, help-only runtime claims, or separate post-playback action tables unless the table is generated from the registry.

### State Ownership

Use:

- `SessionStateManager` for session/domain state that must survive across screens or affect playback/search/provider behavior.
- Local React state for private component-only focus/index/input.
- A tiny app-shell external store only for ephemeral cross-surface UI state that is not domain state and is proven to remove code.

Avoid:

- module-global subscriber sets for rendered screens
- stale `getState()` reads in async callbacks when a subscribed snapshot or transition result is available
- a second canonical state library for playback/search/session state

### Package Boundaries

Target ownership:

- `packages/core`: provider cycle engine, tracing types, cache policy, deterministic orchestration primitives.
- `packages/providers`: provider adapters and provider-specific parsing/auth/materialization facts.
- `packages/storage`: SQLite repositories, migrations, storage contracts.
- `apps/cli/src/services`: application services that coordinate providers, storage, playback, history, diagnostics, and prefetch.
- `apps/cli/src/infra`: mpv, process, IPC, terminal, filesystem mechanics only.
- `apps/cli/src/app-shell`: Ink components, action dispatch, keybindings, shell view-models.

Boundary guards should fail the build when infra imports providers, providers import app-shell, or storage imports CLI UI.

### Release Notes

Keep Changesets as the version source, but generate a release artifact:

```text
apps/cli/CHANGELOG.md
  -> scripts/generate-release-notes.ts
  -> .release/kunai-vX.Y.Z.json
  -> CHANGELOG.md
  -> docs release page data
  -> GitHub release body
```

The generated artifact should include:

- version
- date
- summary
- grouped changes (`Added`, `Changed`, `Fixed`, `Provider`, `Internal`)
- install/upgrade commands
- binary asset names/checksums after binary build
- links to docs and GitHub compare when available

Docs can render a Zen-style release page from the JSON/MDX data without hand-maintained duplicate copy.

### Turbo and CI

Use Turbo as the repo task graph, not just a command runner:

- Package scripts own package behavior.
- Root scripts delegate with `turbo run`.
- Add repo-level generated-artifact guards as explicit package/root tasks.
- Consider PR-time `turbo run ... --affected` only after proving it does not hide cross-package contract failures.
- Keep release/main workflows on full gates until boundary and generated-artifact tests are mature.

## Implementation Order

1. Finish Plan 001 and the remaining Plan 002 slices.
   - Active playback, post-playback, and command-palette actions should use one dispatcher path.
2. Continue Plan 003.
   - Migrate one root content/helper screen from module-global subscribers into reducer-backed state.
   - Repeat until `rootShellSubscribers` and `rootContentSubscribers` can be deleted.
3. Add package boundary guard tests.
   - Extend existing import-boundary tests for `infra`, `providers`, `storage`, and `app-shell`.
   - Document exceptions explicitly, not with broad allowlists.
4. Add release-note artifact generation.
   - Start read-only/generate-only.
   - Add tests for changelog parsing and artifact shape.
   - Wire docs rendering after artifact shape is stable.
5. Wire GitHub release body from the artifact.
   - Keep Changesets publish flow.
   - Feed `softprops/action-gh-release` a generated body file.
6. Add Turbo release/doc tasks.
   - `release:notes`
   - `release:notes:check`
   - `boundary:check`
   - `repo:doctor` only if it is narrow and testable.
7. Evaluate workspace dependency catalogs.
   - Verify current Bun catalog support and lockfile behavior before changing manifests.
   - If adopted, start with devDependencies shared by root/docs/cli, then runtime deps only after CI proves stable.
8. Start Netflix-like TUI product work only after action/state ownership is stable.
   - Artwork-forward browse rails.
   - Continue watching and up-next hierarchy.
   - Provider health and availability badges that reflect real diagnostics.
   - Fast recovery paths after failed resolve.

## Tests

Add or extend:

- `apps/cli/test/unit/app-shell/playback-session-key-hints.test.ts`
- `apps/cli/test/unit/app-shell/app-command-dispatcher.test.ts`
- `apps/cli/test/unit/architecture/boundary-imports.test.ts`
- `test/unit/scripts/release-changelog.test.ts`
- new `test/unit/scripts/generate-release-notes.test.ts`
- docs build test after release page rendering exists

## Verification

Run focused gates for each slice, then:

```sh
bun run typecheck
bun run lint
bun run fmt:check
bun run test
bun run build
bun run build:docs
bun run pkg:check
```

Release-note slices should also run:

```sh
bun run guard
bun run release:notes:check
```

## Acceptance Criteria

- Adding an app-owned shortcut requires changing only the registry, dispatcher mapping, and business logic handler.
- Visible shortcut help/footer copy is derived from the registry.
- App-shell does not own provider/source extraction policy.
- Infra does not import provider packages.
- Root shell rendered state no longer depends on module-global subscriber sets.
- Release notes, root changelog, docs release pages, and GitHub release bodies derive from the same generated artifact.
- CI/Turbo tasks make boundary and release drift fail early.

## Implemented Slices

### Release Note Artifact Generation

- Added `scripts/generate-release-notes.ts`.
- Added `bun run release:notes` and `bun run release:notes:check`.
- Generated tracked `.release/kunai-v0.2.5.json` and `.release/kunai-v0.2.5.md` from the current package version and root changelog entry.
- Added unit tests for release body section parsing, artifact generation, and Markdown rendering.
- Wired release workflows to run `bun run release:notes:check` and to trigger when `.release/**` or the generator changes.
- Wired `version:packages` to regenerate release-note artifacts after Changesets updates the package changelog and root changelog.
- Wired GitHub release upload to use `.release/kunai-vX.Y.Z.md` as the release body.
- Added `/releases` docs route rendered from `.release/*.json`.
- Added `apps/docs/lib/release-notes.ts` and tests proving docs release notes load from the tracked artifact.
- Updated docs codegen drift guards to follow the current provider registry and CLI help ownership.

Remaining follow-up:

- Add binary checksum fields after `build:binaries` produces `SHA256SUMS`.
- Evaluate dependency catalogs only after current Bun support and lockfile behavior are verified in a separate scoped commit.

## Rollback

Each slice should be independently reversible:

- Dispatcher/keybinding changes can restore previous call sites.
- State migrations can restore the previous helper screen mount path.
- Release-note generation can remain check-only until docs/GitHub release wiring is stable.
- Catalog adoption must be a separate commit with lockfile diff review and full CI.
