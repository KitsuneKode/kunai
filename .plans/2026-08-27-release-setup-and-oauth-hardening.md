# Release setup and OAuth hardening

**Status:** IN PROGRESS

**Goal:** Make the first-run wizard truthful and recoverable before 0.3.0: each
media lane keeps its own language profile, recommendations are visible and
safe, and account linking has visible progress, cancellation, retry, and no
fire-and-forget work.

## Contract

- Hydrate and persist separate Shows, Movies, Anime, and YouTube audio/subtitle
  profiles. Rerunning setup must not flatten existing per-lane choices.
- On the language screen, `1`-`4` switch the active media lane, `Tab` switches
  audio/subtitles, arrows choose, and `Enter` advances. The selected lane and
  values remain visible.
- Show both `s` (recommend this screen) and `S` (safe remaining defaults).
  Neither shortcut may enable analytics, accounts, downloads, or presence.
- Keep playback recommendations explicit: auto-next, intro skip, and credits
  skip default on, remain independently toggleable, and appear in the done
  summary.
- Account linking stays in an owned UI state until it succeeds, fails, or the
  user cancels with `Esc`/`q`. A cancelled or failed attempt leaves sync
  disabled and offers a retry path.
- Preserve the explicit analytics-keystroke contract and all existing setup
  abort/restore-point behavior.

## Implementation sequence

1. Add state/write-map regressions for independent language profiles, safe
   recommendations, and the done summary.
2. Replace the single language pair in setup state with a four-lane profile
   model; update hydration, reducers/input handling, rendering, and persistence.
3. Add a cancellable tracker-connect workflow result and an owned setup linking
   surface; cover success, failure, cancellation, and already-connected paths.
4. Update `.docs/download-offline-onboarding.md`, `.docs/tracker-sync.md`, and
   setup captures/keybinding tests to match the shipped interaction.
5. Run targeted tests, setup captures, forced typecheck/lint, formatting, docs
   path verification, full tests, build, and an isolated real-terminal setup
   walkthrough.

## Release gate

The PR is mergeable only when declaration-reader seams are explicit: each
profile field has a playback reader, account enablement follows a successful
token connection, every opt-in has a visible off/cancel state, and Linux,
macOS, and Windows CI are green. Analytics remains off unless its dedicated
consent screen receives the explicit enable keystroke.
