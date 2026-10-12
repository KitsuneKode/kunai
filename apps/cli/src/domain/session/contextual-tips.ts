// =============================================================================
// Contextual tips — once-ever shortcut coaching
//
// A tip teaches the fast path only after the user just took the slow one:
// they picked a command out of the `/` palette that a plain keypress would have
// reached directly. Each tip is once-ever — the seen set lives in config.json
// (`seenTips`) and an id only ever renders once, restart or not.
//
// This module is the data half only. It knows trigger (palette command +
// surface) and which keybinding id carries the shortcut; app-shell owns
// rendering (binding → key glyph → line copy) and persistence.
// =============================================================================

import type { AppCommandId } from "./command-registry";

/**
 * The surface a palette was opened on. Deliberately NOT `CommandContextId`:
 * the browse list's palette (`SEARCH_BROWSE_COMMAND_IDS`) is its own list with
 * no registry context, and a tip is honest only when both halves hold on the
 * same surface — the command must be pickable there AND the taught key must
 * be live there. Naming the registry's `rootOverlay` for the browse surface
 * would silently arm tips for keys the overlay does not bind.
 *
 * `rootOverlay` is also absent from the union on purpose: a root-owned
 * overlay is definitionally "an overlay owns focus", so the suppression gate
 * would kill every tip declared for it. Callers there simply do not wire
 * `onPaletteCommand`.
 */
export type ContextualTipSurface = "browse" | "activePlayback" | "postPlayback";

export type ContextualTip = {
  /** Stable id persisted in `seenTips` — renaming re-teaches the tip once. */
  readonly id: string;
  /** The palette command whose selection is the "did it the long way" proof. */
  readonly commandId: AppCommandId;
  /**
   * Surfaces where both halves of the lesson hold: the command is in that
   * surface's palette and the taught key is bound there. A shortcut that does
   * not exist on the surface the user is on is a lie, not a tip, so a
   * selection made elsewhere arms nothing.
   */
  readonly surfaces: readonly ContextualTipSurface[];
  /**
   * The keybinding registry entry whose chord is the shortcut. Resolved in
   * app-shell so copy can never drift from the real key. Omit when the
   * "shortcut" is not a key at all (e.g. search: just type).
   */
  readonly bindingId?: string;
  /**
   * The verb half of the line, e.g. "opens up next" → `tip: ⇧Q opens up next`.
   * For bindingless tips this is the whole advice: "just type a title to
   * search" → `tip: just type a title to search`.
   */
  readonly teach: string;
};

// Every entry was audited against two sources: the palette list for the
// surface (`SEARCH_BROWSE_COMMAND_IDS`, `COMMAND_CONTEXTS`) and the keybinding
// scope that owns the taught key. Two near-misses are deliberately absent:
// `/playlist-add` has no tip because `q` only works on the browse list, where
// the palette does not offer the command; and `/details` has no tip because
// its key is focus-split (`i` under list focus, ⌃O under search focus), so a
// one-line teach would be wrong half the time.
export const CONTEXTUAL_TIPS: readonly ContextualTip[] = [
  {
    id: "tip-up-next-key",
    commandId: "up-next",
    surfaces: ["browse"],
    bindingId: "queue-open",
    teach: "opens up next",
  },
  {
    id: "tip-inbox-key",
    commandId: "notifications",
    surfaces: ["browse"],
    bindingId: "browse-notifications",
    teach: "opens the inbox",
  },
  {
    id: "tip-mode-tab",
    commandId: "toggle-mode",
    surfaces: ["browse"],
    bindingId: "browse-mode",
    teach: "cycles catalog mode",
  },
  {
    id: "tip-search-post-key",
    commandId: "search",
    surfaces: ["postPlayback"],
    bindingId: "post-search",
    teach: "searches from here",
  },
  {
    id: "tip-history-post-key",
    commandId: "history",
    surfaces: ["postPlayback"],
    bindingId: "post-history",
    teach: "opens history",
  },
  // `n` lives behind different binding ids on the two surfaces (player-next vs
  // post-continue), so the lesson is keyed per surface rather than pretending
  // one binding covers both.
  {
    id: "tip-next-key",
    commandId: "next",
    surfaces: ["activePlayback"],
    bindingId: "player-next",
    teach: "goes to the next episode",
  },
  {
    id: "tip-post-continue-key",
    commandId: "next",
    surfaces: ["postPlayback"],
    bindingId: "post-continue",
    teach: "continues to the next episode",
  },
  {
    id: "tip-help-key",
    commandId: "help",
    // `?` is a genuinely global key, but a tip never fires while an overlay
    // owns focus — so the only surfaces it can teach on are the three
    // overlay-free ones.
    surfaces: ["browse", "activePlayback", "postPlayback"],
    bindingId: "help",
    teach: "opens help",
  },
];

export function contextualTipById(id: string): ContextualTip | undefined {
  return CONTEXTUAL_TIPS.find((tip) => tip.id === id);
}

/**
 * The tip a palette selection teaches on this surface, or null when the
 * command has no shortcut lesson here.
 */
export function contextualTipForCommand(
  commandId: AppCommandId,
  surface: ContextualTipSurface,
): ContextualTip | null {
  const tip = CONTEXTUAL_TIPS.find(
    (candidate) => candidate.commandId === commandId && candidate.surfaces.includes(surface),
  );
  return tip ?? null;
}

/**
 * Whether an already-resolved tip may arm right now. Presentation concerns
 * only — the caller supplies the three facts that gate it:
 *
 * - `tipsEnabled` — the settings opt-out; off means never.
 * - `seenTips` — once-ever: an id already in the set never arms again.
 * - `overlayOpen` — a modal or picker owns focus; a tip must not fire under it.
 */
export function contextualTipEligible(
  tip: ContextualTip,
  input: {
    readonly tipsEnabled: boolean;
    readonly seenTips: readonly string[];
    readonly overlayOpen: boolean;
  },
): boolean {
  if (!input.tipsEnabled) return false;
  if (input.overlayOpen) return false;
  return !input.seenTips.includes(tip.id);
}
