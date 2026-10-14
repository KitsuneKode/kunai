import { iso, type Flat, type Point3, type Projection } from "../iso-kit";

/*
 * The resolve gate, laid out in world units: x runs feed → mpv, y runs
 * back → front, z is up. The base slab top sits at z = 0 so every part
 * standing on it takes a positive height.
 */
export const WIDTH = 400;
export const HEIGHT = 300;
export const P: Projection = { origin: [190, 222], scale: 1.62 };

export const at = (point: Point3): Flat => iso(point, P);

/* Base */
export const BASE = { x: -78, y: -36, w: 156, d: 72, r: 4 };
export const BASE_H = 8;
export const FOOT_H = 3;

/* Rail — a channel along y = 0 the candidate pill slides down */
export const RAIL_Y = 0;
export const RAIL_FROM = -52;
export const RAIL_TO = 52;
export const RAIL_Z = 0;
export const RAIL_H = 3;
export const RAIL_D = 10;
export const RAIL_TOP = RAIL_Z + RAIL_H;

/* The candidate token — a rounded pill riding the rail */
export const TOKEN_H = 5;
export const TOKEN_W = 10;
export const TOKEN_D = 7;

/* Feed hopper, back-left — where unprobed candidates queue */
export const HOPPER = { x: -74, y: -32, w: 20, d: 20, r: 2 };
export const HOPPER_H = 10;
export const SLOT_X = -50; // where tokens enter the rail

/* Gate frame — two posts and a beam over the rail */
export const POST_L = -4;
export const POST_R = 10;
export const POST = 4.5;
export const BEAM_Z = 40;
export const BEAM_H = 4.5;

/* Probe — the plunger that stamps the candidate. Its x is the gate line. */
export const PROBE_X = 3;
export const PLUNGER_HOME = 36; // plunger tip z at rest
export const PLUNGER_TOUCH = 9; // tip z when it stamps the token (token top ~8)
export const STEM_R = 1.4;
export const TIP_R = 3.2;

/* Dial gauge on a stand, front-right */
export const DIAL = [30, 20] as const;
export const DIAL_STAND_H = 10;
export const DIAL_R = 12;
export const DIAL_H = 6;
export const DIAL_Z = DIAL_STAND_H;
export const DIAL_TOP = DIAL_Z + DIAL_H;
export const DIAL_SPAN = 40;

/* mpv screen at the rail's end — the destination a probed stream earns */
export const SCREEN = { x: 58, y: -24, w: 18, d: 22, r: 2 };
export const SCREEN_STAND = 5;
export const SCREEN_H = 16;
export const OUT_X = 56; // where a passing token rests

/* Reject hopper, front of the gate — where dead candidates fall */
export const BIN = { x: -4, y: 14, w: 20, d: 20, r: 2 };
export const BIN_H = 11;
export const DROP_Y = 22; // token's world y once it tips in
