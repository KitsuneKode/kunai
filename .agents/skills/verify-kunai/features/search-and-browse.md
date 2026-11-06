# Search and browse

Users search for titles, move through results, and navigate home/footer shortcuts without silent no-ops or wrong catalog lanes.

## Sub-features

- `search-submit` runs the active query and shows fixture or live results.
- `result-select` highlights a stable identity before activation.
- `footer-nav` exposes commands, search, and mode shortcuts from the browse chrome.
- `artwork-preview` shows poster/art for the selected row when available.

## How to get to it (user POV)

- Launch Kunai to the browse shell (`Search title` in the header).
- Type a query and press Enter.
- Use footer hints such as `[/]` for the command palette or listed navigation keys.

## Driving it with verify-kunai

Preconditions:

- L2: `bun run agent:drive` with fixture `smoke` provider (default).
- Kitty: graphical desktop, `bun run agent:verify -- doctor`, then fixture `--evidence`.

- **Smoke search (L2).** Run the quickstart in `SKILL.md` (`smoke` → Enter → wait `Smoke` → Enter → post-play). Frame must quote a smoke title; history row must appear in `--show history`.
- **Interactive chrome (Kitty).** `bun run agent:verify -- kitty-fixture --evidence /tmp/kunai-interactive-NEW` uses `scenario-interactive.json` (palette, settings hop, return home). Inspect PNGs under `scenario/`; do not approve from `.txt` alone.
- **Reverse: empty query.** Search `noresultsfixture` on L2; frame shows no spurious playable row; backend queue/history unchanged.

## Gotchas

- Fixture `smoke` matches only smoke catalog strings; other queries correctly return empty on fixtures.
- Fast typing across a surface change can drop keys — reproduce separately; a slow retry is not a product fix.
- Anime vs TMDB lanes use different identity shapes; do not claim parity without checking both.
