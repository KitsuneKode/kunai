# Kunai Codebase Improvement Plans

Generated on 2026-06-22 from the local Kunai codebase, recent provider/runtime fixes, and Claude Code pattern research.

These plans are intentionally implementation-ready and scoped for small PRs. They should be executed in order unless a production incident makes the provider work-lane plan urgent.

## Recommended Order

1. `001-canonical-app-command-dispatcher.md`
   - Highest leverage. Makes palette commands, hotkeys, footer actions, and post-playback actions resolve through one app command path.
2. `002-keybinding-runtime-contexts.md`
   - Wires the existing `keybindings.ts` registry into real runtime input handling and makes visible key hints come from bound actions.
3. `003-session-state-selector-adoption.md`
   - Uses the existing `useSessionSelector` hook consistently and removes older manual root shell subscription slices.
4. `004-provider-work-lane-policy.md`
   - Formalizes foreground, near-need, prefetch, and diagnostic provider work so fallback, cycling, caching, and diagnostics stay deterministic under failure.
5. `005-cli-args-and-state-library-decisions.md`
   - Decides where Commander helps, where Zustand does not, and how to avoid dependency-driven architecture drift.
6. `006-package-seam-guards-and-provider-materialization.md`
   - Makes package ownership executable with import guard tests and moves provider-aware media materialization out of `infra/player`.
7. `007-memory-guard-policy.md`
   - Replaces the low single-sample RSS cutoff with a sustained/emergency policy that is safer for long-running sessions.

## Why This Set

Kunai already has strong provider orchestration and a real session reducer. The biggest current product risk is not missing primitives; it is duplicate paths around input, command effects, UI state subscriptions, and provider work classification. These plans target those seams first so future UX polish does not keep reintroducing drift.

## Guardrails

- Preserve the current direct-provider runtime and recent provider picker policy work.
- Do not add user-configurable keybindings until internal action routing is canonical.
- Do not split large shell files just for line count. Extract only after behavior is covered by dispatcher/input/state tests.
- Keep mpv-owned key handling documented as `helpOnly` bindings unless the app can actually intercept the key.
- Prefer tests around pure routing/model code before editing large Ink surfaces.

## Dependency Decisions

- Commander: worth considering for CLI argument parsing and subcommand/help generation, but not on the hot P0 input path. Add it only in a dedicated migration that preserves fast `--help` / `--version` exits and moves parser ownership out of `main.ts`.
- Zustand: do not use for canonical session state right now. Kunai already has `SessionStateManager` and `useSessionSelector`; adding Zustand there would create another state plane. Reconsider only for a small app-shell UI store if repeated selector/reducer boilerplate remains after Plan 003.
- No new library should be added because Claude Code uses a pattern. Add one only when it replaces custom code with less surface area, better tests, and clearer ownership.

## Added Boundary Work

- Package seam guard tests should encode `.docs/runtime-boundary-map.md` so drift fails in CI.
- `apps/cli/src/infra` should not import `@kunai/providers`; provider-aware media materialization belongs in playback services or a provider-result adapter seam.
- Provider result projection should be deepened before adding more provider-specific conditionals to shell, infra, or playback phase code.

## Implemented In This Pass

- Package seam guard now prevents `apps/cli/src/infra` from importing provider implementation packages directly.
- Provider-aware media materialization moved from `infra/player` to `services/playback`.
- Active playback commands route through a tested dispatcher seam.
- Global, player, and post-play shortcuts now resolve through keybinding runtime helpers before surface fallbacks.
- Post-play recommendation queue/details/download actions now execute through `MediaActionRouter` while preserving confirmation and anime mapping.
- Continuation projection policy now delegates to the pure continuation engine for shared resume/offline/next/new-episode decisions.
- Startup continue, root history selection/projection, history Enter targets, and result badges now consume the shared continuation decision owner.
- Media actions now return explicit handled/unsupported results; history queue/mark-watched and shell/watchlist follow/mute paths route through the shared executor.
- Provider background probe concurrency is policy-backed and injectable.
- Memory guard default/policy now handles long-running sessions less aggressively while preserving emergency protection.
