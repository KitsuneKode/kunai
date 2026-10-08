"use client";

import { type FoxPose, type LegAngles, STANDING_POSE } from "@/lib/fox-gait";
import { forwardRef, useImperativeHandle, useRef } from "react";

/**
 * Kanna drawn in parts, so she can actually walk.
 *
 * The pose stills (`kunai-fox.tsx`) are single raster images: a still can bob
 * and tilt, but it cannot swing a leg. This is the same animal rebuilt as
 * vector parts on the same palette and proportions, with a hip and a knee on
 * each leg, a tail that sways from its root, and ears that trail the head. A
 * gait (`lib/fox-gait.ts`) turns a point in the stride into joint angles; this
 * component only knows how to hang those angles on the drawing.
 *
 * She is drawn facing right in a 320-unit box, like the `go` still she stands
 * in for. Facing left is a CSS flip (`data-facing`), not a second drawing.
 *
 * ## One source for the transforms
 *
 * `partTransforms` is used twice: once at render, so the server HTML already
 * holds a valid standing pose, and again by the imperative handle, which
 * rewrites the same attributes every frame. Both go through one function so the
 * first paint and the animated state can never disagree about where a joint is.
 * The handle writes attributes directly rather than setting state: the rig
 * advances every animation frame and must never queue a React render.
 *
 * Decorative: `aria-hidden`, no title, never focusable.
 */

const BODY = "#ff8fb0";
const BODY_FAR = "#ec7a9c";
const LIGHT = "#ffc7d8";
const INK = "#1c1620";

/** Hip joints, in viewBox units. The knee sits `THIGH` below its hip. */
const FRONT_HIP = { x: 208, y: 230 } as const;
const BACK_HIP = { x: 104, y: 232 } as const;
const THIGH = 32;
const TAIL_ROOT = { x: 108, y: 214 } as const;
const NECK = { x: 182, y: 200 } as const;
const EAR_FRONT_BASE = { x: 224, y: 100 } as const;
const EAR_BACK_BASE = { x: 170, y: 108 } as const;
const TORSO_CENTRE = { x: 160, y: 232 } as const;

export const WALKER_PARTS = [
  "rig",
  "tail",
  "head",
  "earFront",
  "earBack",
  "frontNear",
  "frontNearKnee",
  "frontFar",
  "frontFarKnee",
  "backNear",
  "backNearKnee",
  "backFar",
  "backFarKnee",
] as const;
export type WalkerPart = (typeof WALKER_PARTS)[number];

function round(value: number): string {
  return value.toFixed(2);
}

function rotate(angle: number, at: { readonly x: number; readonly y: number }): string {
  return `rotate(${round(angle)} ${at.x} ${at.y})`;
}

function legTransforms(hip: { readonly x: number; readonly y: number }, angles: LegAngles) {
  return {
    hip: rotate(angles.hip, hip),
    knee: rotate(angles.knee, { x: hip.x, y: hip.y + THIGH }),
  };
}

/** The `transform` attribute for every moving part of a pose. */
export function partTransforms(pose: FoxPose) {
  const frontNear = legTransforms(FRONT_HIP, pose.frontNear);
  const frontFar = legTransforms(FRONT_HIP, pose.frontFar);
  const backNear = legTransforms(BACK_HIP, pose.backNear);
  const backFar = legTransforms(BACK_HIP, pose.backFar);
  return {
    rig: `translate(0 ${round(pose.bodyY)}) ${rotate(pose.bodyPitch, TORSO_CENTRE)}`,
    tail: rotate(pose.tail, TAIL_ROOT),
    head: `translate(0 ${round(pose.headY)}) ${rotate(pose.headPitch, NECK)}`,
    earFront: rotate(pose.earNear, EAR_FRONT_BASE),
    earBack: rotate(pose.earFar, EAR_BACK_BASE),
    frontNear: frontNear.hip,
    frontNearKnee: frontNear.knee,
    frontFar: frontFar.hip,
    frontFarKnee: frontFar.knee,
    backNear: backNear.hip,
    backNearKnee: backNear.knee,
    backFar: backFar.hip,
    backFarKnee: backFar.knee,
  } satisfies Record<WalkerPart, string>;
}

export type FoxWalkerHandle = {
  /** Hang a pose on the drawing. Cheap enough to call every animation frame. */
  readonly setPose: (pose: FoxPose) => void;
};

type KunaiFoxWalkerProps = {
  readonly size?: number;
  readonly facing?: "left" | "right";
  readonly className?: string;
};

type LegProps = {
  readonly hip: { readonly x: number; readonly y: number };
  readonly part: Extract<WalkerPart, "frontNear" | "frontFar" | "backNear" | "backFar">;
  readonly fill: string;
  readonly transforms: Readonly<Record<WalkerPart, string>>;
};

/** Which part is the knee joint of each leg, so no name is built by string concatenation. */
const KNEE_PART = {
  frontNear: "frontNearKnee",
  frontFar: "frontFarKnee",
  backNear: "backNearKnee",
  backFar: "backFarKnee",
} as const satisfies Record<string, WalkerPart>;

