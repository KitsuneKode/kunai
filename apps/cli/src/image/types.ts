export type ImageProtocol = "kitty" | "iterm-inline" | "sixel" | "symbols" | "half-block" | "none";

export type ImageRendererId =
  | "kitty-native"
  | "iterm-inline"
  | "sixel"
  | "chafa-symbols"
  | "half-block"
  | "none";

export type TerminalId =
  | "kitty"
  | "ghostty"
  | "iterm2"
  | "windows-terminal"
  | "wezterm"
  | "konsole"
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
