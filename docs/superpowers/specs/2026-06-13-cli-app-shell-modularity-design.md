# Kunai CLI App Shell Modularity Design

Status: Proposed
Date: 2026-06-13

## Problem

`apps/cli/src/app-shell/` mixes surface components, pure models, input handlers, shared primitives,
layout policy, and one-off helpers in one wide directory. That makes the shell hard to scan and makes
small UX fixes look riskier than they are because unrelated files sit side by side.

The target is not a cosmetic folder shuffle. The goal is to make ownership obvious while preserving
the current tested runtime and keeping one small move per commit.

## Proposed Shape

```text
apps/cli/src/app-shell/
  root/
    root-overlay-shell.tsx
    root-shell-state.ts
    root-history-bridge.ts
  surfaces/
    browse/
      browse-shell.view.tsx
      browse-shell.model.ts
      browse-shell.input.ts
      browse-preview-rail.model.ts
    history/
      history-shell.view.tsx
      history-view.model.ts
      history-workflows.ts
    calendar/
      calendar-ui.view.tsx
      calendar-ui.model.ts
      calendar-results.ts
    playback/
      post-play-shell.view.tsx
      playback-shell-input.ts
      tracks-panel-shell.view.tsx
    settings/
      overlay-panel.view.tsx
      settings-options.model.ts
  primitives/
    ...
  layout/
    layout-policy.ts
    shell-text.ts
    shell-theme.ts
  input/
    command-router.ts
    command-registry.ts
    keybindings.ts
```

Names can shift during implementation, but each destination should follow the same rule:
surface-specific view code lives with its surface, pure model code gets a `.model.ts` suffix, and
shared primitives/policy stay outside surfaces.

## Incremental Order

1. Move pure layout/text/theme helpers under `app-shell/layout/`, update imports, run the CLI gates.
2. Move command and keybinding files under `app-shell/input/`, keeping command tests green.
3. Move History first because it already has a clean split: `history-shell.tsx`,
   `history-view.ts`, and `history-workflows.ts`.
4. Move Calendar next because `calendar-ui.tsx` and `calendar-ui.model.ts` are already paired.
5. Move Browse only after History/Calendar settle; it has the broadest import surface.
6. Move playback/post-playback surfaces last.

Each step should be one commit and should stage only files moved or import-updated by that step.

## Guardrails

- Do not move `apps/cli/src/main.ts` or revive orchestration in `apps/cli/index.ts`.
- Keep `apps/cli/test/unit/architecture/boundary-imports.test.ts` green after every move.
- Prefer `@/...` imports for cross-surface dependencies during the transition.
- Do not change runtime behavior while moving files unless a failing import exposes an existing bug.
- Keep user-facing copy and UI layout changes out of mechanical move commits.

## Approval Needed

This design should be approved before any folder moves. The first implementation slice should be the
lowest-risk layout/input move, not a broad app-shell rewrite.
