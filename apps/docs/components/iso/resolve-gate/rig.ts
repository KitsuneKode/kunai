import { OUT_X, PLUNGER_HOME, PLUNGER_TOUCH, PROBE_X, SLOT_X } from "./view";

/*
 * The gate's duty cycle, as a pure clock model. Each candidate spends CYCLE
 * seconds travelling the phases below; `frameOf` turns a clock into every
 * moving part's pose, so the live layer only writes attributes.
 *
 * A candidate fails when its hashed index lands under the FAIL share —
 * deterministic, so a still frame and the readout always agree.
 */
export const CYCLE = 5.6;

export const enum Phase {
  Travel,
  Press,
  Judge,
  Lift,
  Exit,
  Rest,
}

const PHASE_END = [1.4, 2.0, 2.9, 3.4, 4.7, CYCLE] as const;

export interface GateFrame {
  index: number; // which candidate is on the rail
  phase: Phase;
  tokenX: number; // world x on the rail
  tipSide: number; // 0 = still on rail, 1 = fully dropped into the bin
  plunger: number; // tip z
  needle: number; // -1 fail end .. 0 idle .. +1 pass end
  verdict: boolean | null; // decided at Judge end
  glow: number; // mpv screen pulse 0..1
  spawn: number; // next candidate fading in at the slot
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
};

/* ~25 % of candidates are dead, but which is hashed — the queue never
   settles into an obvious P P F P pattern. */
export const fails = (index: number) => Math.imul(index + 1, 2654435761) >>> 29 < 2;

export function frameOf(clock: number): GateFrame {
  const index = Math.floor(clock / CYCLE);
  const t = clock % CYCLE;
  const decided = t >= PHASE_END[2];
  const verdict = decided ? !fails(index) : null;

  /* token x: parked at the gate during press/judge/lift */
  let tokenX: number;
  let tipSide = 0;
  if (t < PHASE_END[0]) tokenX = SLOT_X + (PROBE_X - SLOT_X) * ease(t / PHASE_END[0]);
  else if (t < PHASE_END[4]) tokenX = PROBE_X;
  else if (verdict)
    tokenX = PROBE_X + (OUT_X - PROBE_X) * ease((t - PHASE_END[4]) / (CYCLE - PHASE_END[4]));
  else {
    const u = ease((t - PHASE_END[4]) / (CYCLE - PHASE_END[4]));
    tokenX = PROBE_X;
    tipSide = u;
  }

  /* plunger: home → touch during Press, hold, back during Lift */
  let plunger = PLUNGER_HOME;
  if (t >= PHASE_END[0] && t < PHASE_END[1])
    plunger =
      PLUNGER_HOME +
      (PLUNGER_TOUCH - PLUNGER_HOME) * ease((t - PHASE_END[0]) / (PHASE_END[1] - PHASE_END[0]));
  else if (t >= PHASE_END[1] && t < PHASE_END[3]) plunger = PLUNGER_TOUCH;
  else if (t >= PHASE_END[3] && t < PHASE_END[4])
    plunger =
      PLUNGER_TOUCH +
      (PLUNGER_HOME - PLUNGER_TOUCH) * ease((t - PHASE_END[3]) / (PHASE_END[4] - PHASE_END[3]));

  /* needle: sweeps during Judge, parks on the verdict through Exit */
  let needle = 0;
  if (t >= PHASE_END[0] && t < PHASE_END[2]) {
    const u = (t - PHASE_END[0]) / (PHASE_END[2] - PHASE_END[0]);
    needle = Math.sin(u * Math.PI * 2.5) * (1 - u) * 0.7; // hunting sweep that rings down
  } else if (decided && t < PHASE_END[5]) needle = verdict ? 1 : -1;

  /* mpv glows while a good token parks at its foot */
  const glow = verdict === true && t >= PHASE_END[4] ? clamp01((t - PHASE_END[4]) / 0.4) : 0;

  /* the next candidate fades in at the slot during the last beat */
  const spawn = t >= PHASE_END[5] - 0.7 ? clamp01((t - (PHASE_END[5] - 0.7)) / 0.7) : 0;

  const phase =
    t < PHASE_END[0]
      ? Phase.Travel
      : t < PHASE_END[1]
        ? Phase.Press
        : t < PHASE_END[2]
          ? Phase.Judge
          : t < PHASE_END[3]
            ? Phase.Lift
            : t < PHASE_END[4]
              ? Phase.Exit
              : Phase.Rest;

  return {
    index,
    phase,
    tokenX,
    tipSide,
    plunger,
    needle,
    verdict: decided ? verdict : null,
    glow,
    spawn,
  };
}

export interface Counts {
  probed: number;
  passed: number;
  dropped: number;
}

export function countsOf(clock: number): Counts {
  const f = frameOf(clock);
  let passed = 0;
  let dropped = 0;
  for (let i = 0; i < f.index; i++) {
    if (fails(i)) dropped++;
    else passed++;
  }
  const probed = f.index + (f.verdict !== null ? 1 : 0);
  if (f.verdict === true) passed++;
  if (f.verdict === false) dropped++;
  return { probed, passed, dropped };
}

export const readoutOf = (c: Counts) =>
  `probed ${c.probed} · passed ${c.passed} · dropped ${c.dropped}`;
