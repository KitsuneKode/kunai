/**
 * Rasterize `kanna.svg` into every still the docs site, the OG bake, and the
 * CLI companion actually load — and the animation strips the terminal plays.
 *
 * Everything here comes from the one layered vector. Nothing reads a raster
 * master any more: `trace-kanna.mjs` is the only step that does, and it is the
 * one that owns the flood-fill alpha cut.
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
 * ## What the terminal gets
 *
 * Per pose, two files and one shared manifest:
 *
 * - `<pose>.png` — the still. Every terminal that can draw an image at all
 *   draws this one: Sixel, iTerm2 inline, WezTerm, and Kitty when motion is off.
 * - `<pose>.strip.png` — the distinct drawings of her motion, side by side,
 *   `rest` first. Kitty and Ghostty upload these once as animation frames and
 *   play them themselves.
 * - `motion.json` — how many drawings each strip holds and the loop that plays
 *   them. Generated here so the strip and its timeline cannot disagree.
 *
 * Every frame of a strip is cropped to the *same* box — the union of all of
 * them — so she does not jump when a frame is taller than `rest`.
 *
 * Both are 256px. The companion slot is three or four rows, which is 60-90px on
 * a 1x display and up to ~200px on a HiDPI one; the CLI downsizes to the
 * measured cell box at run time, so this only has to be large enough that it
 * never upscales.
 *
 * Lives beside the other brand generators rather than under `apps/docs`,
 * because it writes both the site stills and the CLI pets.
 *
 * Requires ImageMagick 7 (`magick`) and librsvg (`rsvg-convert`). This is a
 * manual design step, not a CI step — the exported files are committed.
 *
 *   bun .reference/design/brand/export-fox-assets.ts
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { MOTION, RESTING, frameOptions, poseSvg } from "./kanna-rig.mjs";

/**
 * A private scratch directory for this run.
 *
 * `mkdtemp` creates it 0700 with an unpredictable name. Fixed names under a
 * shared `/tmp` are pre-creatable by any other user on the box — as a symlink,
 * which `Bun.write` follows — so the intermediate SVGs could be redirected, or
 * read while they exist.
 */
const SCRATCH = mkdtempSync(path.join(tmpdir(), "kanna-export-"));

const ROOT = path.resolve(import.meta.dir, "../../..");
const HERE = path.join(ROOT, ".reference/design/brand");
const DOCS_STILLS = path.join(ROOT, "apps/docs/public/brand/fox");
const CLI_PETS = path.join(ROOT, "apps/cli/src/app-shell/brand/pets");

/** Lossy WebP quality. Flat art holds up well below this; edges do not. */
const WEBP_QUALITY = "88";
/** Fraction of the square the character fills on the site, leaving breathing room. */
const SITE_FILL = 0.88;
/**
 * The terminal slot is a few rows tall, so padding there is paid in pixels she
 * could have used. Only enough is left that an ear tip never touches the edge.
 */
const CLI_FILL = 0.96;
/** Edge of every CLI still and of every frame in a strip. */
const CLI_SIZE = 256;
/** The vector is rendered this wide before trimming, so every resize is a downscale. */
const RENDER_WIDTH = 1392;

type Pose = keyof typeof MOTION;

/** Every pose the site serves. `nav` is the bust, exported separately below. */
const DOCS_POSES = ["idle", "wait", "seek", "go", "watch", "oops", "nap", "peek"] as const;
/** Every pose the terminal companion loads. */
const CLI_POSES = Object.keys(MOTION) as readonly Pose[];

/**
 * `peek` is cut flat along the edge she looks over, so it sits on the bottom of
 * its box with no padding under it: whatever the surface draws on the next row
 * — a rule, a border, the line below — becomes the edge.
 */
const SITS_ON_EDGE = new Set<string>(["peek"]);

async function run(command: string, args: readonly string[]): Promise<string> {
  if (!Bun.which(command)) {
    throw new Error(
      `\`${command}\` is required for this export and is not on PATH.\n` +
        "  macOS: brew install imagemagick librsvg\n" +
        "  Arch:  pacman -S imagemagick librsvg\n" +
        "  Debian/Ubuntu: apt install imagemagick librsvg2-bin  (then check `magick -version`;\n" +
        "    older images ship v6 as `convert` and have no `magick` entrypoint)",
    );
  }
  const proc = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (code !== 0) {
    const message = await new Response(proc.stderr).text();
    throw new Error(`${command} exited ${code}: ${message.trim()}`);
  }
  return out;
}

const kanna = await Bun.file(path.join(HERE, "kanna.svg")).text();

let scratchCount = 0;

/**
 * One drawing of one pose, rasterized large on a transparent ground.
 *
 * Through `rsvg-convert` and not `magick`: ImageMagick silently falls back to
 * its own SVG renderer when the librsvg delegate cannot run, and that renderer
 * draws curves as coarse polygons and ignores clip rules. A run that looked
 * fine and shipped a faceted fox is worse than a run that stops.
 */
async function rasterize(pose: string, options: Parameters<typeof poseSvg>[2]): Promise<string> {
  const stem = path.join(SCRATCH, `${pose}-${scratchCount++}`);
  await Bun.write(`${stem}.svg`, poseSvg(kanna, pose, options));
  await run("rsvg-convert", ["-w", String(RENDER_WIDTH), `${stem}.svg`, "-o", `${stem}.png`]);
  return `${stem}.png`;
}

