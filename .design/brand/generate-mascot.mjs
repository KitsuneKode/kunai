// =============================================================================
// generate-mascot.mjs — pixel-fox mascot generator (ASCII grid -> SVG)
//
// The grid below is the SOURCE OF TRUTH for the Kunai mascot. Edit a cell, run
// `bun .design/brand/generate-mascot.mjs` (or `node …`), and both the static and
// animated SVGs regenerate. Colors are the real Sakura tokens (packages/design).
//
// Legend:
//   .  transparent      R  fur rose   (#f28ea0 accent)
//   D  outline / shadow (#cb6178)      C  cream face (#f6c4cd accentSoft)
//   E  eye / dark       (#140d11 bg)   N  nose       (#7c3044 accentDim)
// =============================================================================

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

const COLORS = {
  R: "#f28ea0",
  D: "#cb6178",
  C: "#f6c4cd",
  E: "#140d11",
  N: "#7c3044",
};

// 16 cols × 14 rows fox bust. Two pixel eyes (E), cream muzzle + cheeks (C),
// rose fur (R) with deep-rose outline (D). Reads as a fox even as plain text.
const GRID = [
  "...D........D...",
  "..DRD......DRD..",
  "..DRCD....DCRD..",
  "..DRRD....DRRD..",
  ".DRRRDDDDRRRRD..",
  ".DRRRRRRRRRRRRD.",
  ".RRRRRRRRRRRRRR.",
  ".RREERRRRRREERR.",
  ".RRRRRRCCRRRRRR.",
  ".RCCRRRCCRRRCCR.",
  ".RCCRRRNNRRRCCR.",
  "..DRRRRNNRRRRD..",
  "...DRRRRRRRRD...",
  ".....DRRRRD.....",
];

const CELL = 8;
const COLS = GRID[0].length;
const ROWS = GRID.length;
const PAD = CELL; // breathing room around the bust
const W = COLS * CELL + PAD * 2;
const H = ROWS * CELL + PAD * 2;

function cells() {
  const out = [];
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const ch = GRID[r][c];
      if (ch === "." || !COLORS[ch]) continue;
      out.push({ r, c, ch, x: PAD + c * CELL, y: PAD + r * CELL });
    }
  }
  return out;
}

function rect(x, y, w, h, fill, extra = "") {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${extra}/>`;
}

function bodyRects(list) {
  return list.map((cell) => rect(cell.x, cell.y, CELL, CELL, COLORS[cell.ch])).join("\n    ");
}

// Bounding box of the eye cells, so the animated eyelids land exactly on them.
function eyeBoxes(list) {
  const eyes = list.filter((cell) => cell.ch === "E");
  const groups = new Map();
  for (const e of eyes) {
    // group adjacent eye cells on the same row into one lid
    const key = `${e.r}:${Math.round(e.c / 4)}`;
    const g = groups.get(key) ?? { x: e.x, y: e.y, x2: e.x + CELL, y2: e.y + CELL };
    g.x = Math.min(g.x, e.x);
    g.y = Math.min(g.y, e.y);
    g.x2 = Math.max(g.x2, e.x + CELL);
    g.y2 = Math.max(g.y2, e.y + CELL);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({ x: g.x, y: g.y, w: g.x2 - g.x, h: g.y2 - g.y }));
}

const list = cells();
const body = bodyRects(list);

// ---- static SVG (renders everywhere, including GitHub) ----
const staticSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Kunai fox mascot" shape-rendering="crispEdges">
  <title>Kunai</title>
  <g>
    ${body}
  </g>
</svg>
`;

// ---- animated SVG (browser / docs site; GitHub strips SMIL so use the GIF there) ----
const lids = eyeBoxes(list)
  .map(
    (b) =>
      `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${COLORS.R}" opacity="0">
        <animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;0.45;0.5;0.55;1" dur="4.2s" repeatCount="indefinite"/>
      </rect>`,
  )
  .join("\n    ");

const animatedSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Kunai fox mascot (animated)" shape-rendering="crispEdges">
  <title>Kunai — idle</title>
  <g>
    <animateTransform attributeName="transform" type="translate" values="0 0; 0 -1.5; 0 0" keyTimes="0;0.5;1" dur="3.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"/>
    ${body}
    ${lids}
  </g>
</svg>
`;

writeFileSync(join(HERE, "kunai-mascot.svg"), staticSvg);
writeFileSync(join(HERE, "kunai-mascot-animated.svg"), animatedSvg);

// Echo the grid as a quick text preview so a human can sanity-check the shape.
console.log("Kunai mascot — text preview:\n");
console.log(GRID.map((row) => row.replace(/\./g, " ")).join("\n"));
console.log(`\nWrote kunai-mascot.svg and kunai-mascot-animated.svg (${W}×${H}).`);
