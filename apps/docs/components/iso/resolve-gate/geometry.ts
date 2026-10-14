import {
  axisVector,
  circleRing,
  extrude,
  insetPlan,
  onTop,
  pathOf,
  planOutline,
  radialTicks,
  sideMatrix,
  slabOf,
  topMatrix,
  topTicks,
  type Flat,
  type Plan,
  type Point3,
  type SolidPaths,
} from "../iso-kit";
import {
  BASE,
  BASE_H,
  BEAM_H,
  BEAM_Z,
  BIN,
  BIN_H,
  DIAL,
  DIAL_R,
  DIAL_TOP,
  DIAL_Z,
  DROP_Y,
  FOOT_H,
  HOPPER,
  HOPPER_H,
  OUT_X,
  P,
  POST,
  POST_L,
  POST_R,
  PROBE_X,
  RAIL_D,
  RAIL_FROM,
  RAIL_H,
  RAIL_TO,
  RAIL_TOP,
  RAIL_Y,
  RAIL_Z,
  SCREEN,
  SCREEN_H,
  SCREEN_STAND,
  STEM_R,
  TIP_R,
  TOKEN_D,
  TOKEN_H,
  TOKEN_W,
  at,
} from "./view";

const solid = (plan: Plan, z: number, h: number, steps = 6, bevel = 0) =>
  slabOf(plan, z, h, P, steps, bevel);
const cyl = (cx: number, cy: number, r: number, z: number, h: number, steps = 32) =>
  extrude(circleRing(cx, cy, r, steps), z, h, P, { convex: true });
const ring = (cx: number, cy: number, r: number, z: number, steps = 40) =>
  onTop(circleRing(cx, cy, r, steps), z, P, true);
const seg = (a: Point3, b: Point3) => pathOf([at(a), at(b)]);
const join = (paths: string[]) => paths.join("");

/* ─── Base slab ─────────────────────────────────────────────────────── */

const FEET: [number, number][] = [
  [BASE.x + 14, BASE.y + 12],
  [BASE.x + BASE.w - 14, BASE.y + 12],
  [BASE.x + 14, BASE.y + BASE.d - 12],
  [BASE.x + BASE.w - 14, BASE.y + BASE.d - 12],
];
const SCREWS: [number, number][] = [
  [BASE.x + 7, BASE.y + 7],
  [BASE.x + BASE.w - 7, BASE.y + 7],
  [BASE.x + 7, BASE.y + BASE.d - 7],
  [BASE.x + BASE.w - 7, BASE.y + BASE.d - 7],
];
const PLATE: Plan = { x: BASE.x + 16, y: BASE.y + 6, w: 48, d: 10, r: 2 };

export const BASE_ART = {
  halo: solid(BASE, -BASE_H - FOOT_H, BASE_H).fill,
  feet: FEET.map(([x, y]): [SolidPaths, SolidPaths] => [
    cyl(x, y, 6, -BASE_H - FOOT_H, 1.5),
    cyl(x, y, 4.6, -BASE_H - FOOT_H + 1.5, FOOT_H - 1.5),
  ]),
  slab: solid(BASE, -BASE_H, BASE_H, 8, 1.4),
  groove: planOutline(insetPlan(BASE, 4), 0, P),
  screws: SCREWS.map(([x, y]) => at([x, y, 0])),
  screwRings: join(SCREWS.map(([x, y]) => ring(x, y, 2, 0, 16))),
  plate: solid(PLATE, 0, 0.7, 4),
  plateLine: planOutline(insetPlan(PLATE, 1.4), 0.7, P),
  plateText: topMatrix([PLATE.x + 4, PLATE.y + 2.4], 0.7, P, "x"),
  plateScrews: [
    at([PLATE.x + 3, PLATE.y + PLATE.d / 2, 0.7]),
    at([PLATE.x + PLATE.w - 3, PLATE.y + PLATE.d / 2, 0.7]),
  ],
};

/* ─── Candidate tokens ──────────────────────────────────────────────── */

export const tokenPlan = (cx: number, cy: number): Plan => ({
  x: cx - TOKEN_W / 2,
  y: cy - TOKEN_D / 2,
  w: TOKEN_W,
  d: TOKEN_D,
  r: 2,
});

