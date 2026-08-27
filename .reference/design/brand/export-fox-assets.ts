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
 * ## Why quantize
 *
 * The masters carry 2,600-4,100 colours for art specified as three. At 32
 * colours the result is visually identical and roughly 20x smaller, which is
 * what keeps `generated-mascot.json` inside its ~40 KB budget.
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
/** Visually identical to the unquantized cut, ~14x smaller. */
const PALETTE_SIZE = 32;
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
 * The nav renders at 28px, where a corner-cropped master is an unreadable
 * smudge. A2 sits square in frame with both ears intact, so it survives the
 * downscale — see the `nav` still in `kunai-fox.tsx`.
 */
const NAV_MASTER = "kunai-ip-A2-operator-lr.png";

async function magick(args: readonly string[]): Promise<void> {
  const proc = Bun.spawn(["magick", ...args], { stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) {
    const message = await new Response(proc.stderr).text();
    throw new Error(`magick exited ${code}: ${message.trim()}`);
  }
}

/**
 * One master to one exported still: cut the plate to alpha, trim it away, then
 * centre the character on a transparent square of the requested size.
 *
 * `-alpha set` has to come first or the flood fill has no channel to write
 * into. `+repage` after the trim resets the virtual canvas, without which the
 * later `-extent` would re-introduce the offset the trim just removed.
 */
async function exportStill(sourceName: string, dest: string, size: number): Promise<number> {
  const source = path.join(BATCH, sourceName);
  const inner = Math.round(size * FILL_RATIO);

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
    "-resize",
    `${inner}x${inner}`,
    "-background",
    "none",
    "-gravity",
    "center",
    "-extent",
    `${size}x${size}`,
    "-colors",
    String(PALETTE_SIZE),
    "-dither",
    "None",
    "-strip",
    // PNG8 keeps the palette indexed and the transparency in a tRNS chunk,
    // which halves the file and which `apps/cli/src/image/decode.ts` reads
    // back as real per-pixel alpha.
    `PNG8:${dest}`,
  ]);

  return Bun.file(dest).size;
}

mkdirSync(DOCS_STILLS, { recursive: true });
mkdirSync(CLI_PETS, { recursive: true });

for (const [name, file] of Object.entries(DOCS_STILLS_BY_NAME)) {
  const dest = path.join(DOCS_STILLS, `${name}.png`);
  console.log(`docs ${name}.png ${await exportStill(file, dest, 320)} bytes`);
}

const navDest = path.join(DOCS_STILLS, "nav.png");
console.log(`docs nav.png ${await exportStill(NAV_MASTER, navDest, 96)} bytes`);

// The companion slot is 4 rows x 6 cols, which is well under 128px on any
// realistic cell size, so a larger source would only cost decode time.
for (const [name, file] of Object.entries(CLI_PETS_BY_NAME)) {
  const dest = path.join(CLI_PETS, `${name}.png`);
  console.log(`cli  ${name}.png ${await exportStill(file, dest, 128)} bytes`);
}

// The OG bake inlines this as a data URL, so its size lands in two route
// bundles. Kept at 256 rather than 320 for that reason.
const ogDest = path.join(BRAND, "kunai-mascot-og.png");
console.log(`og   kunai-mascot-og.png ${await exportStill(NAV_MASTER, ogDest, 256)} bytes`);
