export interface NavInteraction {
  readonly scrolled: boolean;
  readonly hovered: boolean;
  readonly focused: boolean;
}

export type NavInteractionEvent =
  | { readonly type: "scroll-position"; readonly scrolled: boolean }
  | { readonly type: "hover"; readonly hovered: boolean }
  | { readonly type: "focus"; readonly focused: boolean }
  | { readonly type: "scroll" };

export const INITIAL_NAV_INTERACTION: NavInteraction = {
  scrolled: false,
  hovered: false,
  focused: false,
};

/** Scroll dismisses pointer expansion, but must never hide a focused link. */
export function reduceNavInteraction(
  state: NavInteraction,
  event: NavInteractionEvent,
): NavInteraction {
  switch (event.type) {
    case "scroll-position":
      return { ...state, scrolled: event.scrolled };
    case "hover":
      return { ...state, hovered: event.hovered };
    case "focus":
      return { ...state, focused: event.focused };
    case "scroll":
      return { ...state, hovered: false };
  }
}

export function isNavCompact(state: NavInteraction): boolean {
  return state.scrolled && !state.hovered && !state.focused;
}
