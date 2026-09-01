// =============================================================================
// trace-kanna.mjs — raster master → layered Kanna SVG
//
// Two steps matter and both are non-obvious:
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
// contract — `#eyes` is what expression swaps.
//
// Usage:  bun .reference/design/brand/trace-kanna.mjs <master.png> <out.svg>
// Requires: ImageMagick 7, vtracer (cargo install vtracer)
// =============================================================================

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BOX = 928;
const PLATE = "#1C1620";
const SENTINEL = "#00FF00";
const FUR = "#FF8FB0";

const master = process.argv[2] ?? join(HERE, "ip-as-logo-batch/kanna-sheet-6-bust.png");
const outPath = process.argv[3] ?? join(HERE, "kanna-bust.svg");

const work = mkdtempSync(join(tmpdir(), "kanna-trace-"));
try {
  execFileSync("magick", [
    "-size", "1x1", `xc:${SENTINEL}`, `xc:${PLATE}`, "xc:#ff8fb0", "xc:#ffc6d8",
    "+append", join(work, "palette.png"),
  ]);
  execFileSync("magick", [
    master, "-resize", `${BOX}x`,
    "-fuzz", "18%", "-fill", SENTINEL, "-floodfill", "+0+0", PLATE,
    "+dither", "-remap", join(work, "palette.png"), join(work, "flat.png"),
  ]);
  execFileSync("vtracer", [
    "--input", join(work, "flat.png"), "--output", join(work, "traced.svg"),
    "--colormode", "color", "--hierarchical", "cutout", "--mode", "spline",
    "--filter_speckle", "8", "--color_precision", "8", "--gradient_step", "0",
    "--corner_threshold", "60", "--segment_length", "4", "--path_precision", "2",
  ]);

  const traced = readFileSync(join(work, "traced.svg"), "utf8");
  const paths = [...traced.matchAll(/<path\b[^>]*?\/?>/gu)].map((m) => {
    const tag = m[0];
    const fill = /fill="([^"]+)"/u.exec(tag)?.[1] ?? "";
    const d = /\bd="([^"]+)"/u.exec(tag)?.[1] ?? "";
    const t = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/u.exec(tag);
    return { fill, d, tx: t ? Number(t[1]) : 0, ty: t ? Number(t[2]) : 0 };
  });

  const isNear = (hex, target) => {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [a, b] = [p(hex), p(target)];
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 24;
  };

  // The sentinel path is the cut-away background; it is what makes her alpha.
  const drawable = paths.filter((p) => !isNear(p.fill, SENTINEL));
  const fur = drawable.find((p) => isNear(p.fill, FUR));
  const dark = drawable.filter((p) => isNear(p.fill, PLATE));
  const cream = drawable.filter((p) => !isNear(p.fill, FUR) && !isNear(p.fill, PLATE));
  if (!fur) throw new Error("no fur silhouette found — did the remap run?");
  if (dark.length < 3) throw new Error(`expected 2 eyes + 1 nose, found ${dark.length} dark regions`);

  // The nose sits between and below the eyes, and is the widest-but-shortest of
  // the three: sorting by path length separates it without hardcoding geometry.
  const byLen = [...dark].sort((a, b) => b.d.length - a.d.length);
  const eyes = byLen.slice(0, 2).sort((a, b) => a.tx - b.tx);
  const nose = byLen.slice(2);

  const el = (p, cls) =>
    `<path${cls ? ` class="${cls}"` : ""} transform="translate(${p.tx.toFixed(1)} ${p.ty.toFixed(1)})" d="${p.d}" fill="${p.fill}"/>`;

  // Each eye is wrapped in a group translated to its own centre, so an
  // expression is a transform on `.eye-x` — rotate, squash, scale — and never a
  // redrawn shape. Measured by rasterizing the path alone: vtracer mixes
  // relative commands, so the numbers in `d` are not a bounding box.
  const PAD = 400;
  const eyeCentre = (p) => {
    const f = join(work, "eye.svg");
    writeFileSync(
      f,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${BOX + PAD * 2}" height="${BOX + PAD * 2}">` +
        `<path transform="translate(${PAD} ${PAD})" d="${p.d}" fill="#000"/></svg>`,
    );
    const info = execFileSync("magick", ["-background", "none", f, "-trim", "-format", "%wx%h%X%Y", "info:"], {
      encoding: "utf8",
    }).trim();
    const m = /^(\d+)x(\d+)([+-]\d+)([+-]\d+)$/u.exec(info);
    if (!m) throw new Error(`could not measure an eye: ${info}`);
    const [w, h, x, y] = m.slice(1).map(Number);
    return { cx: x - PAD + w / 2, cy: y - PAD + h / 2, w, h };
  };

  const eyeGroup = (p, side) => {
    const c = eyeCentre(p);
    const ox = (p.tx + c.cx).toFixed(1);
    const oy = (p.ty + c.cy).toFixed(1);
    return (
      `<g class="eye eye-${side}" data-w="${c.w}" data-h="${c.h}" transform="translate(${ox} ${oy})">` +
      `<g class="eye-x">` +
      `<path transform="translate(${(-c.cx).toFixed(1)} ${(-c.cy).toFixed(1)})" d="${p.d}" fill="${p.fill}"/>` +
      `</g></g>`
    );
  };

  const svg = `<!--
  Kanna — generated by trace-kanna.mjs. Do not hand-edit; re-run instead.

  Groups are the character contract:
    #fur          silhouette
    #shade        painterly layer, opacity 0 — a per-surface dial, not a global choice
    #eyes         swapped to change expression; the paths are never redrawn
    #cream #nose  ears, muzzle, bib / nose

  Source: ${master.replace(/^.*\//u, "")}
-->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOX} ${BOX}" width="${BOX}" height="${BOX}" role="img" aria-label="Kanna">
<defs>
  <clipPath id="furClip">${el(fur)}</clipPath>
  <clipPath id="lidClip"><rect x="-60" y="-6" width="120" height="130"/></clipPath>
  <radialGradient id="furShade" cx="32%" cy="20%" r="92%">
    <stop offset="0%" stop-color="#ffbcd1"/><stop offset="48%" stop-color="#ff8fb0"/>
    <stop offset="100%" stop-color="#df6f8f"/>
  </radialGradient>
  <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
    <feGaussianBlur stdDeviation="46"/>
  </filter>
</defs>

<g id="fur">${el(fur)}</g>
<g id="shade" opacity="0" clip-path="url(#furClip)">
  <rect x="0" y="0" width="${BOX}" height="${BOX}" fill="url(#furShade)"/>
  <g filter="url(#soft)">
    <ellipse cx="760" cy="880" rx="520" ry="360" fill="#cf6890" opacity="0.34"/>
    <ellipse cx="250" cy="180" rx="330" ry="250" fill="#ffd0e0" opacity="0.30"/>
  </g>
</g>
<g id="cream">${cream.map((p) => el(p)).join("")}</g>
<g id="eyes">${eyes.map((p, i) => eyeGroup(p, i === 0 ? "l" : "r")).join("")}</g>
<g id="nose">${nose.map((p) => el(p)).join("")}</g>
</svg>
`;

  writeFileSync(outPath, svg);
  console.log(
    `${outPath.replace(/^.*\//u, "")}: ${drawable.length} paths ` +
      `(fur, ${cream.length} cream, 2 eyes, ${nose.length} nose), ${svg.length} bytes`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
