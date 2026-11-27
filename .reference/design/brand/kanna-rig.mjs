// =============================================================================
// kanna-rig.mjs — poses, cuts and motion for the one layered Kanna SVG
//
// `trace-kanna.mjs` turns raster masters into regions. This file says what each
// pose is made of and what may move:
//
//   POSES       which master a pose is traced from
//   composePose how the traced layers become the pose group in `kanna.svg`
//   poseSvg     one pose out of `kanna.svg` as a standalone document, at an
//               expression and a motion — what every export rasterizes
//
// Construction is fixed by the trace and never redrawn. Motion is a transform
// on a clipped piece of that trace, which only works because the art is flat:
// two pieces of the same fur overlap without a seam, so an ear can be cut out
// and rotated back on top of the head it came from.
//
// All coordinates are in master space — the master resized to BOX wide — which
// is what `trace-kanna.mjs --debug <dir>` grids.
// =============================================================================

import { applyExpression } from "./kanna-expressions.mjs";

export const BOX = 928;
export const PLATE = "#1C1620";
export const FUR = "#FF8FB0";
export const CREAM = "#FFC6D8";

const SHEET = "kanna-model-sheet-v1.png";

/**
 * Where each pose is traced from.
 *
 * The four poses with feet are cut from the model sheet rather than from the
 * split cell files. The sheet's figures overrun its 512px rows, so a cell cut
 * on the grid clips her feet into a flat edge — which is how `idle` and `wait`
 * shipped. Cutting on the gap between the rows (y = 548) keeps the whole fox.
 */
export const POSES = {
  bust: { master: "kanna-sheet-6-bust.png" },
  idle: { master: SHEET, crop: "512x548+0+0" },
  wait: { master: SHEET, crop: "512x548+512+0" },
  seek: { master: "kanna-pose-seek.png" },
  go: { master: "kanna-pose-carry.png", eyes: 1 },
  watch: { master: "kanna-pose-watch.png" },
  oops: { master: SHEET, crop: "512x476+512+548" },
  nap: { master: SHEET, crop: "512x476+0+548" },
  peek: { master: "kanna-pose-peek.png" },
};

export const POSE_NAMES = Object.keys(POSES);

const poly = (points) => `M${points.map(([x, y]) => `${x} ${y}`).join("L")}Z`;
const EVERYWHERE = "M-3000 -3000H6000V6000H-3000Z";
const clipTo = (id, points) => `<clipPath id="${id}"><path d="${poly(points)}"/></clipPath>`;
/**
 * A polygon plus a disc about the pivot. The disc is the same shape at every
 * angle, so a piece cut this way keeps its root planted in the head it turns
 * on however far it is swung.
 */
const clipToRooted = (id, points, [px, py], radius) =>
  `<clipPath id="${id}"><path d="${poly(points)}"/><circle cx="${px}" cy="${py}" r="${radius}"/></clipPath>`;
/** Everything except the given polygons. */
const clipAway = (id, ...shapes) =>
  `<clipPath id="${id}"><path clip-rule="evenodd" d="${EVERYWHERE}${shapes.map(poly).join("")}"/></clipPath>`;

/** Scale a polygon about a point, so a cut piece overlaps the hole it left. */
const grow = (points, [px, py], k) =>
  points.map(([x, y]) => [
    Number((px + (x - px) * k).toFixed(1)),
    Number((py + (y - py) * k).toFixed(1)),
  ]);

/**
 * One ear per pose that can flick: the box above the cut that holds its tip,
 * and the point on the cut it turns about. The ear is never redrawn — the flick
 * is the traced tip, rotated.
 *
 * The cut sits high, where the ear is narrow. A rigid piece turned about a
 * point lifts one end of its cut and drops the other by half its width times
 * the sine of the angle, so a cut across the wide base opens a wedge a
 * terminal-sized render shows as a dark nick; across the tip it is under a
 * pixel. The box only has to hold the tip — nothing else is that high.
 */
export const EARS = {
  bust: { tip: [[520, 185], [520, 30], [820, 30], [820, 185]], pivot: [668, 185] },
  idle: { tip: [[530, 180], [530, 40], [770, 40], [770, 180]], pivot: [657, 180] },
  wait: { tip: [[430, 205], [430, 60], [670, 60], [670, 205]], pivot: [553, 205] },
  watch: { tip: [[540, 330], [540, 190], [780, 190], [780, 330]], pivot: [672, 330] },
  peek: { tip: [[540, 450], [540, 300], [790, 300], [790, 450]], pivot: [678, 450] },
};

