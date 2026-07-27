export type PosterResult =
  | { kind: "kitty"; placeholder: string; rows: number; cols: number; imageId: number }
  | { kind: "sixel"; sixel: string; rows: number; cols: number; overlayId: string }
  | { kind: "text"; placeholder: string; rows: number; cols: number }
  | { kind: "none" };

export type PosterState = "idle" | "loading" | "ready" | "unavailable";

/**
 * These poster kinds are part of Ink's framebuffer collision surface while a
 * selection is moving. Text is expensive for Ink to rewrite, while sixel must
 * be explicitly removed by the overlay manager. Kitty has its own placement
 * lifecycle and can safely remain until the settled selection replaces it.
 */
export function suppressPosterWhileNavigating(poster: PosterResult): boolean {
  return poster.kind === "text" || poster.kind === "sixel";
}
