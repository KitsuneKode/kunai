import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

/** Geist Sans for UI + display; variable maps to --font-geist-sans */
export const fontSans = GeistSans;

/** Geist Mono for code / ASCII / terminal surfaces */
export const fontMono = GeistMono;

/**
 * Serif alias points at sans so leftover `font-serif` / `--font-serif`
 * classes stay on Geist instead of Georgia.
 */
export const fontClassNames = [
  fontSans.variable,
  fontMono.variable,
  // Remap legacy CSS vars used across the docs app
].join(" ");

export function fontStyleVars(): Record<string, string> {
  return {
    ["--font-sans" as string]: "var(--font-geist-sans)",
    ["--font-serif" as string]: "var(--font-geist-sans)",
    ["--font-mono" as string]: "var(--font-geist-mono)",
  };
}
