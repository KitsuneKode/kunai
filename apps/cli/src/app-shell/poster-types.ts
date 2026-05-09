export type PosterResult =
  | { kind: "kitty"; placeholder: string; rows: number; cols: number; imageId: number }
  | { kind: "text"; placeholder: string; rows: number; cols: number }
  | { kind: "none" };

export type PosterState = "idle" | "loading" | "ready" | "unavailable";
