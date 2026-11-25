import type { KeyBinding } from "./keybindings";

/**
 * Keys only the mpv window has: it can cycle the source or audio in place and
 * share the current moment. Listed in `?` help (help-only: the terminal has no
 * equivalent surface) so the in-player key map is complete in one place.
 */
export const MPV_WINDOW_KEYBINDINGS: readonly KeyBinding[] = [
  {
    id: "player-cycle-source",
    chord: { input: "c" },
    display: "c / C",
    label: "Cycle to the next source (mpv window)",
  },
  {
    id: "player-cycle-audio",
    chord: { input: "A", shift: true },
    display: "⇧A",
    label: "Cycle audio or sub/dub (mpv window)",
  },
  {
    id: "player-share-moment",
    chord: { input: "s", ctrl: true, shift: true },
    display: "Ctrl+⇧S",
    label: "Copy a share link at this moment (mpv window)",
  },
].map((binding) => ({ ...binding, scope: "player", group: "In the player", helpOnly: true }));
