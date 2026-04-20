# KitsuneSnipe — Terminal Design System

Use this doc when changing terminal styling, ANSI helpers, or interaction presentation. It should stay lightweight: enough to preserve coherence, not so strict that it limits better UI ideas.

## Source of Truth

- `src/design.ts` owns shared visual primitives
- `src/menu.ts` owns ANSI helpers tied to interactive flows

## Design Goals

- Keep the CLI readable in low-noise terminals
- Make interactive keys obvious at a glance
- Preserve a consistent fox-amber visual identity
- Avoid brittle cursor choreography unless it clearly earns its complexity

## Core Tokens

```ts
clr.amber;
clr.cyan;
clr.green;
clr.red;
clr.dim;
clr.bold;
clr.reset;
```

- `amber`: primary brand color
- `cyan`: key prompts and interactive hints
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

## Migration Note

If the repo moves to Ink later, keep the semantic layer intact:

- color/token naming should carry forward
- spacing and box conventions should remain recognizable
- terminal behavior should still optimize for fast scanning and low breakage

See [.plans/ink-migration.md](../.plans/ink-migration.md) for the larger UI migration track.
