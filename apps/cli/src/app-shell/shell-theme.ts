import type { ShellStatus } from "./types";

export const palette = {
  amber: "#f2c066",
  cyan: "#7dd3fc",
  green: "#8dd58a",
  rose: "#f3a6c8",
  red: "#ff7a7a",
  gray: "#7f8696",
  muted: "#a4a9b6",
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
