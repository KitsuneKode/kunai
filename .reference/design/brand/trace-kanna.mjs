// =============================================================================
// trace-kanna.mjs — raster masters → the one layered Kanna SVG
//
// Every pose is traced from its approved master into `kanna.svg`, one
// `<g id="pose-…">` each, all under the same layer contract. Two steps matter
// and both are non-obvious:
//
//   1. Flood-fill the plate to a sentinel colour BEFORE anything else. Her eyes
//      are the same #1c1620 as the background, so `-transparent` or a global
//      colour replace punches straight through them and the fox comes out
//      blind. A flood fill from the corner only clears the connected region.
//
//   2. Remap to the three brand colours BEFORE tracing. The masters carry
//      ~6,100 colours of antialiasing despite the brief specifying flat art;
//      traced raw that becomes hundreds of paths. After the remap it is nine.
//
// Layering is derived, not hand-authored: vtracer emits each region as its own
// translated path, so the dark ones are the eyes and nose (separable by size),
// and the cream ones are ears, muzzle and bib. That is the whole character
// contract — `.eyes` is what expression swaps.
//
// `seek` and `peek` are the two poses whose masters could not ship (see
// `kanna-rig.mjs`). They are still built from traced Kanna — construction is
// fixed — but re-posed here from clipped pieces rather than drawn as-is.
//
// Usage:  bun .reference/design/brand/trace-kanna.mjs [--debug <dir>]
// Requires: ImageMagick 7, rsvg-convert (librsvg), vtracer (cargo install vtracer)
// =============================================================================

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { debugGridElements, rawPoseHeight } from "./kanna-debug-grid.mjs";
import { BOX, CREAM, EARS, FUR, PLATE, POSES, POSE_NAMES, composePose } from "./kanna-rig.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BATCH = join(HERE, "ip-as-logo-batch");
const SENTINEL = "#00FF00";

const debugAt = process.argv.indexOf("--debug");
const debugDir = debugAt === -1 ? null : process.argv[debugAt + 1];

const work = mkdtempSync(join(tmpdir(), "kanna-trace-"));

const isNear = (hex, target) => {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [p(hex), p(target)];
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 24;
};

/** Rasterize one path alone and read its bounding box back. */
function measure(d, tx, ty, height) {
  const PAD = 400;
  const f = join(work, "measure.svg");
  writeFileSync(
    f,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BOX + PAD * 2}" height="${height + PAD * 2}">` +
      `<path transform="translate(${PAD + tx} ${PAD + ty})" d="${d}" fill="#000"/></svg>`,
  );
  // librsvg directly, not through ImageMagick: `magick` silently falls back to
  // its own SVG renderer when the delegate cannot run, and that one draws
  // curves as coarse polygons — a measurement taken from it is quietly wrong.
  const png = join(work, "measure.png");
  execFileSync("rsvg-convert", [f, "-o", png]);
  const info = execFileSync("magick", [png, "-trim", "-format", "%wx%h%X%Y", "info:"], {
    encoding: "utf8",
  }).trim();
  const m = /^(\d+)x(\d+)([+-]\d+)([+-]\d+)$/u.exec(info);
  if (!m) throw new Error(`could not measure a path: ${info}`);
  const [w, h, x, y] = m.slice(1).map(Number);
  return { x: x - PAD, y: y - PAD, w, h, cx: x - PAD + w / 2, cy: y - PAD + h / 2 };
}

/**
 * One master → its regions, in the master's own coordinates (BOX wide).
 *
 * `dams` are short fur-coloured strokes painted on the master before the flood
 * fill. `carry` needs one: the dart is plate-coloured and crosses the
 * silhouette edge, so the flood runs up the shaft and eats the fletching and
 * her nose. A dam across the shaft at the edge keeps the inside closed.
 */