const tokenArt = (cx: number, cy: number, z: number) => ({
  body: solid(tokenPlan(cx, cy), z, TOKEN_H, 4, 0.6),
  stripe: onTop(
    [
      [cx - TOKEN_W / 4, cy - 1],
      [cx + TOKEN_W / 4, cy - 1],
      [cx + TOKEN_W / 4, cy + 1],
      [cx - TOKEN_W / 4, cy + 1],
    ],
    z + TOKEN_H,
    P,
    true,
  ),
});

/* Three waiting candidates, stacked in the hopper — the inventory a
   provider hands over before anyone has probed a thing. */
export const QUEUED_TOKENS = [0, 1, 2].map((i) =>
  tokenArt(HOPPER.x + HOPPER.w / 2, HOPPER.y + HOPPER.d / 2, 0.5 + i * (TOKEN_H + 0.5)),
);

/* The dead ones that already dropped. */
export const BIN_TOKENS = [tokenArt(BIN.x + 6, DROP_Y + 2, 1), tokenArt(BIN.x + 13, DROP_Y - 1, 1)];

/* ─── Feed hopper ───────────────────────────────────────────────────── */

const WALL = 2;
const HOPPER_WALLS: Plan[] = [
  { x: HOPPER.x, y: HOPPER.y, w: HOPPER.w, d: WALL, r: 1 },
  { x: HOPPER.x, y: HOPPER.y + WALL, w: WALL, d: HOPPER.d - WALL, r: 1 },
  { x: HOPPER.x + HOPPER.w - WALL, y: HOPPER.y + WALL, w: WALL, d: HOPPER.d - WALL, r: 1 },
  { x: HOPPER.x, y: HOPPER.y + HOPPER.d - WALL, w: HOPPER.w, d: WALL, r: 1 },
];

export const HOPPER_ART = {
  walls: HOPPER_WALLS.map((plan) => solid(plan, 0, HOPPER_H, 3, 0.4)),
  rims: join(HOPPER_WALLS.map((plan) => planOutline(insetPlan(plan, 0.5), HOPPER_H, P))),
  label: sideMatrix([HOPPER.x + 2.5, HOPPER.y + HOPPER.d], 9.5, P, "right"),
  /* The slot in the right wall the next token leaves through. */
  slot: seg(
    [HOPPER.x + HOPPER.w, HOPPER.y + HOPPER.d / 2 - 4, RAIL_TOP],
    [HOPPER.x + HOPPER.w, HOPPER.y + HOPPER.d / 2 + 4, RAIL_TOP],
  ),
};

/* ─── Rail ──────────────────────────────────────────────────────────── */

const RAIL: Plan = {
  x: RAIL_FROM - 4,
  y: RAIL_Y - RAIL_D / 2,
  w: RAIL_TO - RAIL_FROM + 8,
  d: RAIL_D,
  r: 2,
};
const RAIL_TICKS = topTicks(RAIL_FROM, RAIL_TO, 5, 4, RAIL.y + RAIL.d, RAIL_TOP, [1.6, 3], P, "x");

export const RAIL_ART = {
  rail: solid(RAIL, RAIL_Z, RAIL_H, 4, 0.7),
  /* The channel the pill rides in — an inset line along its top. */
  channel: onTop(
    [
      [RAIL_FROM - 2, RAIL_Y - 2.4],
      [RAIL_TO + 2, RAIL_Y - 2.4],
      [RAIL_TO + 2, RAIL_Y + 2.4],
      [RAIL_FROM - 2, RAIL_Y + 2.4],
    ],
    RAIL_TOP,
    P,
    true,
  ),
  ticksMinor: RAIL_TICKS.minor,
  ticksMajor: RAIL_TICKS.major,
  stop: solid(
    { x: RAIL_TO + 1, y: RAIL_Y - RAIL_D / 2 - 0.5, w: 3, d: RAIL_D + 1, r: 0.8 },
    RAIL_TOP,
    2.6,
    3,
  ),
  screws: [at([RAIL.x + 4, RAIL_Y, RAIL_TOP]), at([RAIL.x + RAIL.w - 4, RAIL_Y, RAIL_TOP])],
};

