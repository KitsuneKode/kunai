# Stream faceted filters

On the stream picker, users filter candidates by quality, source, language, and related facets using pill triggers and a modal with live counts.

## Sub-features

- `facet-open` opens the modal from a category pill.
- `facet-toggle` selects options and updates filtered stream list counts.
- `facet-clear` removes one facet or clears all active filters.
- `compound-genre` removes one member of a compound chip without dropping others.

## How to get to it (user POV)

- Resolve a title to the stream/source picker (fixture smoke or live resolve).
- Activate filter pills advertised on the picker surface; apply or clear from the modal.

## Driving it with verify-kunai

Preconditions:

- L1: `apps/cli/test/unit/app-shell/primitives/faceted-filter.test.tsx` for model and Ink components.
- L2/KITTY: requires a drive that reaches the stream picker with multiple candidates (fixture or live).

- **Model correctness (L1).** `bun test apps/cli/test/unit/app-shell/primitives/faceted-filter.test.tsx` — toggle semantics, live counts, pill badges.
- **UI transition (L2, when on picker).** Extend a replay key plan: open filters, toggle one facet, witness filtered row count in frame **and** unchanged resolve identity in backend history when no play started.
- **Reverse: clear all.** After applying facets, clear and confirm full candidate list returns in frame text.

## Gotchas

- Unit tests prove model/components, not that production resolve always reaches the picker — name the tier.
- Facet state is in-memory until play/commit; do not equate pill UI with persisted config unless a setting explicitly writes config.