/** How far the turned tip reaches back down past the cut, to cover the wedge. */
const EAR_OVERLAP = 16;

// ── seek ────────────────────────────────────────────────────────────────────
//
// The master is a raised paw and nothing else: she stands tall with her ears
// up, which at companion size is `idle` with a foot off the ground. The redraw
// keeps every traced shape and changes the pose — the whole figure pitched
// forward about her hind foot so the chest drops and the tail lifts, both ears
// cut off above the skull and laid back, and the eyes widened at export.
const SEEK = {
  earL: [[360, 515], [360, 280], [591, 280], [591, 421], [545, 425], [500, 438], [465, 455], [435, 477], [402, 517]],
  earR: [[589, 421], [589, 280], [800, 280], [800, 520], [778, 520], [745, 477], [715, 455], [680, 438], [635, 425]],
  // What swings is narrower than what is cut: the cut has to clear the whole
  // crown, but a piece that wide carries a sliver of crown out with the ear.
  pieceL: [[372, 500], [372, 290], [548, 290], [548, 428], [500, 440], [465, 457], [435, 479], [410, 505]],
  pieceR: [[628, 428], [628, 290], [782, 290], [782, 488], [745, 479], [715, 457], [680, 440]],
  pivotL: [468, 472],
  pivotR: [700, 470],
  /** The skull, closing the top of the head where the ears were cut away. */
  dome: "M392 520A222 198 0 0 1 778 520Z",
  root: 62,
  hindFoot: [340, 950],
  lean: 11,
  sweepL: -58,
  sweepR: -50,
};

function composeSeek(L) {
  const s = SEEK;
  const earCream = L.cream.filter((c) => c.box.cy < 520).sort((a, b) => a.box.cx - b.box.cx);
  const bodyCream = L.cream.filter((c) => c.box.cy >= 520);
  const [creamL, creamR] = earCream.map((c) => c.svg);
  const poseDefs = [
    clipAway("seek-skull", s.earL, s.earR),
    clipToRooted("seek-ear-l", s.pieceL, s.pivotL, s.root),
    clipToRooted("seek-ear-r", s.pieceR, s.pivotR, s.root),
  ];
  const ear = (side, pivot, sweep, cream) =>
    `<g class="ear-${side}" transform="rotate(${sweep} ${pivot[0]} ${pivot[1]})">` +
    `<g class="ear-${side}-x"><g clip-path="url(#seek-ear-${side})">${L.fur}${cream ?? ""}</g></g></g>`;
  const body = [
    `<g class="creep">`,
    `<g class="lean" transform="rotate(${s.lean} ${s.hindFoot[0]} ${s.hindFoot[1]})">`,
    `<g clip-path="url(#seek-skull)"><g class="fur">${L.fur}</g></g>`,
    `<path class="skull" d="${s.dome}" fill="${FUR}"/>`,
    `<g class="ears">${ear("r", s.pivotR, s.sweepR, creamR)}${ear("l", s.pivotL, s.sweepL, creamL)}</g>`,
    `<g class="cream">${bodyCream.map((c) => c.svg).join("")}</g>`,
    `<g class="eyes">${L.eyes}</g>`,
    `<g class="nose">${L.nose}</g>`,
    `</g>`,
    `</g>`,
  ].join("\n");
  return { body, poseDefs };
}

// ── peek ────────────────────────────────────────────────────────────────────
//
// The master leans her on a ledge drawn in her own fur colour, so the alpha
// cut ships her welded to a pink slab. The redraw throws the slab away: she is
// cut on the ledge line and her paws hang over it, so whatever sits under her —
// a terminal rule, a section break, the bottom of a 404 — is the edge.
const PEEK = { edge: 938, paws: [[240, 932], [652, 932]] };

function composePeek(L) {
  const poseDefs = [
    `<clipPath id="peek-above"><rect x="-200" y="-200" width="1400" height="${PEEK.edge + 200}"/></clipPath>`,
  ];
  const paws = PEEK.paws
    .map(([cx, cy]) => `<ellipse cx="${cx}" cy="${cy}" rx="80" ry="47" fill="${FUR}"/>`)
    .join("");
  const body = [
    `<g class="head" clip-path="url(#peek-above)"><g class="head-x">`,
    `<g class="fur">${L.fur}</g>`,
    `<g class="cream">${L.cream.map((c) => c.svg).join("")}</g>`,
    `<g class="eyes">${L.eyes}</g>`,
    `<g class="nose">${L.nose}</g>`,
    `</g></g>`,
    `<g class="paws">${paws}</g>`,
  ].join("\n");
  return { body, poseDefs, foot: [445, PEEK.edge] };
}

