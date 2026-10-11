/**
 * How Kanna's body moves when she walks.
 *
 * Pure on purpose, like `roamer-machine.ts`: a gait is a function from a point
 * in the stride to a set of joint angles, and every rule here (which legs pair
 * up, how long a foot stays planted, when the knee folds) can be pinned by a
 * test without a browser or a clock. Nothing in this file reads the DOM; the
 * rig that applies a pose to the drawing lives with the component.
 *
 * ## Why the stride is driven by distance, not time
 *
 * The old walk flipped a 190ms flag and bobbed one still image, so her feet
 * kept time whether or not she was getting anywhere: she skated when slow and
 * jittered when she stopped. Here the phase advances by the pixels she actually
 * travelled (`advancePhase`), so the legs speed up as she accelerates, slow as
 * she eases into a stop, and halt on the same frame she does.
 *
 * ## Conventions
 *
 * She faces right in the drawing. Angles are in degrees and follow SVG:
 * positive rotates clockwise, which for a leg hanging straight down swings the
 * foot BACK (towards the tail). Negative reaches forward. Offsets are in the
 * 320-unit viewBox the drawing is authored in.
 */

export type LegAngles = {
  /** Rotation at the hip, which swings the whole leg. */
  readonly hip: number;
  /** Rotation at the knee, relative to the thigh. Folds the shin and paw up. */
  readonly knee: number;
};

export type FoxPose = {
  /** Vertical offset of the whole body, in viewBox units. Negative is up. */
  readonly bodyY: number;
  /** Nose-up (negative) or nose-down (positive) tilt of the torso. */
  readonly bodyPitch: number;
  /** Extra vertical offset of the head over the body, for follow-through. */
  readonly headY: number;
  readonly headPitch: number;
  readonly tail: number;
  readonly earNear: number;
  readonly earFar: number;
  readonly frontNear: LegAngles;
  readonly frontFar: LegAngles;
  readonly backNear: LegAngles;
  readonly backFar: LegAngles;
};

/** Thigh reach, forward and back, at the extremes of a stride. */
const REACH_FORWARD = -27;
const REACH_BACK = 25;
/** How far the shin folds up at the middle of a swing. */
const KNEE_LIFT = 54;
/** A planted leg is not locked straight; a slight bend reads as weight. */
const KNEE_PLANTED = 7;
/** Fraction of the stride a foot spends on the ground. A walk is above half. */
const STANCE_FRACTION = 0.55;
/** Hind legs trail the diagonal front leg by this much of a stride. */
const HIND_LAG = 0.05;

