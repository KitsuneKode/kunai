// =============================================================================
// iterm-inline.ts — iTerm2's inline-image protocol (OSC 1337).
//
// The highest-fidelity option on terminals that are not kitty: the prepared PNG
// is transmitted verbatim, so unlike sixel there is no 256-colour quantisation
// step and no palette loss. iTerm2 defined it; VSCode 1.80+ implements it.
//
// Geometry is declared in *cells* (`width=Nch`), which is what keeps the image
// inside the rectangle the shell reserved for it. Without an explicit size
// iTerm2 scales to the image's own pixel dimensions and pushes the layout.
// =============================================================================

/**
 * Build the escape sequence that draws `png` in a `cols` x `rows` cell box.
 *
 * `preserveAspectRatio=1` letterboxes inside that box rather than stretching;
 * preparation has already fitted the pixels, so this only guards against a cell
 * aspect that differs from the estimate. `inline=1` draws it now instead of
 * treating it as a file download.
 */
export function buildItermInlineImage(
  png: Uint8Array,
  options: { readonly rows: number; readonly cols: number },
): string | null {
  if (png.byteLength === 0) return null;
  if (options.rows <= 0 || options.cols <= 0) return null;

  const payload = Buffer.from(png).toString("base64");
  const args = [
    "inline=1",
    `size=${png.byteLength}`,
    `width=${options.cols}`,
    `height=${options.rows}`,
    "preserveAspectRatio=1",
    // The overlay manager positions every write itself, so letting the image
    // advance the cursor would desync it from Ink's idea of where it is.
    "doNotMoveCursor=1",
  ].join(";");

  // OSC 1337 ; File = <args> : <base64> BEL
  //
  // iTerm2 silently drops a single OSC at ~1MiB, so an oversized payload
  // paints nothing either way - return null and let the caller fall back
  // to text. The escape bytes are written as \x escapes, not literals:
  // a formatter or scrub pass would otherwise corrupt this file invisibly.
  const MAX_ITERM_OSC_BYTES = 1_048_576;
  if (args.length + payload.length + 16 > MAX_ITERM_OSC_BYTES) return null;
  return `\x1b]1337;File=${args}:${payload}\x07`;
}