// ── go ──────────────────────────────────────────────────────────────────────
//
// The dart is plate-coloured and pokes out past her muzzle, so the flood fill
// that cuts the background runs up the shaft and eats the fletching and her
// nose with it. Both are restored here as the one permitted prop, drawn over
// the notch the flood left. Authored against a 3x zoom of the master, hence
// the group transform.
//
// One deliberate change from the master: the point starts at her lip instead
// of past a length of bare shaft. The shaft is plate-coloured, so on a dark
// terminal it vanished and left the point floating in front of her face.
const GO_PROP = `<g transform="translate(528 520) scale(0.33333)">
<ellipse class="nose" cx="686" cy="386" rx="63" ry="46" transform="rotate(-8 686 386)" fill="${PLATE}"/>
<path d="M205 492L335 478C380 490 410 540 432 553L712 538L712 592L432 606C410 615 380 680 350 692L210 698Q190 698 196 678L226 622L200 612Q182 608 182 592Q182 574 200 570L226 566L190 512Q186 494 205 492Z" fill="${PLATE}" stroke="${PLATE}" stroke-width="7" stroke-linejoin="round"/>
<path d="M700 534L915 549Q929 553 915 558L700 594Z" fill="${FUR}"/>
<path d="M474 520L474 546C510 590 604 592 656 538L656 520Z" fill="${CREAM}"/>
</g>`;

function composeGo(L) {
  const body = [
    `<g class="fur">${L.fur}</g>`,
    `<g class="cream">${L.cream.map((c) => c.svg).join("")}</g>`,
    `<g class="eyes">${L.eyes}</g>`,
    `<g class="prop">${GO_PROP}</g>`,
  ].join("\n");
  return { body, poseDefs: [] };
}

/** The layers of a pose, as the group body `kanna.svg` stores. */
export function composePose(name, L) {
  const foot = [L.furBox.cx, L.furBox.y + L.furBox.h];
  if (name === "seek") return { foot, ...composeSeek(L) };
  if (name === "peek") return composePeek(L);
  if (name === "go") return { foot, ...composeGo(L) };
  const body = [
    `<g class="fur">${L.fur}</g>`,
    `<g class="cream">${L.cream.map((c) => c.svg).join("")}</g>`,
    `<g class="eyes">${L.eyes}</g>`,
    `<g class="nose">${L.nose}</g>`,
  ].join("\n");
  return { body, poseDefs: [], foot };
}

// ── reading a pose back out ─────────────────────────────────────────────────

const SHARED_DEFS = /<defs>([\s\S]*?)<\/defs>/u;

function poseGroup(svg, pose) {
  const m = new RegExp(
    `<g id="pose-${pose}" class="pose"([^>]*)>\\n([\\s\\S]*?)\\n</g>(?=\\n<g id="pose-|\\n</svg>)`,
    "u",
  ).exec(svg);
  if (!m) throw new Error(`unknown pose "${pose}" — have: ${POSE_NAMES.join(", ")}`);
  return { attrs: m[1], body: m[2] };
}

/** Squash and stretch about a point: `amount` > 0 presses her down and out. */
export function squashAbout([x, y], amount) {
  const sx = (1 + amount * 0.6).toFixed(4);
  const sy = (1 - amount).toFixed(4);
  return `translate(${x} ${y}) scale(${sx} ${sy}) translate(${-x} ${-y})`;
}

/**
 * Flick the pose's ear: the traced tip, cut on its polygon and turned about
 * the cut. The piece is grown slightly so it overlaps the hole it came from —
 * same fur, so the overlap is invisible and the seam never opens.
 */