/** Thigh, then a knee, then shin and paw: two segments so the foot can lift. */
function Leg({ hip, part, fill, transforms }: LegProps) {
  const kneePart = KNEE_PART[part];
  return (
    <g data-part={part} transform={transforms[part]}>
      <rect x={hip.x - 14} y={hip.y - 8} width={28} height={46} rx={14} fill={fill} />
      <g data-part={kneePart} transform={transforms[kneePart]}>
        <rect x={hip.x - 10.5} y={hip.y + 28} width={21} height={34} rx={10.5} fill={fill} />
        <ellipse cx={hip.x + 5} cy={hip.y + 62} rx={15} ry={8} fill={fill} />
      </g>
    </g>
  );
}

export const KunaiFoxWalker = forwardRef<FoxWalkerHandle, KunaiFoxWalkerProps>(
  function KunaiFoxWalker({ size = 58, facing = "right", className }, ref) {
    const svgRef = useRef<SVGSVGElement | null>(null);
    // Resolved on first use and then held: a querySelector per part per frame
    // is a layout-free but needless cost at 60Hz.
    const partsRef = useRef<Map<WalkerPart, Element> | null>(null);
    const transforms = partTransforms(STANDING_POSE);

    useImperativeHandle(
      ref,
      () => ({
        setPose(pose) {
          const svg = svgRef.current;
          if (!svg) return;
          if (!partsRef.current) {
            const found = new Map<WalkerPart, Element>();
            for (const part of WALKER_PARTS) {
              const element = svg.querySelector(`[data-part="${part}"]`);
              if (element) found.set(part, element);
            }
            partsRef.current = found;
          }
          const next = partTransforms(pose);
          for (const [part, element] of partsRef.current) {
            element.setAttribute("transform", next[part]);
          }
        },
      }),
      [],
    );

    return (
      <svg
        ref={svgRef}
        viewBox="0 0 320 320"
        width={size}
        height={size}
        aria-hidden="true"
        focusable="false"
        className={["kunai-fox-walker", className].filter(Boolean).join(" ")}
        data-facing={facing}
      >
        <g data-part="rig" transform={transforms.rig}>
          <g data-part="tail" transform={transforms.tail}>
            <path
              d="M110,234 C76,250 22,242 12,200 C4,168 16,144 36,138 C46,156 60,162 78,172 C98,184 114,196 116,214 Z"
              fill={BODY}
            />
          </g>

          <Leg hip={BACK_HIP} part="backFar" fill={BODY_FAR} transforms={transforms} />
          <Leg hip={FRONT_HIP} part="frontFar" fill={BODY_FAR} transforms={transforms} />

          <path
            d="M78,208 C78,182 124,170 164,174 C208,178 238,194 242,220 C245,244 234,262 214,266 L100,270 C72,266 64,238 78,208 Z"
            fill={BODY}
          />

          <Leg hip={BACK_HIP} part="backNear" fill={BODY} transforms={transforms} />
          <Leg hip={FRONT_HIP} part="frontNear" fill={BODY} transforms={transforms} />

          <g data-part="head" transform={transforms.head}>
            <g data-part="earBack" transform={transforms.earBack}>
              <path
                d="M146,118 C140,90 142,64 150,42 C172,54 192,76 198,100 C182,112 162,120 146,118 Z"
                fill={BODY}
              />
              <path
                d="M158,104 C155,88 156,72 160,60 C172,68 182,82 185,96 C177,102 167,106 158,104 Z"
                fill={LIGHT}
              />
            </g>
            <path
              d="M136,152 C132,108 170,84 210,86 C254,88 276,118 274,148 C274,158 272,166 270,172 C262,198 238,212 208,210 C168,208 140,186 136,152 Z"
              fill={BODY}
            />
            <g data-part="earFront" transform={transforms.earFront}>
              <path
                d="M194,96 C196,74 203,56 214,40 C234,56 250,80 254,104 C236,112 212,108 194,96 Z"
                fill={BODY}
              />
              <path
                d="M208,92 C209,78 213,66 219,56 C230,68 238,82 240,96 C231,98 217,98 208,92 Z"
                fill={LIGHT}
              />
            </g>
            <path
              d="M204,174 C212,160 246,158 273,167 C275,190 258,208 232,208 C212,208 200,192 204,174 Z"
              fill={LIGHT}
            />
            <ellipse cx={234} cy={150} rx={8} ry={12.5} fill={INK} />
            <ellipse cx={272} cy={168} rx={7} ry={5.5} fill={INK} />
            {/* The kunai she carries: a ring at the mouth and a short blade. */}
            <circle cx={265} cy={196} r={5} fill="none" stroke={LIGHT} strokeWidth={3} />
            <path d="M268,190 L316,186 L270,203 Z" fill="#ffe6ee" />
          </g>
        </g>
      </svg>
    );
  },
);