/* ─── Gate frame ────────────────────────────────────────────────────── */

const POST_PLANS: Plan[] = [POST_L, POST_R].map((x) => ({
  x,
  y: RAIL_Y - POST / 2 - 1,
  w: POST,
  d: POST + 2,
  r: 1.5,
}));
const BEAM: Plan = { x: POST_L - 2.5, y: RAIL_Y - 8, w: POST_R + POST - POST_L + 5, d: 16, r: 2 };

export const GATE_ART = {
  feet: POST_PLANS.map((plan) => solid(insetPlan(plan, -2.5), RAIL_TOP, 2, 3)),
  footScrews: POST_PLANS.flatMap((plan) => [
    at([plan.x - 1, plan.y + plan.d / 2, RAIL_TOP + 2]),
    at([plan.x + POST + 1, plan.y + plan.d / 2, RAIL_TOP + 2]),
  ]),
  posts: POST_PLANS.map((plan) => solid(plan, RAIL_TOP + 2, BEAM_Z - RAIL_TOP - 2, 3)),
  beam: solid(BEAM, BEAM_Z, BEAM_H, 4, 0.8),
  beamLine: planOutline(insetPlan(BEAM, 2), BEAM_Z + BEAM_H, P),
  beamScrews: [
    at([BEAM.x + 4, BEAM.y + 4, BEAM_Z + BEAM_H]),
    at([BEAM.x + BEAM.w - 4, BEAM.y + BEAM.d - 4, BEAM_Z + BEAM_H]),
  ],
  /* Knurled thumb knob on the beam — the manual override a `/recover` is. */
  knob: cyl(BEAM.x + BEAM.w - 6, BEAM.y + BEAM.d / 2, 2.6, BEAM_Z + BEAM_H, 3.4, 20),
  knobTop: ring(BEAM.x + BEAM.w - 6, BEAM.y + BEAM.d / 2, 1.2, BEAM_Z + BEAM_H + 3.4, 16),
  label: topMatrix([BEAM.x + 5, BEAM.y + 5.5], BEAM_Z + BEAM_H, P, "x"),
  /* Pointer wedge at the beam's front face, aimed at the gate line. */
  pointer: solid({ x: PROBE_X - 1.6, y: BEAM.y + BEAM.d, w: 3.2, d: 1, r: 0.4 }, BEAM_Z - 5, 5, 2),
};

/* ─── Plunger — the live stamp (drawn inside the moving group) ──────── */

export const PLUNGER_ART = {
  tip: cyl(0, 0, TIP_R, -1.5, 3.5, 28), // tip at local z 0 — group carries world z
  tipRing: ring(0, 0, TIP_R - 1, 2, 24),
  collar: cyl(0, 0, TIP_R - 0.4, 2, 2.4, 24),
  stem: cyl(0, 0, STEM_R, 4.4, 16, 20),
};

/*
 * The return spring — a vertical zigzag hugging the stem between the beam
 * underside and the plunger collar, recomputed as the plunger moves. The
 * kit's coil() winds around a horizontal axis; this one stands on z, so it
 * is drawn as a polyline that alternates around the stem in y.
 */
export function springAt(tipZ: number) {
  const top = BEAM_Z - 2;
  const bottom = tipZ + 5.5;
  const turns = 7;
  const points: Flat[] = [];
  for (let i = 0; i <= turns * 2; i++) {
    const z = top - ((top - bottom) * i) / (turns * 2);
    const y = RAIL_Y + (i % 2 === 0 ? -1 : 1) * (TIP_R + 0.7);
    points.push(at([PROBE_X, y, z]));
  }
  return pathOf(points);
}

/* ─── Dial gauge ────────────────────────────────────────────────────── */

const [DX, DY] = DIAL;
const STAND: Plan = { x: DX - 12, y: DY - 11, w: 24, d: 22, r: 3 };
const DIAL_TICKS = radialTicks(DX, DY, DIAL_R - 2.4, 41, 5, DIAL_TOP, [1.3, 2.4], P);