function traceMaster(name, spec) {
  const flat = join(work, `${name}.png`);
  const traced = join(work, `${name}.svg`);
  const dams = (spec.dams ?? []).flatMap(([x1, y1, x2, y2, colour = FUR, width = 10]) => [
    "-stroke",
    colour,
    "-strokewidth",
    String(width),
    "-draw",
    `line ${x1},${y1} ${x2},${y2}`,
  ]);
  execFileSync("magick", [
    "-size", "1x1", `xc:${SENTINEL}`, `xc:${PLATE}`, `xc:${FUR}`, `xc:${CREAM}`,
    "+append", join(work, "palette.png"),
  ]);
  // `crop` cuts a cell out of the model sheet. The split cell files clip her
  // feet — the figures overrun the sheet's 512px rows — so the poses that have
  // feet are cut from the sheet itself, on the row gap rather than the grid.
  const crop = spec.crop ? ["-crop", spec.crop, "+repage"] : [];
  execFileSync("magick", [
    join(BATCH, spec.master), ...crop, "-resize", `${BOX}x`,
    ...dams,
    "-fuzz", "18%", "-fill", SENTINEL, "-floodfill", "+0+0", PLATE,
    "+dither", "-remap", join(work, "palette.png"), flat,
  ]);
  const height = Number(
    execFileSync("magick", [flat, "-format", "%h", "info:"], { encoding: "utf8" }).trim(),
  );
  execFileSync("vtracer", [
    "--input", flat, "--output", traced,
    "--colormode", "color", "--hierarchical", "cutout", "--mode", "spline",
    "--filter_speckle", "8", "--color_precision", "8", "--gradient_step", "0",
    "--corner_threshold", "60", "--segment_length", "4", "--path_precision", "2",
  ]);

  // `cutout` traces every region with holes punched for whatever sits on top of
  // it, so the fur has eye-shaped holes and the muzzle a nose-shaped one. That
  // is correct for the master and wrong for a rig: an expression smaller than
  // the eye it replaces — the squint, a blink — leaves the socket see-through.
  // Keeping only the outer contour makes every layer solid under the next.
  const outline = (d) => d.slice(0, d.indexOf("Z") + 1);
  const paths = [...readFileSync(traced, "utf8").matchAll(/<path\b[^>]*?\/?>/gu)].map((m) => {
    const tag = m[0];
    const fill = /fill="([^"]+)"/u.exec(tag)?.[1] ?? "";
    const d = outline(/\bd="([^"]+)"/u.exec(tag)?.[1] ?? "");
    const t = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/u.exec(tag);
    return { fill, d, tx: t ? Number(t[1]) : 0, ty: t ? Number(t[2]) : 0 };
  });

  // The sentinel path is the cut-away background; it is what makes her alpha.
  const drawable = paths
    .filter((p) => !isNear(p.fill, SENTINEL))
    .map((p) => Object.assign(p, { box: measure(p.d, p.tx, p.ty, height) }));
  const furs = drawable
    .filter((p) => isNear(p.fill, FUR))
    .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
  const fur = furs[0];
  const dark = drawable.filter((p) => isNear(p.fill, PLATE));
  const cream = drawable.filter((p) => !isNear(p.fill, FUR) && !isNear(p.fill, PLATE));
  if (!fur) throw new Error(`${name}: no fur silhouette found — did the remap run?`);

  // The nose is the widest-but-shortest dark region and the eyes are the two
  // tallest: sorting by height separates them without hardcoding geometry.
  // `spec.eyes` is 1 on the profile pose, where only one eye is drawn.
  const eyeCount = spec.eyes ?? 2;
  const byHeight = [...dark].sort((a, b) => b.box.h - a.box.h);
  const eyes = byHeight.slice(0, eyeCount).sort((a, b) => a.box.x - b.box.x);
  const rest = byHeight.slice(eyeCount);
  if (eyes.length < eyeCount) {
    throw new Error(`${name}: expected ${eyeCount} eyes, found ${dark.length} dark regions`);
  }
  return { name, height, fur, cream, eyes, rest, strays: furs.slice(1) };
}

const el = (p, attrs = "") =>
  `<path${attrs} transform="translate(${p.tx.toFixed(1)} ${p.ty.toFixed(1)})" d="${p.d}" fill="${normalise(p.fill)}"/>`;

/** vtracer drifts a level or two off the remap; the file should say the brand colour. */
function normalise(fill) {
  if (isNear(fill, FUR)) return FUR;
  if (isNear(fill, PLATE)) return PLATE;
  return CREAM;
}

/**
 * Each eye is wrapped in a group translated to its own centre, so an
 * expression is a transform on `.eye-x` — rotate, squash, scale — and never a
 * redrawn shape.
 */
function eyeGroup(p, side) {
  const { cx, cy, w, h } = p.box;
  return (
    `<g class="eye eye-${side}" data-w="${w}" data-h="${h}" transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)})">` +
    `<g class="eye-x">` +
    `<path transform="translate(${(p.tx - cx).toFixed(1)} ${(p.ty - cy).toFixed(1)})" d="${p.d}" fill="${PLATE}"/>` +
    `</g></g>`
  );
}

