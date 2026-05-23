# Sakura Parallel Agent Prompt Pack

Use this file to start clean implementation sessions without relying on chat history. Source code is truth. If a plan or design doc disagrees with code, inspect code first and report the mismatch.

## Recommended Execution Order

1. Run **Foundation Agent** first.
2. After Foundation reports passing targeted checks, run **Agent A** and **Agent B** in parallel.
3. Run **Agent C** after A/B stabilize, or run **Scout Agent C** now in read-only mode.

For real parallel implementation, use separate worktrees so dirty files do not collide:

```sh
git worktree add ../kunai-sakura-foundation -b sakura-foundation
git worktree add ../kunai-sakura-search -b sakura-search-details
git worktree add ../kunai-sakura-tracks -b sakura-tracks-command
git worktree add ../kunai-sakura-return-loop -b sakura-return-loop
```

Only create the A/B/C worktrees after Foundation has landed or after you intentionally choose read-only scouting.

## Hard Rules For All Agents

- Read `AGENTS.md` first.
- Runtime is Bun-first: use `bun`, `bunx`, and `bun run`.
- Do not run live provider checks unless explicitly requested.
- Do not run `fmt` or `lint` unless your prompt explicitly asks for it.
- Do not commit unless explicitly requested.
- Do not touch `packages/design/src/tokens.ts` or `apps/cli/src/app-shell/shell-theme.ts` unless your prompt explicitly allows it.
- Do not touch provider implementations unless your prompt explicitly allows it.
- Do not edit `apps/experiments/*`, docs website files, or archived legacy code.
- If a required shared primitive or view-model API is missing, stop and report instead of inventing a local one-off component.
- Every agent reports: files touched, tests run, failures, Sakura color decisions, and any behavior/design deviations.

## Foundation Agent Prompt

```text
You are the Foundation Agent for the Sakura S2/S4/S5 implementation path.

Read these files first:
- AGENTS.md
- .docs/design-system.md
- .plans/sakura-rollout.md
- .plans/sakura-shared-primitives-recovery-plan.md
- .design/cli/03-component-boundaries.md
- .design/cli/missing-surfaces-implementation-map.md
- .design/cli/kunai-missing-surfaces-board.html

Goal:
Implement ONLY .plans/sakura-shared-primitives-recovery-plan.md. This creates the shared Sakura primitives and recovery surfaces that later agents must consume.

Allowed files:
- apps/cli/src/app-shell/primitives/StateBlock.tsx
- apps/cli/src/app-shell/primitives/ActionList.tsx
- apps/cli/src/app-shell/primitives/ContextCard.tsx
- apps/cli/src/app-shell/primitives/PreviewRail.tsx
- apps/cli/src/app-shell/playback-recovery-view-model.ts
- apps/cli/src/app-shell/loading-shell.tsx
- apps/cli/src/app-shell/post-play-shell.tsx
- apps/cli/src/app-shell/shell-primitives.tsx
- apps/cli/src/app-shell/types.ts only if needed for shared types
- apps/cli/test/unit/app-shell/playback-recovery-view-model.test.ts
- apps/cli/test/unit/app-shell/loading-shell.test.ts
- apps/cli/test/unit/app-shell/post-play-shell.test.ts
- apps/cli/test/unit/app-shell/shell-primitives.test.ts
- .design/cli/03-component-boundaries.md only if primitive names or contracts change
- .plans/sakura-shared-primitives-recovery-plan.md only to tick completed checkboxes

Forbidden files:
- packages/design/src/tokens.ts
- apps/cli/src/app-shell/shell-theme.ts
- provider adapters
- search routing
- calendar service
- recommendations/discover services
- download/offline services
- apps/experiments/*
- archive/*

Implementation rules:
- Use semantic Sakura palette only.
- Failure surfaces must distinguish playback did not start, stream stalled, no source, quality unavailable, and provider degraded.
- Footer must keep at most four primary actions plus command mode.
- Compact footer must preserve recovery action and [/]/commands.
- Poster/preview slots must be stable; text should not jump when images load.
- Add or update tests before claiming completion.

Verification:
- Run targeted tests from the plan.
- Run bun run typecheck.
- Do not run fmt/lint unless asked.

Report:
- Files touched
- Tests run and results
- Every Sakura color/state decision made
- Any titles de-colored
- Any blocker or deviation from the plan
```