export const DIAL_ART = {
  stand: solid(STAND, 0, DIAL_Z, 4, 0.6),
  standScrews: [
    at([STAND.x + 3.2, STAND.y + 3.2, DIAL_Z]),
    at([STAND.x + STAND.w - 3.2, STAND.y + 3.2, DIAL_Z]),
    at([STAND.x + 3.2, STAND.y + STAND.d - 3.2, DIAL_Z]),
    at([STAND.x + STAND.w - 3.2, STAND.y + STAND.d - 3.2, DIAL_Z]),
  ],
  puck: cyl(DX, DY, DIAL_R, DIAL_Z, DIAL_TOP - DIAL_Z, 48),
  bezel: ring(DX, DY, DIAL_R - 1, DIAL_TOP, 48),
  face: ring(DX, DY, DIAL_R - 2.4, DIAL_TOP, 48),
  minor: DIAL_TICKS.minor,
  major: DIAL_TICKS.major,
  /* Fail zone on the left arc — the answer a dead stream gets. The pass
     side needs no paint; a needle that swings right is its own answer. */
  failZone: onTop(
    Array.from({ length: 5 }, (_, i) => {
      const a = Math.PI * 0.78 + (i / 4) * Math.PI * 0.22;
      return [DX + Math.sin(a) * (DIAL_R - 4.4), DY - Math.cos(a) * (DIAL_R - 4.4)] as [
        number,
        number,
      ];
    }),
    DIAL_TOP,
    P,
  ),
  crown: solid({ x: DX + DIAL_R - 0.5, y: -2.2, w: 3.8, d: 4.4, r: 1 }, DIAL_Z + 1.5, 3.4, 3),
  lug: solid({ x: DX - 2.5, y: DY - DIAL_R - 3, w: 5, d: 3.4, r: 1 }, DIAL_Z + 1.2, 4.4, 3),
  label: topMatrix([DX - 4.6, DY + 5], DIAL_TOP, P, "x"),
};

/* Needle pivot sits on the dial face; the live layer rewrites `d`. */
export const needleAt = (sweep: number) => {
  const angle = sweep * Math.PI * 0.75 - Math.PI * 0.5; // -1 → left, +1 → right
  const tx = DX + Math.sin(angle) * (DIAL_R - 3.6);
  const ty = DY - Math.cos(angle) * (DIAL_R - 3.6);
  return seg([DX, DY, DIAL_TOP], [tx, ty, DIAL_TOP]);
};
export const NEEDLE_HUB = at([DX, DY, DIAL_TOP]);

/* ─── mpv screen ────────────────────────────────────────────────────── */

const MONITOR: Plan = { x: SCREEN.x, y: SCREEN.y, w: SCREEN.w, d: SCREEN.d, r: 2 };
const MONITOR_Z = SCREEN_STAND;
const FACE_X = SCREEN.x; // the glass faces -x, toward the rail end

/* A vertical rounded face on the -x plane: a stadium ring in y-z. */
const faceOval = (x: number, cy: number, cz: number, ry: number, rz: number, steps = 28) => {
  const points: Flat[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    points.push(at([x, cy + Math.cos(a) * ry, cz + Math.sin(a) * rz]));
  }
  return pathOf(points, true);
};

export const SCREEN_ART = {
  foot: solid(
    { x: SCREEN.x + 4, y: SCREEN.y + 6, w: SCREEN.w - 8, d: SCREEN.d - 12, r: 2 },
    0,
    1.4,
    3,
  ),
  stand: solid(
    { x: SCREEN.x + 6, y: SCREEN.y + SCREEN.d / 2 - 3, w: SCREEN.w - 12, d: 6, r: 1.5 },
    1.4,
    SCREEN_STAND - 1.4,
    3,
  ),
  body: solid(MONITOR, MONITOR_Z, SCREEN_H, 4, 0.8),
  glassRing: faceOval(FACE_X, SCREEN.y + SCREEN.d / 2, MONITOR_Z + SCREEN_H / 2, 7, 5.8),
  glow: faceOval(FACE_X - 0.1, SCREEN.y + SCREEN.d / 2, MONITOR_Z + SCREEN_H / 2, 5.6, 4.6),
  screws: [
    at([FACE_X, SCREEN.y + 2.5, MONITOR_Z + 2.5]),
    at([FACE_X, SCREEN.y + SCREEN.d - 2.5, MONITOR_Z + 2.5]),
    at([FACE_X, SCREEN.y + 2.5, MONITOR_Z + SCREEN_H - 2.5]),
    at([FACE_X, SCREEN.y + SCREEN.d - 2.5, MONITOR_Z + SCREEN_H - 2.5]),
  ],
  label: topMatrix([SCREEN.x + 4, SCREEN.y + 7], MONITOR_Z + SCREEN_H, P, "y"),
  /* Where a passed token parks — a landing pad at the screen's foot. */
  pad: solid({ x: OUT_X - 3, y: RAIL_Y - 5, w: 8, d: 10, r: 1.5 }, 0, 1, 3),
  padLine: planOutline({ x: OUT_X - 3, y: RAIL_Y - 5, w: 8, d: 10, r: 1.5 }, 1, P),
};

