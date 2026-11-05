# Command palette and settings

Users open the palette from footer or `/`, run commands, and change settings with visible toggles that commit to `config.json` after debounced writes.

## Sub-features

- `palette-open` shows actionable commands with filter input.
- `settings-nav` reaches the settings surface from palette or browse.
- `toggle-persist` changes a setting and survives relaunch when intended.
- `analytics-decline` keeps consent off on seeded profiles.

## How to get to it (user POV)

- From browse, press `/` or click `[/] commands` when visible.
- Type `settings` and activate the settings row.
- Move with arrow keys; Enter toggles or opens rows as advertised.

## Driving it with verify-kunai

Preconditions:

- L2 replay or L3 tmux with onboarded seed; file credential backend.

- **Footer hints toggle (L2).** Use the settings recipe in `SKILL.md` with `<wait-config:footerHints=minimal>` after the frame shows Minimal — frame alone is insufficient.
- **Palette dismiss (Kitty).** `scenario-interactive.json` opens palette via click, captures `palette-open`, Esc returns to browse; witness `Search title` in the final frame.
- **Reverse: Esc abort.** From palette without submitting, backend config unchanged (`--show config` or inspector tables).

## Gotchas

- Debounced config writes lag the frame ~300 ms — always wait on `<wait-config:…>` or re-read config after `wait-for`.
- Enabling analytics in a drive triggers dispose failure by design — that is a pass for the privacy contract.
