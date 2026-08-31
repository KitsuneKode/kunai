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
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { applyExpression } from "./kanna-expressions.mjs";

const ROOT = path.resolve(import.meta.dir, "../../..");
const HERE = path.join(ROOT, ".reference/design/brand");
const BATCH = path.join(HERE, "ip-as-logo-batch");
const BRAND = HERE;
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
 * Every still the site and the terminal load, all from the Kanna v1 sheet.
 *
 * One character now. The previous set drew from three separate generation
 * directions — Operator, Courier, Watcher — which meant three eye treatments,
 * three ear silhouettes and a chest blaze that came and went, so the mascot
 * never read as the same animal twice.
 *
 * Two poses from that sheet are deliberately not here. `seek` reads as a low
 * idle rather than a hunt, and `peek` was drawn leaning on a ledge in the same
 * rose as her fur, so the alpha cut keeps the ledge and she ships welded to a
 * pink slab. Both are queued for a redraw; shipping six good poses of one fox
 * beats eight where two are wrong.
 *
 * Facing is resolved by `kunai-fox.tsx`, which flips the drawn still when a
 * direction has no master of its own.
 */
const DOCS_STILLS_BY_NAME = {
  idle: "kanna-sheet-1-front-sit.png",
  wait: "kanna-sheet-2-three-quarter.png",
  go: "kanna-pose-carry.png",
  watch: "kanna-pose-watch.png",
  oops: "kanna-sheet-5-oops.png",
  nap: "kanna-sheet-4-nap.png",
} as const;

/** The four poses the terminal companion loads, same masters as the docs set. */
const CLI_PETS_BY_NAME = {
  idle: "kanna-sheet-1-front-sit.png",
  wait: "kanna-sheet-2-three-quarter.png",
  go: "kanna-pose-carry.png",
  watch: "kanna-pose-watch.png",
  oops: "kanna-sheet-5-oops.png",
  nap: "kanna-sheet-4-nap.png",
} as const;

/**
 * The nav mark, and the OG bake.
 *
 * The sheet's own head-and-shoulders view, which is drawn for this job rather
 * than cropped down to it — the full figure is a smudge at 28px, and cropping a
 * standing pose put her eyes on the bottom edge.
 */
const NAV_MASTER = "kanna-sheet-6-bust.png";
const NAV_CROP = 100;

/**
 * Poses that render from the traced vector instead of a raster master.
 *
 * `idle` is the reason this exists. It is the hero at 120px, the nav mark at
 * 28px and the roamer at rest — the three most-seen surfaces in the product —
 * and the master draws it with plain round eyes, which is the one face in the
 * set with no expression in it. `watch`, `oops` and `nap` already carry a
 * half-lid, a brow and closed eyes in their own art, so they stay raster.
 *
 * The vector is already cut to alpha, so these skip the flood-fill and erode
 * that a plated master needs.
 */
const VECTOR_SOURCES = {
  idle: { svg: "kanna-idle.svg", expression: "squint" },
  nav: { svg: "kanna-bust.svg", expression: "squint" },
} as const;

/**
 * Why this shells out instead of using `Bun.Image`.
 *
 * `Bun.Image` covers resize, rotate, flip, and encoding to png/webp/avif — but
 * it exposes no flood fill, no morphology, no trim, no crop, and no raw pixel
 * access. Those are precisely the four steps the alpha cut is made of, so there
 * is nothing here to build on: doing it in Bun would mean decoding the PNG,
 * writing flood fill and erosion by hand, and re-encoding — new image-processing
 * code to own and test.
 *
 * That trade would be worth it for something on a hot path or in CI. This is
 * neither. It is a manual design step that runs when new art lands, a few times
 * a year, and it writes committed artifacts. The dependency that actually
 * mattered was the one in `apps/docs/test/kunai-fox.test.ts`, which ran on every
 * CI job; that one reads the file header directly and needs no tooling.
 */
async function magick(args: readonly string[]): Promise<void> {
  if (!Bun.which("magick")) {
    throw new Error(
      "ImageMagick 7 is required for this export and `magick` is not on PATH.\n" +
        "  macOS: brew install imagemagick\n" +
        "  Arch:  pacman -S imagemagick\n" +
        "  Debian/Ubuntu: apt install imagemagick  (then check `magick -version`;\n" +
        "    older images ship v6 as `convert` and have no `magick` entrypoint)",
    );
  }
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
/**
 * Rasterize a traced pose at one expression.
 *
 * No alpha cut here: the vector carries transparency already, and running the
 * flood fill over it would eat the eyes, which are the same colour the plate
 * used to be. Density is set so the vector is rendered at the target size
 * rather than scaled up from a default 96dpi bitmap.
 */
async function exportVectorStill(
  svgName: string,
  expression: string,
  dest: string,
  size: number,
  format: StillFormat,
  crop?: number,
): Promise<number> {
  const svg = await Bun.file(path.join(HERE, svgName)).text();
  const posed = applyExpression(svg, expression);
  const tmp = path.join(tmpdir(), `kanna-${expression}-${path.basename(dest)}.svg`);
  await Bun.write(tmp, posed);

  const inner = Math.round(size * FILL_RATIO);
  const encode =
    format === "webp"
      ? ["-quality", WEBP_QUALITY, "-define", "webp:alpha-quality=100", "-strip", dest]
      : ["-strip", `PNG32:${dest}`];

  await magick([
    "-background",
    "none",
    "-density",
    "384",
    tmp,
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

  rmSync(tmp, { force: true });
  return Bun.file(dest).size;
}

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
  const vector = VECTOR_SOURCES[name as keyof typeof VECTOR_SOURCES];
  const bytes = vector
    ? await exportVectorStill(vector.svg, vector.expression, dest, 320, "webp")
    : await exportStill(file, dest, 320, "webp");
  console.log(`docs ${name}.webp ${bytes} bytes${vector ? ` (vector, ${vector.expression})` : ""}`);
}

const navDest = path.join(DOCS_STILLS, "nav.webp");
const nav = VECTOR_SOURCES.nav;
console.log(
  `docs nav.webp ${await exportVectorStill(nav.svg, nav.expression, navDest, 128, "webp", NAV_CROP)} bytes (vector, ${nav.expression})`,
);

// The companion slot is 4 rows x 6 cols, which is well under 128px on any
// realistic cell size, so a larger source would only cost decode time.
for (const [name, file] of Object.entries(CLI_PETS_BY_NAME)) {
  const vector = VECTOR_SOURCES[name as keyof typeof VECTOR_SOURCES];
  const dest = path.join(CLI_PETS, `${name}.png`);
  const bytes = vector
    ? await exportVectorStill(vector.svg, vector.expression, dest, 128, "png")
    : await exportStill(file, dest, 128, "png");
  console.log(`cli  ${name}.png ${bytes} bytes${vector ? ` (vector, ${vector.expression})` : ""}`);
}

// Inlined as base64 into two OG route bundles, so this one is sized to its
// ~40 KB budget rather than to the 360px the card draws it at. A social card is
// read small; the softness costs less than doubling two bundles would.
// Guarded by `kunai-fox.test.ts`, which fails if the data URL grows past it.
const ogDest = path.join(BRAND, "kunai-mascot-og.png");
console.log(
  `og   kunai-mascot-og.png ${await exportVectorStill(nav.svg, nav.expression, ogDest, 192, "png")} bytes (vector, ${nav.expression})`,
);