## Agent A Prompt: Search, Details, Recommendations

```text
You are Agent A for Sakura search/details/recommendation surfaces. Start only after Foundation Agent has landed or confirm the required shared primitives exist before editing.

Read these files first:
- AGENTS.md
- .docs/design-system.md
- .plans/sakura-rollout.md
- .design/cli/03-component-boundaries.md
- .design/cli/missing-surfaces-implementation-map.md
- .design/cli/kunai-missing-surfaces-board.html
- .docs/recommendations-and-discover.md

Goal:
Make browse/search/recommendation surfaces use the Sakura interaction model: query state separate from result filtering, stable preview rail, optional detailed sheet, and recommendation viewer reuse instead of one-off layouts.

Primary ownership:
- Search results
- Browse idle / quick continue
- Recommendation viewer
- Result preview rail
- Rich details sheet opened with shift+enter

Allowed files, subject to confirming current paths:
- apps/cli/src/app-shell/root-overlay-shell.tsx
- apps/cli/src/app-shell/root-overlay-model.ts
- apps/cli/src/app-shell/details-pane-ui.tsx
- apps/cli/src/app-shell/details-panel.ts
- apps/cli/src/app-shell/discover-shell.tsx
- apps/cli/src/app-shell/browse-idle-actions.ts
- related browse/search/recommendation unit tests under apps/cli/test/unit/app-shell/
- .design/cli/surfaces/search-details-calendar.md if implementation reveals a spec correction

Forbidden files:
- apps/cli/src/app-shell/loading-shell.tsx
- apps/cli/src/app-shell/post-play-shell.tsx
- apps/cli/src/app-shell/shell-primitives.tsx unless Foundation asks for a small integration patch
- track/source/quality picker files
- provider adapters
- packages/design/src/tokens.ts
- apps/cli/src/app-shell/shell-theme.ts

Implementation rules:
- Do not make the search screen noisier than the current one-line input.
- Enter on the query submits/refetches. Result filtering is separate and filters only the current result set.
- Preserve quick continue/resume affordance on browse idle.
- Preview rail should show poster, title, type/year, compact description, and a useful action/status. It should not show provider unless provider is the actual decision.
- Rich details should be opt-in via shift+enter and scrollable if needed.
- Recommendations should reuse the same list + preview pattern as browse/search.

Verification:
- Add or update focused unit tests for query/result-filter separation and selected preview behavior.
- Run the targeted tests you touched.
- Run bun run typecheck.
- Do not run fmt/lint unless asked.

Report:
- Files touched
- Tests run and results
- Color/state decisions
- Any de-colored titles
- Any missing backend contract that blocked richer details
```

## Agent B Prompt: Tracks, Pickers, Scoped Commands

```text
You are Agent B for Sakura tracks, pickers, and scoped command palette. Start only after Foundation Agent has landed or confirm the required shared primitives exist before editing.

Read these files first:
- AGENTS.md
- .docs/design-system.md
- .plans/sakura-rollout.md
- .design/cli/03-component-boundaries.md
- .design/cli/missing-surfaces-implementation-map.md
- .design/cli/kunai-missing-surfaces-board.html
- .docs/ux-architecture.md

Goal:
Make tracks/source/quality/audio/hardsub picking feel like capability inspection, not dead modal lists. Scope the command palette to the current surface so subpanels do not become portals to the entire app.

Primary ownership:
- Episode/source/quality/audio/hardsub pickers
- Tracks panel capability rows
- Scoped command palette entries for PPS and subpanels
- One-option and unavailable-state handling

Allowed files, subject to confirming current paths:
- apps/cli/src/app-shell/picker-overlay.tsx
- apps/cli/src/app-shell/pickers/*
- apps/cli/src/app-shell/command-router.ts
- apps/cli/src/app-shell/commands.ts
- apps/cli/src/app-shell/root-overlay-model.ts only if needed for command scope data and coordinated with Agent A
- related picker/command unit tests under apps/cli/test/unit/app-shell/
- .design/cli/surfaces/tracks-command-palette.md if you create or update the surface spec

Forbidden files:
- apps/cli/src/app-shell/loading-shell.tsx
- apps/cli/src/app-shell/post-play-shell.tsx
- provider adapters unless you stop first and report the missing contract
- search/details/recommendation layout files owned by Agent A
- packages/design/src/tokens.ts
- apps/cli/src/app-shell/shell-theme.ts

Implementation rules:
- A single option is a fact row, not a fake picker.
- If quality/source crashes or is unavailable, show the reason and recovery path.
- Group tracks by source, quality, audio, hard/soft subtitles, and language only when the backend data supports it.
- Do not expose global destructive/navigation commands inside a modal unless the scope explicitly allows it.
- Footer stays at most four primary actions plus commands.

Verification:
- Add or update focused tests for one-option facts, unavailable reason rows, and scoped command palette entries.
- Run the targeted tests you touched.
- Run bun run typecheck.
- Do not run fmt/lint unless asked.

Report:
- Files touched
- Tests run and results
- Color/state decisions
- Any backend metadata missing for correct rendering
- Any commands removed from subpanel scope
```

