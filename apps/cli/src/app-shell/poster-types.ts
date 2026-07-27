export type PosterResult =
  | { kind: "kitty"; placeholder: string; rows: number; cols: number; imageId: number }
  | { kind: "sixel"; sixel: string; rows: number; cols: number; overlayId: string }
  | { kind: "text"; placeholder: string; rows: number; cols: number }
  | { kind: "none" };

export type PosterState = "idle" | "loading" | "ready" | "unavailable";