/* ─── Reject hopper ─────────────────────────────────────────────────── */

const BIN_WALL = 1.8;
const BIN_WALLS: { plan: Plan; h: number }[] = [
  { plan: { x: BIN.x, y: BIN.y, w: BIN.w, d: BIN_WALL, r: 1 }, h: BIN_H },
  { plan: { x: BIN.x, y: BIN.y + BIN_WALL, w: BIN_WALL, d: BIN.d - BIN_WALL, r: 1 }, h: BIN_H },
  {
    plan: {
      x: BIN.x + BIN.w - BIN_WALL,
      y: BIN.y + BIN_WALL,
      w: BIN_WALL,
      d: BIN.d - BIN_WALL,
      r: 1,
    },
    h: BIN_H,
  },
  { plan: { x: BIN.x, y: BIN.y + BIN.d - BIN_WALL, w: BIN.w, d: BIN_WALL, r: 1 }, h: BIN_H - 3 }, // front sits lower so the pile shows
];

export const BIN_ART = {
  walls: BIN_WALLS.map(({ plan, h }) => solid(plan, 0, h, 3, 0.4)),
  rims: join(BIN_WALLS.map(({ plan, h }) => planOutline(insetPlan(plan, 0.4), h, P))),
  /* The chute lip that catches a failed token off the rail's front edge. */
  chute: solid(
    { x: BIN.x + 4, y: RAIL_Y + RAIL_D / 2, w: BIN.w - 8, d: BIN.y - RAIL_D / 2 - RAIL_Y, r: 1 },
    RAIL_TOP - 1.4,
    1.4,
    3,
  ),
  label: sideMatrix([BIN.x + 2.5, BIN.y + BIN.d], 5.5, P, "right"),
};

/* ─── Cables ────────────────────────────────────────────────────────── */

export const CABLE_DIAL = {
  from: at([POST_R + POST / 2 + 1, RAIL_Y + POST / 2, BEAM_Z - 6]),
  via: [at([DX - DIAL_R - 3, DY + 8, 14])],
  to: at([DX, DY - DIAL_R - 1.5, DIAL_Z + 3]),
};
export const CABLE_SCREEN = {
  from: at([BEAM.x + BEAM.w - 4, BEAM.y - 2, BEAM_Z + 2]),
  via: [at([SCREEN.x + SCREEN.w / 2, SCREEN.y - 8, 18])],
  to: at([SCREEN.x + SCREEN.w / 2, SCREEN.y + 2, MONITOR_Z + SCREEN_H - 3]),
};

/* ─── The moving token's art (group carries it along the rail) ──────── */

export const TOKEN_ART = tokenArt(0, 0, RAIL_TOP);

/* World→screen delta vectors — live code translates groups in world
   units without re-projecting whole parts. */
export const worldShift = (dx: number, dy: number, dz: number) => {
  const [sx, sy] = axisVector(P, [dx, dy, dz]);
  return `translate(${Math.round(sx * 10) / 10} ${Math.round(sy * 10) / 10})`;
};
export const tokenShift = (x: number, tip: number) =>
  worldShift(x, tip * DROP_Y, -tip * tip * (RAIL_TOP + 2));
export const plungerShift = (tipZ: number) => worldShift(PROBE_X, RAIL_Y, tipZ);
