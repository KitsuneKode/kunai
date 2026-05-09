export type ImageProtocol = "kitty" | "sixel" | "symbols" | "none";

export type ImageRendererId = "kitty-native" | "chafa-sixel" | "chafa-symbols" | "none";

export type TerminalId =
  | "kitty"
  | "ghostty"
  | "windows-terminal"
  | "wezterm"
  | "vscode"
  | "unknown";

export interface ImageCapability {
  readonly terminal: TerminalId;
  readonly protocol: ImageProtocol;
  readonly renderer: ImageRendererId;
  readonly available: boolean;
  readonly dependency: "chafa" | "none";
  readonly reason: string;
}

export interface ImageRenderOptions {
  readonly size: string;
  readonly maxRows: number;
  readonly debug: boolean;
}
