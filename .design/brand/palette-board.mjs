// =============================================================================
// palette-board.mjs — render a palette as a swatch + live-CLI-mock board (SVG->view)
//
// Run: bun .design/brand/palette-board.mjs
// Produces current.svg / proposed.svg so we can judge hierarchy & dynamics by eye.
// =============================================================================

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---- CURRENT Sakura tokens (packages/design/src/tokens.ts) ----
const CURRENT = {
  name: "Current Sakura",
  bg: "#140d11", surface: "#1d141a", elevated: "#271b23", active: "#34232e",
  line: "#43303a", lineStrong: "#5c4351",
  text: "#f3eaef", textDim: "#cebcc5", muted: "#9a8a93", dim: "#6c5e66",
  accent: "#f28ea0", accentDeep: "#cb6178", accentSoft: "#f6c4cd", accentFill: "#2d161e",
  ok: "#84dcc2", warn: "#cb6178", danger: "#ff5454", info: "#9a8a93", milestone: "#b884d6",
  anime: "#ef7d9b", series: "#6cc6bf", movie: "#e7c163",
};

// ---- PROPOSED: neutral warm-charcoal ramp, rose reserved for brand/focus, ----
// ---- vivid distinct semantics incl. a cool info-blue, balanced content triad ----
const PROPOSED = {
  name: "Proposed — Ember Dusk",
  // near-neutral warm ink ramp, clear lightness steps (hierarchy you can see)
  bg: "#100b0f", surface: "#1c1620", elevated: "#2a2030", active: "#3a2b40",
  line: "#473b51", lineStrong: "#62526c",
  // text ramp with real spread
  text: "#f6eff4", textDim: "#cabfca", muted: "#968a98", dim: "#665b69",
  // brand accent — brighter, reserved for focus/selection/brand only
  accent: "#ff8fb0", accentDeep: "#d85f86", accentSoft: "#ffc6d8", accentFill: "#2c1622",
  // semantics — vivid, each its own hue; warn pushed to orange so it splits from movie-gold
  ok: "#54d6a0", warn: "#f59a3c", danger: "#ff5d5d", info: "#5fb6ff", milestone: "#8b7bf0",
  // content triad — evenly separated, none competes with brand-rose, warn-orange, or milestone-indigo
  anime: "#c98bff", series: "#4fd1c5", movie: "#f4c45c",
};

const FONT = "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace";
const W = 720;
const H = 560;

function rect(x, y, w, h, fill, rx = 0, extra = "") {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"${extra}/>`;
}
function text(x, y, s, fill, size = 13, weight = 400, extra = "") {
  const esc = String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}"${extra}>${esc}</text>`;
}

function ramp(p, x, y) {
  const steps = [
    ["bg", p.bg], ["surface", p.surface], ["elevated", p.elevated],
    ["active", p.active], ["line", p.line], ["lineStrong", p.lineStrong],
  ];
  let out = text(x, y - 8, "SURFACE RAMP", p.muted, 10, 600, ' letter-spacing="1.5"');
  steps.forEach((s, i) => {
    out += rect(x + i * 56, y, 52, 34, s[1], 4, ' stroke="#000" stroke-opacity="0.25"');
    out += text(x + i * 56, y + 48, s[0], p.dim, 8);
  });
  return out;
}

function chips(p, x, y, label, items) {
  let out = text(x, y - 8, label, p.muted, 10, 600, ' letter-spacing="1.5"');
  items.forEach((it, i) => {
    out += rect(x + i * 78, y, 70, 26, it[1], 13);
    out += text(x + i * 78 + 10, y + 17, it[0], p.bg, 11, 600);
  });
  return out;
}

// realistic mini CLI mock — the real test of hierarchy in context
function mock(p, x, y) {
  const w = 340;
  let out = rect(x, y, w, 250, p.surface, 8, ' stroke="' + p.line + '"');
  // tab row: one active rose pill, rest muted
  const tabs = ["All", "Anime", "Series", "Movies"];
  let tx = x + 14;
  out += text(x + 14, y + 6, "", p.muted); // spacer
  tabs.forEach((t, i) => {
    const active = i === 1;
    if (active) out += rect(tx - 6, y + 14, t.length * 8 + 12, 20, p.accentFill, 5, ' stroke="' + p.accent + '"');
    out += text(tx, y + 28, t, active ? p.accent : p.muted, 12, active ? 700 : 400);
    tx += t.length * 8 + 18;
  });
  // list rows with kind tags; row 2 selected
  const rows = [
    ["19:30", "Frieren", "E29", "anime", "airs today", p.accent],
    ["Tue", "Slow Horses", "S05E03", "series", "3 new", p.ok],
    ["Jun 9", "Dune: Part Three", "", "movie", "releases Jun 9", p.info],
  ];
  rows.forEach((r, i) => {
    const ry = y + 54 + i * 40;
    const selected = i === 1;
    if (selected) out += rect(x + 6, ry - 4, w - 12, 36, p.active, 5);
    const kindColor = r[3] === "anime" ? p.anime : r[3] === "series" ? p.series : p.movie;
    out += text(x + 16, ry + 14, r[0], p.dim, 11);
    out += text(x + 70, ry + 14, r[1], selected ? p.text : p.textDim, 12, selected ? 700 : 400);
    // kind dot + code
    out += `<circle cx="${x + 70}" cy="${ry + 24}" r="3" fill="${kindColor}"/>`;
    out += text(x + 80, ry + 27, r[3] + (r[2] ? "  " + r[2] : ""), kindColor, 9);
    out += text(x + w - 16, ry + 14, r[4], r[5], 10, 600, ' text-anchor="end"');
  });
  // progress bar + status line
  const py = y + 186;
  out += rect(x + 16, py, w - 32, 6, p.elevated, 3);
  out += rect(x + 16, py, (w - 32) * 0.62, 6, p.accentDeep, 3);
  out += text(x + 16, py + 28, "● ready", p.ok, 11, 600);
  out += text(x + 90, py + 28, "◷ resolving", p.warn, 11);
  out += text(x + 200, py + 28, "× error", p.danger, 11);
  out += text(x + 16, py + 46, "← → day · ⇥ type · enter open", p.dim, 10);
  return out;
}

function board(p) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  ${rect(0, 0, W, H, p.bg)}
  ${text(28, 36, "KUNAI", p.accent, 20, 800, ' letter-spacing="3"')}
  ${text(120, 36, p.name, p.muted, 12, 400)}
  ${ramp(p, 28, 78)}
  ${chips(p, 28, 168, "SEMANTIC", [["ok", p.ok], ["warn", p.warn], ["danger", p.danger], ["info", p.info]])}
  ${chips(p, 28, 232, "CONTENT", [["anime", p.anime], ["series", p.series], ["movie", p.movie], ["brand", p.accent]])}
  ${text(28, 312, "TEXT", p.muted, 10, 600, ' letter-spacing="1.5"')}
  ${text(28, 336, "primary text", p.text, 14, 600)}
  ${text(28, 358, "dim text", p.textDim, 13)}
  ${text(28, 380, "muted label", p.muted, 12)}
  ${text(28, 400, "disabled / hint", p.dim, 11)}
  ${mock(p, 360, 78)}
</svg>`;
}

writeFileSync(join(HERE, "palette-current.svg"), board(CURRENT));
writeFileSync(join(HERE, "palette-proposed.svg"), board(PROPOSED));
console.log("Wrote palette-current.svg and palette-proposed.svg");
