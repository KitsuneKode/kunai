# Implementation Split

Use this file to parallelize work without overlapping ownership.

## Shared First

Before screen-specific implementation, create or refine shared primitives:

- `ShellFrame`
- `ModeChip`
- `Footer`
- `MediaHeader`
- `ActionList`
- `ActionRow`
- `PreviewRail`
- `PickerSurface`
- `CapabilityRows`
- `MediaList`
- `DetailsSheet`

Shared primitives must encode the contracts in:

- `00-principles.md`
- `01-shell-footer-contract.md`
- `02-state-ux.md`
- `03-component-boundaries.md`

Recommended shared work before parallel screen edits:

- footer action model and collapse behavior
- preview rail stable poster slot
- state block contract for loading/empty/error/success
- media list row view model
- search reducer/view model shape
- tracks capability normalization view model
- calendar day/time grouping view model
- stats/history/library view models

## Agent A

Owns playback family:

- Post-playback
- Active playback
- Command palette scope for PPS/playback
- Playback issue state
- Footer behavior for playback surfaces

Primary specs:

- `surfaces/post-playback.md`
- `surfaces/active-playback.md`
- `surfaces/command-palette.md`
- `02-state-ux.md`
- `03-component-boundaries.md`

Likely files:

- `apps/cli/src/app-shell/post-play-shell.tsx`
- `apps/cli/src/app-shell/loading-shell.tsx`
- `apps/cli/src/app-shell/ink-shell.tsx`
- `apps/cli/src/domain/session/command-registry.ts`
- shared shell primitives as needed

## Agent B

Owns picker/discovery family:

- Tracks panel
- Episode/season picker
- Recommendations viewer
- Search/results/details
- Calendar
- Stats/history/library visual contract, if not split to a third agent

Primary specs:

- `surfaces/tracks-panel.md`
- `surfaces/episode-season-picker.md`
- `surfaces/recommendations-viewer.md`
- `surfaces/search-details-calendar.md`
- `surfaces/stats-history-library.md`
- `02-state-ux.md`
- `03-component-boundaries.md`

Likely files:

- `apps/cli/src/app-shell/root-overlay-shell.tsx`
- `apps/cli/src/app-shell/root-overlay-model.ts`
- `apps/cli/src/app-shell/workflows.ts`
- `apps/cli/src/app-shell/picker-overlay.tsx`
- `apps/cli/src/app-shell/pickers/*`
- shared shell primitives as needed

## Coordination Rules

- Shared primitives need a small API agreement before both agents edit them.
- Do not create separate footer/list/picker models per surface.
- Do not duplicate preview rail logic.
- Use source code as truth when current docs disagree.
- Update `.design/cli` when implementation intentionally changes the contract.
- If two agents are active, keep stats/history/library lower priority than playback and browse unless the shared primitive work already touches them.

## Acceptance Checks

Each implemented surface must pass:

- Header follows shell contract.
- Footer has at most four primary actions plus commands.
- Screen has loading/success/empty/error states.
- Preview rail hides before critical text.
- Preview rail reserves poster space and does not jump when images load.
- No dead picker opens for one-option capability sections.
- Command palette stays scoped.
- Source/provider internals are hidden unless useful.
- Search query and result filter state are separate.
- Calendar uses vertical time grouping and type/day navigation.
- Stats are motivational/product-facing, not diagnostics.
- History is resume-first and deletion is never the primary action.
- Library/downloads separate ready offline items from queue/failure management.
- Reducers/view model builders have targeted tests when state transitions are nontrivial.

## Suggested Verification

Use deterministic checks first:

```sh
bun run typecheck
bun run lint
bun run fmt
```

Use targeted tests if changing reducers/view models.

For visual-heavy changes, capture before/after screenshots or VHS tapes where available.
