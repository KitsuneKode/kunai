import type { ShellStatus } from "./types";

export const palette = {
  bg: "#17130f",
  surface: "#211a14",
  surfaceElevated: "#2b2219",
  amber: "#f6a23a",
  cyan: "#67d8d4",
  green: "#8fd36a",
  rose: "#d9a06f",
  red: "#ff6b5f",
  gray: "#8f8173",
  muted: "#b6a696",
  text: "#f4eadf",
  dim: "#8f8173",
} as const;

export const APP_LABEL = "🥷 Kunai beta";

export function statusColor(tone: ShellStatus["tone"] = "neutral"): string {
  switch (tone) {
    case "success":
      return palette.green;
    case "warning":
      return palette.amber;
    case "error":
      return palette.red;
    default:
      return palette.cyan;
  }
}

export function hotkeyLabel(key: string): string {
  return `[${key}]`;
}
