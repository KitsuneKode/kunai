// =============================================================================
// kanna-expressions.mjs — the expression vocabulary
//
// A model sheet and an expression sheet are different documents. The first
// batch of art varied *construction* between poses — ear silhouette, eye
// treatment, a chest blaze that appeared and vanished — which is why it read as
// three different animals. The fix locked construction and then varied nothing,
// so every pose wore the same neutral face. Neither is right.
//
// Construction is fixed by the trace. Expression is this: a transform on the
// traced eye paths, never a redrawn shape. Add a face here, not a new master.
// =============================================================================

/** Eyes are ~66x95 in the 928 box; these numbers are tuned against that. */
const BROW = {
  l: '<path d="M-48 -74 L 42 -44" stroke="#1C1620" stroke-width="17" stroke-linecap="round" fill="none"/>',
  r: '<path d="M48 -74 L -42 -44" stroke="#1C1620" stroke-width="17" stroke-linecap="round" fill="none"/>',
};
const CLOSED_ARC =
  '<path d="M-36 6 Q 0 -20 36 6" fill="none" stroke="#1C1620" stroke-width="14" stroke-linecap="round"/>';

/**
 * The squint, drawn rather than squashed.
 *
 * This is the one shape the Kanna sheet never had, and the reason the first
 * attempt failed: it was `scale(1 0.42)` on the round eye, which yields a
 * flatter ellipse and nothing else. Regenerating the nav mark with and without
 * it moved 0.27% of pixels — invisible at the sizes that carry the brand.
 *
 * The batch-1 faces do something different, visible once magnified: a round eye
 * with a straight lid cutting across the top at an angle, low on the outer
 * side, so the outer corner tapers to a point while the inner side keeps a full
 * belly. A heavy lid, not a squashed circle — which is why it reads as
 * unimpressed and why it survives being made small.
 *
 * Reference: `.reference/design/brand/expression-reference/`.
 */
const SQUINT_PATH =
  "M36 4 C16 -12 -6 -20 -24 -18 C-32 -17 -34 -11 -33 -4 " +
  "C-31 8 -19 17 -2 17 C14 17 30 12 36 4 Z";
const SQUINT = {
  // Mass toward the nose, taper pointing out and up — matched against the
  // batch-1 faces at magnification. The right eye is the same path mirrored;
  // the shape is not symmetric, so both eyes cannot share one string.
  l: `<path d="${SQUINT_PATH}" fill="#1C1620"/>`,
  r: `<path transform="scale(-1 1)" d="${SQUINT_PATH}" fill="#1C1620"/>`,
};

export const EXPRESSIONS = {
  /** A lid cut across the eye at an angle. Unimpressed — the character's default. */
  squint: { swap: SQUINT },
  /** Round and open. Neutral; reads as generic, so it is rarely the right pick. */
  plain: { l: "", r: "" },
  /** Flat top edge. Calm, watching. */
  halflid: { l: "", r: "", clip: true },
  /** Angled bars over slightly squashed eyes. Annoyed. */
  brow: { l: "scale(1 0.86)", r: "scale(1 0.86)", add: BROW },
  /** Enlarged. Alert, surprised. */
  wide: { l: "scale(1.18)", r: "scale(1.18)" },
  /** An upward arc. Asleep, content. */
  closed: { swap: CLOSED_ARC },
  /** A thin bar. Transient — for animation only, never a resting face. */
  blink: { l: "scale(1 0.09)", r: "scale(1 0.09)" },
};

export const EXPRESSION_NAMES = Object.keys(EXPRESSIONS);

/**
 * Apply an expression to a layered Kanna SVG.
 *
 * Rewrites only the contents of each `.eye-x` group, so the traced geometry,
 * the silhouette and every other layer are untouched.
 */
export function applyExpression(svg, name) {
  const cfg = EXPRESSIONS[name];
  if (!cfg) throw new Error(`unknown expression "${name}" — have: ${EXPRESSION_NAMES.join(", ")}`);

  // Matches the whole nested group — outer `.eye`, inner `.eye-x`, both closes.
  // A non-greedy match to a single `</g>` stops at the inner close and leaves
  // the outer one stranded, which silently unbalances the document.
  return svg.replace(
    /<g class="eye eye-([lr])"([^>]*)><g class="eye-x">([\s\S]*?)<\/g><\/g>/gu,
    (_all, side, attrs, inner) => {
      const open = `<g class="eye eye-${side}"${attrs}>`;
      if (cfg.swap) {
        // `swap` is one shape for both eyes, or a per-side pair when the shape
        // is not symmetric — the squint's taper points outward on each side.
        const shape = typeof cfg.swap === "string" ? cfg.swap : cfg.swap[side];
        return `${open}<g class="eye-x">${shape}</g></g>`;
      }
      const t = cfg[side] ? ` transform="${cfg[side]}"` : "";
      const clip = cfg.clip ? ' clip-path="url(#lidClip)"' : "";
      const add = cfg.add ? cfg.add[side] : "";
      return `${open}<g class="eye-x"${t}${clip}>${inner}</g>${add}</g>`;
    },
  );
}

/** Turn the painterly shading layer on. Off by default — it is a per-surface dial. */
export function withShading(svg) {
  return svg.replace('<g id="shade" opacity="0"', '<g id="shade" opacity="1"');
}