function flickEar(pose, inner, degrees) {
  const ear = EARS[pose];
  if (!ear) throw new Error(`pose "${pose}" has no ear to flick`);
  const fur = /<g class="fur">[\s\S]*?<\/g>/u.exec(inner)?.[0] ?? "";
  const cream = /<g class="cream">[\s\S]*?<\/g>/u.exec(inner)?.[0] ?? "";
  const [px, py] = ear.pivot;
  // The piece is the tip plus a band below the cut. Same fur on both sides of
  // it, so the band is invisible at rest and covers the wedge when turned.
  const [[x1, y1], , , [x2, y2]] = ear.tip;
  const piece = [...ear.tip.slice(0, 3), [x2, y2], [x2, y2 + EAR_OVERLAP], [x1, y1 + EAR_OVERLAP]];
  const defs = [clipAway("ear-keep", ear.tip), clipTo("ear-piece", piece)];
  const turned = `${fur.replace('class="fur"', 'class="fur-ear"')}${cream.replace('class="cream"', 'class="cream-ear"')}`;
  const moved = inner
    .replace(fur, `<g clip-path="url(#ear-keep)">${fur}`)
    .replace(
      cream,
      `${cream}</g>\n<g transform="rotate(${degrees} ${px} ${py})"><g clip-path="url(#ear-piece)">${turned}</g></g>`,
    );
  return { inner: moved, defs };
}

/**
 * One pose as a standalone SVG document.
 *
 * The layers come out with the ids the single-pose files used to carry
 * (`#fur`, `#shade`, `#cream`, `#eyes`, `#nose`), so a consumer that lifts
 * `<defs>` and the drawable groups keeps working unchanged.
 *
 * Motion, all optional and all transforms on traced shapes:
 *   expression  an eye shape from kanna-expressions.mjs
 *   ear         degrees to turn the pose's ear tip (see `EARS`)
 *   glance      [dx, dy] to shift both eyes
 *   groups      { className: transform } for the named groups a redrawn pose
 *               exposes — `head-x` on peek, `ear-l-x` / `ear-r-x` on seek
 *   body        a transform for the whole figure, e.g. `squashAbout(foot, 0.03)`
 *
 * `raw` skips the fit transform and keeps the master's own frame, which is what
 * the debug grid needs: cut polygons are written in master coordinates.
 */
export function poseSvg(
  svg,
  pose,
  { expression, ear, glance, groups, body, shading = false, raw = false } = {},
) {
  const { attrs, body: stored } = poseGroup(svg, pose);
  const sharedDefs = SHARED_DEFS.exec(svg)?.[1] ?? "";
  const fit = /transform="([^"]+)"/u.exec(attrs)?.[1];
  const height = Number(/data-h="(\d+)"/u.exec(attrs)?.[1] ?? BOX);
  const extraDefs = [];

  let inner = expression ? applyExpression(stored, expression) : stored;
  if (ear) {
    const flicked = flickEar(pose, inner, ear);
    inner = flicked.inner;
    extraDefs.push(...flicked.defs);
  }
  if (glance) {
    inner = inner.replace(
      '<g class="eyes">',
      `<g class="eyes" transform="translate(${glance[0]} ${glance[1]})">`,
    );
  }
  for (const [name, transform] of Object.entries(groups ?? {})) {
    if (!inner.includes(`<g class="${name}">`)) {
      throw new Error(`pose "${pose}" has no "${name}" group to move`);
    }
    inner = inner.replace(`<g class="${name}">`, `<g class="${name}" transform="${transform}">`);
  }

  const furPath = /<g class="fur">([\s\S]*?)<\/g>/u.exec(inner)?.[1] ?? "";
  inner = inner
    .replace(
      /<g class="fur">([\s\S]*?)<\/g>/u,
      (_all, fur) =>
        `<g id="fur">${fur}</g>\n` +
        `<g id="shade" opacity="${shading ? 1 : 0}" clip-path="url(#furClip)">\n` +
        `  <rect x="0" y="0" width="${BOX}" height="${Math.max(BOX, height)}" fill="url(#furShade)"/>\n` +
        `  <g filter="url(#soft)">\n` +
        `    <ellipse cx="760" cy="880" rx="520" ry="360" fill="#cf6890" opacity="0.34"/>\n` +
        `    <ellipse cx="250" cy="180" rx="330" ry="250" fill="#ffd0e0" opacity="0.30"/>\n` +
        `  </g>\n</g>`,
    )
    .replace(/<g class="(cream|eyes|nose|prop)"/gu, '<g id="$1"');

  if (body) inner = `<g transform="${body}">\n${inner}\n</g>`;
  const viewH = raw ? height : BOX;
  const wrapped = !raw && fit ? `<g transform="${fit}">\n${inner}\n</g>` : inner;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOX} ${viewH}" width="${BOX}" height="${viewH}" role="img" aria-label="Kanna">
<defs>
  <clipPath id="furClip">${furPath}</clipPath>${sharedDefs.trimEnd()}
${extraDefs.map((d) => `  ${d}`).join("\n")}
</defs>

