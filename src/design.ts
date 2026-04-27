// =============================================================================
// Kunai — Terminal Design System
//
// Aesthetic: refined utilitarian with a stealthy, sharp edge.
// Kunai-red primary accent, clean box drawing, dense-but-clear layout.
// Everything visible at once — no hidden menus, no modal blocking.
// =============================================================================

// ── ANSI escape primitives ────────────────────────────────────────────────────

const ESC = "\x1b[";

// Colors
export const clr = {
  // Kunai red — brand primary
  fox: (s: string) => `\x1b[38;5;196m${s}\x1b[0m`,
  // Accents
  cyan: (s: string) => `${ESC}36m${s}${ESC}0m`,
  green: (s: string) => `${ESC}32m${s}${ESC}0m`,
  yellow: (s: string) => `${ESC}33m${s}${ESC}0m`,
  red: (s: string) => `${ESC}31m${s}${ESC}0m`,
  blue: (s: string) => `${ESC}34m${s}${ESC}0m`,
  // Neutrals
  bold: (s: string) => `${ESC}1m${s}${ESC}0m`,
  dim: (s: string) => `${ESC}2m${s}${ESC}0m`,
  italic: (s: string) => `${ESC}3m${s}${ESC}0m`,
  // Inverted (for active selection)
  inv: (s: string) => `${ESC}7m${s}${ESC}0m`,
  reset: "\x1b[0m",
};

// Cursor / screen control
export const cursor = {
  hide: "\x1b[?25l",
  show: "\x1b[?25h",
  clearLine: "\r\x1b[K",
  up: (n: number) => `\x1b[${n}A`,
  col: (n: number) => `\x1b[${n}G`,
};

export const screen = {
  clear: "\x1b[2J\x1b[H",
  clearDown: "\x1b[J",
};

// ── Box drawing ───────────────────────────────────────────────────────────────
//
// Clean, sharp corners for a mechanical feel.

export const box = {
  tl: "┌",
  tr: "┐",
  bl: "└",
  br: "┘",
  h: "─",
  v: "│",
  ml: "├",
  mr: "┤",
  mt: "┬",
  mb: "┴",
};

// Draw a full-width horizontal separator (auto-detects terminal width)
export function sep(char = box.h, tint?: (s: string) => string): string {
  const width = Math.min(process.stdout.columns ?? 80, 80);
  const line = char.repeat(width);
  return tint ? tint(line) : clr.dim(line);
}

// Draw a labelled header box line: ┌── Title ──┐
export function headerLine(label: string): string {
  const width = Math.min(process.stdout.columns ?? 80, 80);
  const inner = width - 4; // room for ┌─ and ─┐
  const padded = ` ${label} `;
  const left = Math.floor((inner - padded.length) / 2);
  const right = inner - padded.length - left;
  const line = `${box.tl}${box.h.repeat(left)}${padded}${box.h.repeat(right)}${box.tr}`;
  return clr.dim(line);
}

// ── Status icons ──────────────────────────────────────────────────────────────

export const icon = {
  fox: "🥷", // Renamed 'fox' to Ninja/Kunai emoji
  movie: "🎬",
  series: "📺",
  anime: "🗡️", // Changed anime to dagger/sword to fit the ninja theme
  play: "▶",
  next: "⏭",
  prev: "⏮",
  loading: "⟳",
  ok: "✓",
  warn: "⚠",
  err: "✗",
  settings: "⚙",
  search: "⌕",
  pin: "◆",
};

// ── Keyboard shortcut renderer ─────────────────────────────────────────────────
//
// Renders a shortcut list as: [n] next  [p] prev  [c] settings
// Keys are Kunai red, labels are dim.

export function shortcuts(map: Array<[key: string, label: string]>, separator = "  "): string {
  return map.map(([k, label]) => `${clr.fox(`[${k}]`)} ${clr.dim(label)}`).join(separator);
}

// ── Progress bar ──────────────────────────────────────────────────────────────

export function progressBar(watched: number, total: number, width = 20): string {
  if (!total) return clr.dim("─".repeat(width));
  const pct = Math.min(1, watched / total);
  const filled = Math.round(pct * width);
  const bar = "█".repeat(filled) + clr.dim("░".repeat(width - filled));
  return `${bar} ${clr.dim(Math.round(pct * 100) + "%")}`;
}

// ── Spinner frames ────────────────────────────────────────────────────────────

// A sharp, aggressive spinner suitable for Kunai
export const SPINNER_FRAMES = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];

// Lightweight inline spinner — returns a cleanup function.
export function startSpinner(msg: string): () => void {
  let i = 0;
  process.stdout.write(cursor.hide);
  const id = setInterval(() => {
    const frame = SPINNER_FRAMES[i++ % SPINNER_FRAMES.length] ?? "⣾";
    process.stdout.write(`\r${clr.fox(frame)} ${msg}${" ".repeat(10)}`);
  }, 80);
  return () => {
    clearInterval(id);
    process.stdout.write(cursor.clearLine + cursor.show);
  };
}

// ── Type icons ────────────────────────────────────────────────────────────────

export function typeIcon(type: "movie" | "series", isAnime = false): string {
  if (type === "movie") return icon.movie;
  return isAnime ? icon.anime : icon.series;
}

// ── Duration formatter ────────────────────────────────────────────────────────

export function fmtDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── Compact status line ───────────────────────────────────────────────────────
//
// Single line shown during active playback poll and as menu context.

export function statusLine(opts: {
  title: string;
  type: "movie" | "series";
  season?: number;
  episode?: number;
  provider: string;
  isAnime?: boolean;
}): string {
  const ti = typeIcon(opts.type, opts.isAnime);
  const ep =
    opts.type === "series"
      ? `  ${clr.cyan(`S${String(opts.season ?? 1).padStart(2, "0")}E${String(opts.episode ?? 1).padStart(2, "0")}`)}`
      : "";
  return `${ti}  ${clr.bold(opts.title)}${ep}  ${clr.dim(opts.provider)}`;
}