/** The bounding box of the ink across a set of same-sized rasters, as a `-crop` geometry. */
async function unionBox(files: readonly string[]): Promise<string> {
  const info = await run("magick", [
    ...files,
    "-background",
    "none",
    "-layers",
    "merge",
    "-trim",
    "-format",
    "%wx%h%X%Y",
    "info:",
  ]);
  return info.trim();
}

type Fit = {
  readonly size: number;
  readonly fill: number;
  readonly gravity: "center" | "south";
  /** Keep only the top percentage of the trimmed figure — the nav bust. */
  readonly cropTop?: number;
};

/** Crop a raster to `box`, fit it into a transparent square, and encode it. */
async function fitInto(source: string, box: string, dest: string, fit: Fit): Promise<void> {
  const inner = Math.round(fit.size * fit.fill);
  const isWebp = dest.endsWith(".webp");
  await run("magick", [
    source,
    "-crop",
    box,
    "+repage",
    ...(fit.cropTop === undefined
      ? []
      : ["-gravity", "north", "-crop", `100%x${fit.cropTop}%+0+0`, "+repage"]),
    "-resize",
    `${inner}x${inner}`,
    "-background",
    "none",
    "-gravity",
    fit.gravity,
    "-extent",
    `${fit.size}x${fit.size}`,
    "-strip",
    ...(isWebp
      ? ["-quality", WEBP_QUALITY, "-define", "webp:alpha-quality=100", dest]
      : // PNG32, never PNG8 — see the header. Colour type 6 is what keeps
        // per-pixel alpha instead of collapsing it to a 1-bit mask.
        ["-define", "png:compression-level=9", `PNG32:${dest}`]),
  ]);
}

/** One still of a pose at rest. */
async function exportStill(pose: string, dest: string, fit: Fit): Promise<number> {
  const expression = RESTING[pose as keyof typeof RESTING] ?? undefined;
  const raster = await rasterize(pose, { expression });
  await fitInto(raster, await unionBox([raster]), dest, fit);
  return Bun.file(dest).size;
}

mkdirSync(DOCS_STILLS, { recursive: true });
mkdirSync(CLI_PETS, { recursive: true });

for (const pose of DOCS_POSES) {
  const dest = path.join(DOCS_STILLS, `${pose}.webp`);
  const bytes = await exportStill(pose, dest, { size: 320, fill: SITE_FILL, gravity: "center" });
  console.log(`docs ${pose}.webp ${bytes} bytes (${RESTING[pose] ?? "as drawn"})`);
}

const navDest = path.join(DOCS_STILLS, "nav.webp");
console.log(
  `docs nav.webp ${await exportStill("bust", navDest, { size: 128, fill: SITE_FILL, gravity: "center", cropTop: 100 })} bytes (${RESTING.bust})`,
);

// The terminal set: a still and a strip per pose, every frame of a pose cut to
// one shared box so nothing shifts between drawings.
const manifest: Record<string, { frames: number; loop: [number, number][] }> = {};
for (const pose of CLI_POSES) {
  const motion = MOTION[pose];
  const names = Object.keys(motion.frames);
  const rasters: string[] = [];
  for (const name of names) rasters.push(await rasterize(pose, frameOptions(kanna, pose, name)));
  const box = await unionBox(rasters);
  const fit: Fit = SITS_ON_EDGE.has(pose)
    ? { size: CLI_SIZE, fill: 1, gravity: "south" }
    : { size: CLI_SIZE, fill: CLI_FILL, gravity: "center" };

  const frames: string[] = [];
  for (const [index, raster] of rasters.entries()) {
    const frame = path.join(SCRATCH, `${pose}-frame-${index}.png`);
    await fitInto(raster, box, frame, fit);
    frames.push(frame);
  }

  const still = path.join(CLI_PETS, `${pose}.png`);
  const strip = path.join(CLI_PETS, `${pose}.strip.png`);
  await Bun.write(still, Bun.file(frames[0] as string));
  await run("magick", [
    ...frames,
    "+append",
    "-strip",
    "-define",
    "png:compression-level=9",
    `PNG32:${strip}`,
  ]);
  manifest[pose] = {
    frames: names.length,
    loop: motion.loop.map(([name, ms]) => [names.indexOf(name as string), ms as number]),
  };
  console.log(
    `cli  ${pose}.png ${Bun.file(still).size} bytes · ${pose}.strip.png ${Bun.file(strip).size} bytes (${names.join(", ")})`,
  );
}
await Bun.write(
  path.join(CLI_PETS, "motion.json"),
  `${JSON.stringify({ size: CLI_SIZE, poses: manifest }, null, 2)}\n`,
);

// Inlined as base64 into two OG route bundles, so this one is sized to its
// ~40 KB budget rather than to the 360px the card draws it at. A social card is
// read small; the softness costs less than doubling two bundles would.
// Guarded by `kunai-fox.test.ts`, which fails if the data URL grows past it.
const ogDest = path.join(HERE, "kunai-mascot-og.png");
console.log(
  `og   kunai-mascot-og.png ${await exportStill("bust", ogDest, { size: 192, fill: SITE_FILL, gravity: "center" })} bytes (${RESTING.bust})`,
);

// The scratch directory holds only intermediates; every real output is already
// written. Removing it here rather than per-file keeps a failed run's artifacts
// around for inspection, which is the useful behaviour for a manual design step.
rmSync(SCRATCH, { recursive: true, force: true });