function wrap(phase: number): number {
  const wrapped = phase % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function smoothstep(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * One leg through one stride, `q` in [0, 1).
 *
 * Stance is linear: the foot is planted and the body passes over it, so the
 * thigh sweeps at constant rate and the foot holds still against the ground.
 * Swing eases in and out, because a foot picked up and put down accelerates and
 * decelerates, and the knee folds on a half-sine so it lifts and lands cleanly
 * at both ends instead of snapping.
 */
export function legAngles(q: number): LegAngles {
  const phase = wrap(q);
  if (phase < STANCE_FRACTION) {
    const t = phase / STANCE_FRACTION;
    return { hip: lerp(REACH_FORWARD, REACH_BACK, t), knee: KNEE_PLANTED };
  }
  const t = (phase - STANCE_FRACTION) / (1 - STANCE_FRACTION);
  return {
    hip: lerp(REACH_BACK, REACH_FORWARD, smoothstep(t)),
    knee: KNEE_PLANTED + KNEE_LIFT * Math.sin(Math.PI * t),
  };
}

const TAU = Math.PI * 2;

/**
 * The whole body at one point in the stride, `phase` in [0, 1).
 *
 * Diagonal pairs move together (near front with far hind, far front with near
 * hind), which is how a walking or trotting canine loads its weight. The torso
 * bobs twice per stride, once per diagonal footfall; the head and tail answer
 * a beat later, because they hang off the body rather than drive it.
 */
export function gaitPose(phase: number): FoxPose {
  const p = wrap(phase);
  const bounce = (1 - Math.cos(2 * TAU * p)) / 2; // 0 at each footfall, 1 between
  const lagged = (1 - Math.cos(2 * TAU * (p - 0.07))) / 2;
  return {
    bodyY: -14 * bounce,
    bodyPitch: 2.2 * Math.sin(2 * TAU * (p + 0.1)),
    headY: 5 * (lagged - bounce),
    headPitch: -3.2 * Math.sin(2 * TAU * (p - 0.05)),
    tail: 9 + 11 * Math.sin(TAU * (p - 0.22)),
    earNear: 5.5 * Math.sin(2 * TAU * (p - 0.12)),
    earFar: 5.5 * Math.sin(2 * TAU * (p - 0.16)),
    frontNear: legAngles(p),
    backFar: legAngles(p + HIND_LAG),
    frontFar: legAngles(p + 0.5),
    backNear: legAngles(p + 0.5 + HIND_LAG),
  };
}

/**
 * The steepest she tilts, however steep the climb.
 *
 * A fox does not walk a wall nose-first at 90 degrees; past about this angle the
 * drawing stops reading as a fox and starts reading as a rotated sprite. A
 * vertical move is drawn as a steep scramble at this limit, with her facing held
 * from whichever way she was already going.
 */
export const MAX_HEADING_PITCH = 52;
/** How quickly the tilt follows a change of direction. Fast enough to feel steered, slow enough not to flick. */
const HEADING_TIME_CONSTANT_S = 0.14;

/**
 * The direction she is travelling, as degrees above (positive) or below (negative)
 * horizontal, from one frame's displacement in screen pixels.
 *
 * Horizontal travel is the baseline because she is drawn walking sideways: what
 * the body has to express is only how far her path leans off that. Pure vertical
 * travel is therefore plus or minus 90, which `withHeading` then limits. Screen y
 * grows downward, hence the sign flip.
 */
export function headingFromMotion(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  return (Math.atan2(-dy, Math.abs(dx)) * 180) / Math.PI;
}

/**
 * Ease the displayed heading toward the true one, independent of frame rate.
 *
 * Her path is steered by a pointer, so its direction can change in a single
 * frame; a tilt that followed it exactly would snap. An exponential approach
 * with a fixed time constant gives the same feel at 30, 60 and 144Hz.
 */
export function smoothHeading(current: number, target: number, dt: number): number {
  const k = 1 - Math.exp(-Math.max(0, dt) / HEADING_TIME_CONSTANT_S);
  return current + (target - current) * k;
}

/**
 * Lean a walking pose into the direction of travel.
 *
 * Nose-up on a climb and nose-down on a descent, by rotating the torso (the head,
 * tail and legs ride on it). The head leads a little further than the body, the
 * way an animal looks where it is going, and on a steep climb the front paws
 * reach forward and the hind legs drive, so the legs read as pulling her up
 * rather than shuffling along a tilted line. The sign is the same whichever way
 * she faces: the facing flip is applied to the whole drawing outside the rig.
 */
export function withHeading(pose: FoxPose, headingDeg: number): FoxPose {
  const limit = MAX_HEADING_PITCH;
  const tilt = Math.max(-limit, Math.min(limit, headingDeg));
  const steepness = Math.abs(tilt) / limit; // 0 level, 1 at the limit
  const climbing = tilt > 0 ? 1 : 0;
  const reach = steepness * (climbing ? 10 : 4);
  const drive = steepness * (climbing ? 7 : 0);
  return {
    ...pose,
    // SVG rotation is clockwise-positive, so nose-up is negative.
    bodyPitch: pose.bodyPitch - tilt,
    headPitch: pose.headPitch - tilt * 0.3,
    // Raised tail on a climb for balance; tucked a little on a descent.
    tail: pose.tail + (climbing ? steepness * 10 : -steepness * 6),
    frontNear: { ...pose.frontNear, hip: pose.frontNear.hip - reach },
    frontFar: { ...pose.frontFar, hip: pose.frontFar.hip - reach },
    backNear: { ...pose.backNear, hip: pose.backNear.hip + drive },
    backFar: { ...pose.backFar, hip: pose.backFar.hip + drive },
  };
}

const PLANTED: LegAngles = { hip: 0, knee: KNEE_PLANTED / 2 };

/** All four feet under her, tail at rest. The pose she holds when she stops. */
export const STANDING_POSE: FoxPose = {
  bodyY: 0,
  bodyPitch: 0,
  headY: 0,
  headPitch: 0,
  tail: 6,
  earNear: 0,
  earFar: 0,
  frontNear: PLANTED,
  frontFar: PLANTED,
  backNear: PLANTED,
  backFar: PLANTED,
};

function lerpLeg(from: LegAngles, to: LegAngles, t: number): LegAngles {
  return { hip: lerp(from.hip, to.hip, t), knee: lerp(from.knee, to.knee, t) };
}

/**
 * Blend two poses; `t` of 0 is `from`, 1 is `to`.
 *
 * Used to settle into `STANDING_POSE` when she stops. Cutting straight to it
 * snaps a leg that was mid-swing into place; easing a few frames reads as her
 * putting her feet down.
 */
export function blendPose(from: FoxPose, to: FoxPose, t: number): FoxPose {
  const k = Math.min(1, Math.max(0, t));
  return {
    bodyY: lerp(from.bodyY, to.bodyY, k),
    bodyPitch: lerp(from.bodyPitch, to.bodyPitch, k),
    headY: lerp(from.headY, to.headY, k),
    headPitch: lerp(from.headPitch, to.headPitch, k),
    tail: lerp(from.tail, to.tail, k),
    earNear: lerp(from.earNear, to.earNear, k),
    earFar: lerp(from.earFar, to.earFar, k),
    frontNear: lerpLeg(from.frontNear, to.frontNear, k),
    frontFar: lerpLeg(from.frontFar, to.frontFar, k),
    backNear: lerpLeg(from.backNear, to.backNear, k),
    backFar: lerpLeg(from.backFar, to.backFar, k),
  };
}

/**
 * Pixels of travel per full stride, for a figure drawn `size` px wide.
 *
 * Scales with the figure so a big fox takes proportionally big steps. The
 * factor is a compromise: a true match to her top speed would need her legs to
 * blur, so strides are a little longer than her short legs could strictly
 * cover. That reads as brisk, which is the character, rather than as skating.
 */
export function strideLength(size: number): number {
  return size * 1.5;
}

/** Advance the stride by the distance actually covered. Never moves backwards. */
export function advancePhase(phase: number, distancePx: number, size: number): number {
  if (!(distancePx > 0)) return wrap(phase);
  return wrap(phase + distancePx / strideLength(size));
}
