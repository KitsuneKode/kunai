# KitsuneSnipe — Terminal Design System

Use this doc when changing terminal styling, ANSI helpers, or interaction presentation. It should stay lightweight: enough to preserve coherence, not so strict that it limits better UI ideas.

## Source of Truth

- `packages/design/src/tokens.ts` owns shared token values
- `apps/cli/src/app-shell/shell-theme.ts` adapts tokens for Ink shell surfaces
- `apps/cli/src/design.ts` owns CLI-facing visual helpers such as badges, truncation, and ANSI-adjacent primitives
- `apps/cli/src/menu.ts` owns legacy ANSI helpers tied to interactive flows

## Design Goals

- Keep the CLI readable in low-noise terminals
- Make interactive keys obvious at a glance
- Preserve a consistent fox-amber visual identity
- Avoid brittle cursor choreography unless it clearly earns its complexity

## Core Tokens

```ts
tokens.amber;
tokens.pink;
tokens.teal;
tokens.green;
tokens.red;

clr.amber;
clr.cyan;
clr.green;
clr.red;
clr.dim;
clr.bold;
clr.reset;
```

- `amber`: primary brand/action color and key prompts
- `pink`: anime and discovery accent
- `teal`: status, cursor, and informational accent
- `dim`: secondary information
- `green` / `red`: success and failure states

## Layout Primitives

```ts
box.tl  box.tr
box.bl  box.br
box.h
box.v

sep(width?)
headerLine(title, sub?)
shortcuts(pairs)
progressBar(current, total, width?)
statusLine(items)
startSpinner(label)
```

These functions are meant to stay composable. Screen-specific policy should usually live in the caller, but the real test is whether the result stays easy to reuse and reason about.

## Interaction Conventions

- Key labels should stay visually distinct from descriptive text
- Status lines should summarize available actions, not explain the whole screen
- Spinners should be used for genuinely pending async work, not as decoration
- Raw cursor control should be minimal and always cleaned up on exit

## Shell UX Standard

Kunai should feel like a calm, fast media command shell: content-first in normal use, diagnostic-rich only when the user asks for it.

- Put the title or active task in the strongest visual position
- Use one compact context strip per screen for stable state such as provider, mode, episode, subtitle, filters, and active overlay
- Do not repeat the same state in header, badge rows, detail lines, and footer
- Use badges only for active filters, warnings/errors, selected/highlighted state, and actionable exceptional state
- Do not badge internal rendering state such as poster loading, poster ready, or selection preview
- Keep missing provider data honest but quiet; use dim placeholders unless the missing data blocks the task
- Keep diagnostics available through diagnostics/help surfaces, not centered in normal browse or playback
- Let the footer teach live actions; do not duplicate footer instructions inside companion/detail panels
- Prefer 3-4 footer shortcuts plus `/ commands` over long shortcut sentences
- Use `amber` for primary action and active selection, `teal` for informational status, `green` only for meaningful success, and `red` only for real failure

## Migration Note

The active CLI shell is Ink-based. If future web or desktop surfaces consume the same visual identity, keep the semantic layer intact:

- color/token naming should carry forward
- spacing and box conventions should remain recognizable
- terminal behavior should still optimize for fast scanning and low breakage
- do not duplicate raw hex values outside `packages/design` unless the value is a deliberate one-off media/runtime constraint

See [.plans/ink-migration.md](../.plans/ink-migration.md) for the larger UI migration track.