## Agent C Prompt: Return Loop, Calendar, History, Library

```text
You are Agent C for Sakura return-loop surfaces. Prefer starting after Foundation and Agent A/B APIs stabilize. If started before that, run in read-only scout mode and do not edit files.

Read these files first:
- AGENTS.md
- .docs/design-system.md
- .plans/sakura-rollout.md
- .design/cli/03-component-boundaries.md
- .design/cli/missing-surfaces-implementation-map.md
- .design/cli/kunai-missing-surfaces-board.html
- .docs/recommendations-and-discover.md
- .docs/download-offline-onboarding.md
- .plans/catalog-release-schedule-service.md

Goal:
Wire the habit loop across calendar, history, library, and browse idle: ready-for-you-now, aired-vs-available release states, countdowns, and resume-first memory.

Primary ownership:
- Calendar/release schedule UI
- Browse "ready for you now" band if not owned by Agent A
- History resume-first improvements
- Library/download surface Sakura parity
- Return-loop copy and state grammar

Allowed files, subject to confirming current paths:
- apps/cli/src/app-shell/calendar-ui.tsx
- apps/cli/src/app-shell/root-overlay-model.ts if calendar/history data shaping lives there and coordinated with Agent A
- apps/cli/src/app-shell/browse-idle-actions.ts if Agent A is not touching it
- apps/cli/src/app-shell/root-history-bridge.ts
- apps/cli/src/app-shell/library-shell.tsx
- apps/cli/src/app-shell/download-manager-shell.tsx
- related unit tests under apps/cli/test/unit/app-shell/
- .design/cli/surfaces/search-details-calendar.md if implementation reveals a spec correction

Forbidden files:
- playback recovery/loading files owned by Foundation
- track/source/quality picker files owned by Agent B
- provider adapters unless you stop first and report the missing contract
- packages/design/src/tokens.ts
- apps/cli/src/app-shell/shell-theme.ts

Implementation rules:
- Calendar must distinguish aired, available, resolving, upcoming, missed, and tracked.
- Countdown is more useful than raw clock time for today's drops.
- "Aired" does not mean playable. Avoid dead "watch now" actions.
- History and browse should prefer the return loop: resume, new since E#, ready now.
- Empty/loading/error states must be designed and testable.

Verification:
- Add or update focused tests for aired-vs-available state derivation and selected calendar preview.
- Run the targeted tests you touched.
- Run bun run typecheck.
- Do not run fmt/lint unless asked.

Report:
- Files touched
- Tests run and results
- Color/state decisions
- Any missing schedule metadata or backend contract
- Any surfaces intentionally deferred
```

## Scout Agent C Prompt: Safe Parallel Scout

```text
You are Scout Agent C for Sakura return-loop surfaces. This is read-only.

Read:
- AGENTS.md
- .docs/design-system.md
- .plans/sakura-rollout.md
- .design/cli/missing-surfaces-implementation-map.md
- .design/cli/kunai-missing-surfaces-board.html
- .plans/catalog-release-schedule-service.md

Inspect current code paths for calendar, history, library, download manager, browse idle, and release schedule data shaping.

Do not edit files.
Do not run fmt/lint.
Do not run live provider checks.

Return:
- Exact files that should be owned by Agent C
- Data contracts already available
- Missing contracts that block the desired UX
- Tests that should be added
- Any overlap risk with Agent A or Foundation
```
