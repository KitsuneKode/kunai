# Kunai CLI Design Principles

Source code is the implementation truth. These specs are the design contract for the next CLI UI pass and should be updated when the shipped UI changes.

## Product Feel

Kunai should feel like a premium media command shell: fast, calm, keyboard-native, and rich only where richness helps a decision.

The user-facing audience is closer to a streaming product than a developer tool. The interface should help people search, choose, play, recover, and continue watching with low cognitive load.

## Core Rule

Every screen has one primary job. Everything visible must support that job.

If information is useful but not needed now, move it to one of:

- selected preview rail
- details sheet
- command palette
- diagnostics
- scrollable secondary region

Do not make normal screens feel like logs, dashboards, or provider inspectors.

## Information Hierarchy

- Header: identity, mode, compact context, readiness/error state.
- Body: the actual decision or current state.
- Preview rail: confidence about the selected item.
- Footer: repeated actions only.
- Command palette: less frequent or scoped commands.
- Diagnostics: evidence, internals, and failure investigation.

## Screen Budget

- One major mode chip per screen.
- Four visible footer actions plus `[/] commands` is the comfort ceiling.
- Prefer one selected row and one selected preview over many equal-weight regions.
- Use posters/thumbnails for orientation, not decoration.
- Hide images before hiding critical text.

## Anti-Overload Rules

- Do not repeat the same fact in header, body, preview, and footer.
- Do not show provider internals unless they affect a user decision or diagnosis.
- Do not turn every metadata value into a badge.
- Do not use fake cards or component-note cards as product UI.
- Do not add full boxes around every group. Use spacing, alignment, muted bands, and line rhythm first.
- Do not let a modal become a portal to the whole app.

## Color Semantics

The palette should stay restrained. Color communicates state and action, not decoration.

- Amber/gold: primary action, focus, active tab, selected row marker.
- Teal: information, cursor, neutral active process.
- Green: meaningful success, playable/ready/available.
- Amber warning: expected today, paused, recoverable caution.
- Blue/info: upcoming soon or informational state.
- Red: real failure, missed/error state when actionable.
- Dim: unavailable, later, low confidence, secondary metadata.

## Glyph Rules

Use glyphs when they improve scan speed or state recognition. Do not use glyphs just to make the UI look designed.

Good candidates:

- `[▶ n]` next/play
- `[◀ p]` previous
- `[↻ r]` replay
- `[☰ e]` episodes
- `[≋ t]` tracks
- `[⌕ s]` search
- `[/]` commands

State glyphs belong in body/status facts:

- `● ready`
- `✓ complete`
- `△ warning`
- `× failed`

Text labels must carry meaning even if glyphs render poorly.

## Terminal Constraints

Kunai should look good in a normal monospace terminal. Recommended fonts may improve screenshots, but the CLI must not depend on one.

Design for:

- Kitty, Ghostty, Alacritty, WezTerm, tmux, SSH.
- Terminals without image support.
- Narrow and medium terminal sizes.
- Stable dimensions to avoid flicker.

## State Contract

Every major surface needs designed states:

- loading
- success
- empty
- error

Loading should be subtle and non-blocking. Error states should be actionable. Empty states should suggest the next best action without becoming tutorial copy.
