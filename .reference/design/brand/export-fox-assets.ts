/**
 * Cut the ip-as-logo masters to alpha and export every still the docs site, the
 * OG bake, and the CLI companion actually load.
 *
 * ## Why a flood fill and not `-transparent`
 *
 * The masters are opaque: the character sits on a solid `#1c1620` plate. Left
 * alone that plate is visible everywhere — a lighter box on the docs hero, and
 * a dark box painted over whatever background the terminal user chose.
 *
 * The cut has to be a *flood fill*, never a global colour replace. The brief
 * reuses the background colour for the eyes, so `-transparent '#1c1620'`
 * punches straight through them and the fox comes out blind. A flood only
 * clears background reachable from outside the silhouette, so the eyes and the
 * mouth — enclosed pockets — correctly survive.
 *
 * Seeding that flood from the four corners is not enough: the masters are
 * composed to emerge from a corner, so on those the seed lands on the character
 * and clears nothing, stranding background wedges along that edge. Framing the
 * image in a one-pixel plate-coloured border first connects every
 * edge-touching region into one, so a single flood from the new corner clears
 * all of them.
 *
 * The generator also ignored the "no lighting variation" clause and shaded the
 * plate, so no two masters share a corner value — hence the fuzz tolerance.
 *
 * ## Why three output formats
 *
 * The destinations have genuinely different constraints, and one format cannot
 * serve all three.
 *
 * A palette PNG (`PNG8`) is the trap. Its transparency lives in a `tRNS` chunk
 * that stores one alpha value per palette entry, and in practice a quantizer
 * spends the palette on colour — leaving a **two-level** alpha, fully opaque or
 * fully clear. That is a 1-bit cutout: hard stair-stepped edges at every size,
 * worst in the nav. Whatever else changes here, never write PNG8.
 *
 * - **Site stills → WebP.** Lossy WebP keeps full 8-bit alpha and lands smaller
 *   than the broken PNG8 did. Universally supported for years.
 * - **CLI pets → PNG32.** `apps/cli/src/image/decode.ts` parses PNG only, and
 *   colour type 6 is the shape that carries real per-pixel alpha.
 * - **OG bake → PNG32, smaller.** Satori wants PNG, and this one is inlined as
 *   base64 into two route bundles, so its budget is the tightest.
 *
 * Lives beside the other brand generators rather than under `apps/docs`,
 * because it now writes both the site stills and the CLI pets. Two pipelines
 * over one set of masters is what let the docs export skip the quantization the
 * CLI export was already doing, and the site shipped ~100 KB stills for months.
 *
 * Requires ImageMagick 7 (`magick`). This is a manual design step, not a CI
 * step — the exported PNGs are committed.
 *
 *   bun .reference/design/brand/export-fox-assets.ts
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../../..");
const BATCH = path.join(ROOT, ".reference/design/brand/ip-as-logo-batch");
const BRAND = path.join(ROOT, ".reference/design/brand");
const DOCS_STILLS = path.join(ROOT, "apps/docs/public/brand/fox");
const CLI_PETS = path.join(ROOT, "apps/cli/src/app-shell/brand/pets");

/** The plate colour the masters were drawn on, and the colour of the eyes. */
const PLATE = "#1c1620";
/** Corner-to-corner spread across the six masters is ~10 levels; 22% clears it. */
const PLATE_FUZZ = "22%";
/** Lossy WebP quality. Flat art holds up well below this; edges do not. */
const WEBP_QUALITY = "88";
/** Fraction of the square the character fills, leaving even breathing room. */
const FILL_RATIO = 0.88;

/**
 * Docs stills. `*-right` / `*-left` names describe which way the character
 * faces, which is not the same as the `ll` / `lr` corner the master emerged
 * from — see `kunai-fox.tsx` for how facing is resolved.
 */
const DOCS_STILLS_BY_NAME = {
  wait: "kunai-ip-A1-operator-ll.png",
  "wait-right": "kunai-ip-A2-operator-lr.png",
  go: "kunai-ip-B1-courier-ll.png",
  "go-left": "kunai-ip-B2-courier-lr.png",
  watch: "kunai-ip-C1-watcher-ll.png",
  idle: "kunai-ip-C2-watcher-lr.png",
} as const;

/** The four poses the terminal companion loads, same masters as the docs set. */
const CLI_PETS_BY_NAME = {
  wait: "kunai-ip-A1-operator-ll.png",
  go: "kunai-ip-B1-courier-ll.png",
  watch: "kunai-ip-C1-watcher-ll.png",
  idle: "kunai-ip-C2-watcher-lr.png",
} as const;

