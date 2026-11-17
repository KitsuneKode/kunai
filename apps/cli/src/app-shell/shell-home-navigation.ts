import type { RootContentKind } from "./root-content-state";

export const PLAYBACK_HOME_POINTER_CONFIRM = "Click again or press ⌃G to stop and go home";

/** Stable key for the header fox two-click arm during playback. */
export const HOME_POINTER_ARM_KEY = "header:home";

export type ShellHomeNavigation =
  | { readonly kind: "stop-playback-search" }
  | { readonly kind: "close-post-playback" }
  | { readonly kind: "close-picker" }
  | { readonly kind: "toggle-browse-return" }
  | { readonly kind: "leave-for-browse" };

export function resolveShellHomeNavigation(input: {
  readonly rootKind: RootContentKind | null;
  readonly overlayCount: number;
  readonly browseAtHome: boolean;
}): ShellHomeNavigation {
  const { rootKind, overlayCount, browseAtHome } = input;
  if (rootKind === "playback" || rootKind === "loading") {
    return { kind: "stop-playback-search" };
  }
  if (rootKind === "post-playback") {
    return { kind: "close-post-playback" };
  }
  if (rootKind === "picker") {
    return { kind: "close-picker" };
  }
  if (overlayCount === 0 && browseAtHome) {
    return { kind: "toggle-browse-return" };
  }
  return { kind: "leave-for-browse" };
}
