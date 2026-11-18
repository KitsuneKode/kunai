# Settings

Settings edits the user's preferences; each change is written to `config.json`
after a short debounce and survives relaunch.

## Sub-features

- `settings-open` open from the palette.
- `settings-toggle` change a choice row.
- `settings-persist` the committed `config.json` agrees with the frame.

## How to get to it (user POV)

- Command palette (`/`) → `settings` → Enter.

## Driving it with agent:drive

- **Footer hints to minimal.**
  `bun run agent:drive -- --show config --verify-citation '"footerHints": "minimal"' --keys "/" "<wait:command>" settings "<enter>" "<wait:Usage analytics>" "<down>" "<enter>" "<wait:Minimal>" "<down>" "<enter>" "<wait-config:footerHints=minimal>"`.
  `config.json` shows `"footerHints": "minimal"` (citation verified).

## Gotchas

- The frame changes about 300 ms before `config.json` does. Wait with
  `<wait-config:…>` before calling a change persisted or a no-op.
- The first row is `Usage analytics`. A plan that presses Enter on it enables
  analytics, and the driver fails the run on the minted `installId`. That is
  the intended outcome; never "fix" a plan by allowing it.
- #699 regroups Settings into five sections; if it lands, the row order in this
  plan changes.