/**
 * The nav mark, and the OG bake.
 *
 * Both are C2 — the same still the home hero uses. An earlier pass used A2 here
 * because the Operator survives 28px better, but the nav sits on every page
 * directly above the hero, so the two most-seen foxes on the site were visibly
 * different animals. Matching the hero matters more than the extra legibility.
 *
 * `NAV_CROP` keeps the top of the figure: the whole character at 28px is a
 * smudge, the head alone reads.
 */
const NAV_MASTER = "kunai-ip-C2-watcher-lr.png";
const NAV_CROP = 85;

async function magick(args: readonly string[]): Promise<void> {
  const proc = Bun.spawn(["magick", ...args], { stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) {
    const message = await new Response(proc.stderr).text();
    throw new Error(`magick exited ${code}: ${message.trim()}`);
  }
}

type StillFormat = "webp" | "png";

/**
 * One master to one exported still: cut the plate to alpha, trim it away, then
 * centre the character on a transparent square of the requested size.
 *
 * `-alpha set` has to come first or the flood fill has no channel to write
 * into. `+repage` after the trim resets the virtual canvas, without which the
 * later `-extent` would re-introduce the offset the trim just removed.
 *
 * `crop` keeps only the top fraction of the trimmed character, for the bust the
 * nav needs. The whole figure is unreadable at 28px.
 */
async function exportStill(
  sourceName: string,
  dest: string,
  size: number,
  format: StillFormat,
  crop?: number,
): Promise<number> {
  const source = path.join(BATCH, sourceName);
  const inner = Math.round(size * FILL_RATIO);

  const encode =
    format === "webp"
      ? ["-quality", WEBP_QUALITY, "-define", "webp:alpha-quality=100", "-strip", dest]
      : // PNG32, never PNG8 — see the header. Colour type 6 is what keeps
        // per-pixel alpha instead of collapsing it to a 1-bit mask.
        ["-strip", `PNG32:${dest}`];

  await magick([
    source,
    "-alpha",
    "set",
    // Frame in the plate colour so every edge-touching background region is
    // connected, then flood once from inside that frame and shave it back off.
    "-bordercolor",
    PLATE,
    "-border",
    "1",
    "-fuzz",
    PLATE_FUZZ,
    "-fill",
    "none",
    "-floodfill",
    "+0+0",
    PLATE,
    "-shave",
    "1x1",
    // The masters are antialiased against the plate, so the outermost ring of
    // surviving pixels is half-plate and reads as a dark halo on a light
    // ground. One pixel of erosion removes it; two starts eating the silhouette.
    "-channel",
    "A",
    "-morphology",
    "Erode",
    "Octagon:1",
    "+channel",
    "-trim",
    "+repage",
    ...(crop === undefined ? [] : ["-gravity", "north", "-crop", `100%x${crop}%+0+0`, "+repage"]),
    "-resize",
    `${inner}x${inner}`,
    "-background",
    "none",
    "-gravity",
    "center",
    "-extent",
    `${size}x${size}`,
    ...encode,
  ]);

  return Bun.file(dest).size;
}

mkdirSync(DOCS_STILLS, { recursive: true });
mkdirSync(CLI_PETS, { recursive: true });

for (const [name, file] of Object.entries(DOCS_STILLS_BY_NAME)) {
  const dest = path.join(DOCS_STILLS, `${name}.webp`);
  console.log(`docs ${name}.webp ${await exportStill(file, dest, 320, "webp")} bytes`);
}

const navDest = path.join(DOCS_STILLS, "nav.webp");
console.log(`docs nav.webp ${await exportStill(NAV_MASTER, navDest, 128, "webp", NAV_CROP)} bytes`);

// The companion slot is 4 rows x 6 cols, which is well under 128px on any
// realistic cell size, so a larger source would only cost decode time.
for (const [name, file] of Object.entries(CLI_PETS_BY_NAME)) {
  const dest = path.join(CLI_PETS, `${name}.png`);
  console.log(`cli  ${name}.png ${await exportStill(file, dest, 128, "png")} bytes`);
}

// Inlined as base64 into two OG route bundles, so this one is sized to its
// budget rather than to the 360px the card draws it at. A social card is read
// small; the softness costs less than doubling two bundles would.
const ogDest = path.join(BRAND, "kunai-mascot-og.png");
console.log(`og   kunai-mascot-og.png ${await exportStill(NAV_MASTER, ogDest, 224, "png")} bytes`);
