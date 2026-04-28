// Kitty / Ghostty terminal graphics protocol — inline poster preview.
// Protocol spec: https://sw.kovidgoyal.net/kitty/graphics-protocol/
//
// Ghostty supports the same APC escape sequence as Kitty, so the same
// code path handles both. We detect via KITTY_WINDOW_ID (Kitty) or
// TERM_PROGRAM=ghostty (Ghostty).
//
// Silently no-ops on any unsupported terminal or fetch failure.

const TMDB_IMG = "https://image.tmdb.org/t/p/w300";

// Max terminal rows the poster is allowed to occupy (cells, not pixels).
// Keeps the poster from flooding a small terminal window.
const MAX_ROWS = 18;

export function isKittyCompatible(): boolean {
  return !!(process.env.KITTY_WINDOW_ID || process.env.TERM_PROGRAM === "ghostty");
}

export async function displayPoster(posterPath: string | null): Promise<void> {
  if (!posterPath || !isKittyCompatible()) return;

  try {
    const res = await fetch(`${TMDB_IMG}${posterPath}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return;

    const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");

    // Kitty requires ≤4096 bytes of base64 per APC chunk.
    const CHUNK = 4096;
    const chunks: string[] = [];
    for (let i = 0; i < b64.length; i += CHUNK) chunks.push(b64.slice(i, i + CHUNK));

    // Edge case: empty image shouldn't happen but guard anyway
    if (chunks.length === 0) return;

    for (let i = 0; i < chunks.length; i++) {
      const isFirst = i === 0;
      const isLast = i === chunks.length - 1;
      const more = isLast ? 0 : 1; // m=1 means more chunks follow

      let ctrl: string;
      if (isFirst) {
        // a=T  → transmit + display immediately
        // f=100 → PNG (the only reliable lossless format across both terminals)
        // q=2  → suppress OK/error responses from the terminal (avoids junk in stdout)
        // r=N  → limit to N cell-rows so the poster doesn't overflow the viewport
        ctrl = `a=T,f=100,q=2,r=${MAX_ROWS},m=${more}`;
      } else {
        // Continuation chunks carry only the m flag
        ctrl = `m=${more}`;
      }

      process.stdout.write(`\x1b_G${ctrl};${chunks[i]}\x1b\\`);
    }

    // Blank line below the image so the next @clack prompt has breathing room
    process.stdout.write("\n\n");
  } catch {
    // Poster is a nice-to-have — never crash the main flow over it
  }
}