${wrapped}
</svg>
`;
}

/** The point a pose stands on, in master coordinates — the anchor for squash. */
export function poseFoot(svg, pose) {
  const { attrs } = poseGroup(svg, pose);
  const m = /data-foot="(-?\d+) (-?\d+)"/u.exec(attrs);
  if (!m) throw new Error(`pose "${pose}" records no foot`);
  return [Number(m[1]), Number(m[2])];
}

// ── motion ──────────────────────────────────────────────────────────────────

/**
 * The face each pose rests in. `null` means the master already draws it — the
 * half-lid on `watch`, the brow on `oops`, the closed arcs on `nap`.
 */
export const RESTING = {
  bust: "squint",
  idle: "squint",
  wait: "plain",
  seek: "wide",
  go: "plain",
  watch: null,
  oops: null,
  nap: null,
  peek: "wide",
};

/**
 * What each pose does when the terminal can animate her.
 *
 * `frames` are the distinct drawings, `rest` first; each is the options
 * `poseSvg` takes, or a function of the pose's foot for the ones that press
 * her into the ground. `loop` is the order they play in and how long each
 * holds, in milliseconds. A drawing may appear in the loop more than once — the
 * terminal is sent it once.
 *
 * She is never excited, so nothing here is fast or large: a blink, one ear, a
 * breath. The exception is `seek`, which is the only pose that is about
 * movement, and `go`, which is on screen for one beat.
 */
export const MOTION = {
  idle: {
    frames: { rest: {}, blink: { expression: "blink" }, ear: { ear: 9 } },
    loop: [["rest", 3000], ["blink", 120], ["rest", 2300], ["ear", 150]],
  },
  wait: {
    frames: { rest: {}, blink: { expression: "blink" }, ear: { ear: 9 } },
    loop: [["rest", 2400], ["blink", 120], ["rest", 3200], ["ear", 150]],
  },
  seek: {
    frames: {
      rest: {},
      creep: {
        groups: {
          creep: `rotate(3.5 ${SEEK.hindFoot[0]} ${SEEK.hindFoot[1]})`,
          "ear-l-x": `rotate(-8 ${SEEK.pivotL[0]} ${SEEK.pivotL[1]})`,
          "ear-r-x": `rotate(-8 ${SEEK.pivotR[0]} ${SEEK.pivotR[1]})`,
        },
      },
      blink: { expression: "blink" },
    },
    loop: [["rest", 620], ["creep", 520], ["rest", 620], ["creep", 520], ["rest", 260], ["blink", 110]],
  },
  go: {
    frames: {
      rest: {},
      bob: ({ foot }) => ({ body: `translate(0 -16) rotate(-2.5 ${foot[0]} ${foot[1]})` }),
    },
    loop: [["rest", 170], ["bob", 170]],
  },
  watch: {
    frames: { rest: {}, blink: { expression: "blink" }, ear: { ear: 9 } },
    loop: [["rest", 4200], ["blink", 230], ["rest", 2600], ["ear", 150]],
  },
  oops: {
    frames: {
      rest: {},
      blink: { expression: "blink" },
      flinch: ({ foot }) => ({ body: squashAbout(foot, 0.035) }),
    },
    loop: [["rest", 2300], ["blink", 130], ["rest", 1100], ["flinch", 170]],
  },
  nap: {
    frames: {
      rest: {},
      half: ({ foot }) => ({ body: squashAbout(foot, -0.014) }),
      full: ({ foot }) => ({ body: squashAbout(foot, -0.028) }),
    },
    loop: [["rest", 1300], ["half", 260], ["full", 1300], ["half", 260]],
  },
  peek: {
    frames: {
      rest: {},
      blink: { expression: "blink" },
      left: { glance: [-10, 1] },
      right: { glance: [10, 1] },
      duck: { groups: { "head-x": "translate(0 84)" } },
    },
    loop: [
      ["rest", 2200], ["blink", 120], ["rest", 1300], ["left", 800],
      ["right", 800], ["rest", 900], ["duck", 520],
    ],
  },
};

/** The `poseSvg` options for one named frame of a pose's motion. */
export function frameOptions(svg, pose, frame) {
  const spec = MOTION[pose]?.frames[frame];
  if (spec === undefined) throw new Error(`pose "${pose}" has no "${frame}" frame`);
  const options = typeof spec === "function" ? spec({ foot: poseFoot(svg, pose) }) : spec;
  return { expression: RESTING[pose] ?? undefined, ...options };
}