/** The traced regions as SVG fragments, with their boxes kept for the rig. */
function layersOf(trace) {
  const sides = trace.eyes.length === 1 ? ["l"] : ["l", "r"];
  return {
    height: trace.height,
    fur: el(trace.fur),
    furBox: trace.fur.box,
    cream: trace.cream.map((p) => ({ svg: el(p), box: p.box })),
    eyes: trace.eyes.map((p, i) => eyeGroup(p, sides[i])).join(""),
    nose: trace.rest.map((p) => el(p)).join(""),
  };
}

try {
  const groups = [];
  const defs = [];
  const report = [];
  for (const name of POSE_NAMES) {
    const spec = POSES[name];
    const trace = traceMaster(name, spec);
    const layers = layersOf(trace);
    const { body, poseDefs, foot } = composePose(name, layers);
    defs.push(...poseDefs);
    // Non-square masters are taller than the box; fit them rather than crop.
    const scale = Math.min(1, BOX / trace.height);
    const dx = (BOX - BOX * scale) / 2;
    const fit = scale === 1 ? "" : ` transform="translate(${dx.toFixed(1)} 0) scale(${scale.toFixed(4)})"`;
    const hidden = name === "idle" ? "" : ' display="none"';
    groups.push(
      `<g id="pose-${name}" class="pose" data-source="${spec.master}" data-h="${trace.height}" data-foot="${foot[0].toFixed(0)} ${foot[1].toFixed(0)}"${hidden}${fit}>\n${body}\n</g>`,
    );
    report.push(
      `${name}: ${trace.cream.length} cream, ${trace.eyes.length} eyes, ${trace.rest.length} nose, ${trace.height}px tall` +
        (trace.strays.length ? `, ${trace.strays.length} stray dropped` : ""),
    );
  }

  const svg = `<!--
  Kanna — generated by trace-kanna.mjs from kanna-rig.mjs. Do not hand-edit; re-run instead.

  One file, one character. Every pose is a group, hidden except \`idle\` so the
  file opens as her at rest; \`poseSvg()\` in kanna-rig.mjs returns one pose as a
  standalone document, at an expression and a motion.

  The layer contract inside every pose:
    .fur          silhouette
    .cream        ears, muzzle, bib
    .eyes         swapped to change expression; the paths are never redrawn
    .nose         nose (and the dart's fletching on \`go\`)
    .prop         the one permitted prop: the dart on \`go\`
  #shade is the painterly layer, opacity 0 — a per-surface dial, not a global choice.
-->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOX} ${BOX}" width="${BOX}" height="${BOX}" role="img" aria-label="Kanna">
<defs>
  <clipPath id="lidClip"><rect x="-60" y="-6" width="120" height="130"/></clipPath>
  <radialGradient id="furShade" cx="32%" cy="20%" r="92%">
    <stop offset="0%" stop-color="#ffbcd1"/><stop offset="48%" stop-color="#ff8fb0"/>
    <stop offset="100%" stop-color="#df6f8f"/>
  </radialGradient>
  <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
    <feGaussianBlur stdDeviation="46"/>
  </filter>
${defs.map((d) => `  ${d}`).join("\n")}
</defs>

${groups.join("\n")}
</svg>
`;

  writeFileSync(join(HERE, "kanna.svg"), svg);
  console.log(report.join("\n"));
  console.log(`kanna.svg: ${POSE_NAMES.length} poses, ${svg.length} bytes`);

  if (debugDir) {
    // A gridded contact sheet per pose, in master coordinates — this is how the
    // cut polygons in kanna-rig.mjs are placed.
    mkdirSync(debugDir, { recursive: true });
    const { poseSvg } = await import("./kanna-rig.mjs");
    for (const name of POSE_NAMES) {
      const height = rawPoseHeight(poseSvg(svg, name, { raw: true }), BOX);
      const grid = debugGridElements(BOX, height);
      const ear = EARS[name];
      if (ear) {
        grid.push(
          `<path d="M${ear.tip.map(([x, y]) => `${x} ${y}`).join("L")}Z" fill="none" stroke="#ff0" stroke-width="3"/>`,
          `<circle cx="${ear.pivot[0]}" cy="${ear.pivot[1]}" r="7" fill="#ff0"/>`,
        );
      }
      const doc = poseSvg(svg, name, { raw: true }).replace(
        "</svg>",
        `<g id="grid">${grid.join("")}</g></svg>`,
      );
      const file = join(debugDir, `${name}.svg`);
      writeFileSync(file, doc);
      execFileSync("rsvg-convert", ["-b", "#1c1620", file, "-o", join(debugDir, `${name}.png`)]);
    }
    console.log(`debug sheets in ${debugDir}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
