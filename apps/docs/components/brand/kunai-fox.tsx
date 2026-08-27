import { kunaiBrand } from "@/lib/brand/tokens";
import type { CSSProperties } from "react";

export const KUNAI_FOX_POSES = ["idle", "watch", "go", "wait"] as const;
export type KunaiFoxPose = (typeof KUNAI_FOX_POSES)[number];
export type KunaiFoxFacing = "left" | "right";

type KunaiFoxProps = {
  readonly pose?: KunaiFoxPose;
  readonly facing?: KunaiFoxFacing;
  readonly size?: number;
  readonly animated?: boolean;
  readonly title?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
};

const FUR = kunaiBrand.accent;
const CREAM = kunaiBrand.accentSoft;
const INK = kunaiBrand.bg;

const DEFAULT_FACING: Record<KunaiFoxPose, KunaiFoxFacing> = {
  idle: "right",
  watch: "left",
  go: "right",
  wait: "left",
};

function FrontFox({
  lids,
  mouth,
  floppy,
}: {
  readonly lids: "round" | "half" | "slit";
  readonly mouth: "smile" | "w" | "dot";
  readonly floppy: "none" | "near" | "far";
}) {
  const leftEar =
    floppy === "near" ? "translate(38 22) rotate(-28)" : "translate(34 18) rotate(-12)";
  const rightEar = floppy === "far" ? "translate(90 22) rotate(28)" : "translate(94 18) rotate(12)";

  return (
    <g>
      <g transform={leftEar}>
        <path d="M0 28 C0 4 18 -8 22 18 C16 22 6 28 0 28Z" fill={FUR} />
        <path d="M8 22 C10 10 18 8 18 18 C14 20 10 22 8 22Z" fill={CREAM} />
      </g>
      <g transform={rightEar}>
        <path d="M0 28 C0 4 -18 -8 -22 18 C-16 22 -6 28 0 28Z" fill={FUR} />
        <path d="M-8 22 C-10 10 -18 8 -18 18 C-14 20 -10 22 -8 22Z" fill={CREAM} />
      </g>
      <ellipse cx="64" cy="108" rx="34" ry="22" fill={FUR} />
      <ellipse cx="64" cy="62" rx="40" ry="38" fill={FUR} />
      <ellipse cx="64" cy="112" rx="16" ry="14" fill={CREAM} />
      <ellipse cx="64" cy="78" rx="20" ry="14" fill={CREAM} />
      <FrontEyes lids={lids} />
      <ellipse cx="64" cy="76" rx="2.4" ry="2" fill={INK} />
      <FrontMouth kind={mouth} />
    </g>
  );
}

function FrontEyes({ lids }: { readonly lids: "round" | "half" | "slit" }) {
  if (lids === "slit") {
    return (
      <g stroke={INK} strokeWidth="3.2" strokeLinecap="round">
        <path d="M46 64 q6 4 12 0" fill="none" />
        <path d="M70 64 q6 4 12 0" fill="none" />
      </g>
    );
  }
  if (lids === "half") {
    return (
      <g fill={INK}>
        <path d="M46 62 a7 7 0 0 0 14 0Z" />
        <path d="M68 62 a7 7 0 0 0 14 0Z" />
      </g>
    );
  }
  return (
    <g fill={INK}>
      <circle cx="53" cy="64" r="6.5" />
      <circle cx="75" cy="64" r="6.5" />
    </g>
  );
}

function FrontMouth({ kind }: { readonly kind: "smile" | "w" | "dot" }) {
  if (kind === "w") {
    return (
      <path
        d="M58 84 q3 4 6 0 q3 4 6 0"
        fill="none"
        stroke={INK}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    );
  }
  if (kind === "dot") {
    return <circle cx="64" cy="84" r="1.6" fill={INK} />;
  }
  return (
    <path d="M58 83 q6 7 12 0" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
  );
}

function ProfileFox() {
  return (
    <g>
      <g transform="translate(40 16) rotate(-18)">
        <path d="M0 32 C4 2 24 -6 28 22 C18 24 6 32 0 32Z" fill={FUR} />
        <path d="M10 24 C14 10 24 10 24 20 C18 22 12 24 10 24Z" fill={CREAM} />
      </g>
      <ellipse cx="58" cy="108" rx="32" ry="20" fill={FUR} />
      <ellipse cx="60" cy="64" rx="34" ry="32" fill={FUR} />
      <path d="M78 58 C102 44 112 38 108 58 C100 70 88 76 78 72Z" fill={FUR} />
      <path d="M86 60 C100 50 106 50 104 60 C98 66 90 68 86 66Z" fill={CREAM} />
      <ellipse cx="58" cy="112" rx="14" ry="12" fill={CREAM} />
      <circle cx="72" cy="60" r="6.2" fill={INK} />
      <ellipse cx="104" cy="56" rx="2.2" ry="1.8" fill={INK} />
    </g>
  );
}

function FoxArtwork({ pose }: { readonly pose: KunaiFoxPose }) {
  if (pose === "go") return <ProfileFox />;
  if (pose === "watch") return <FrontFox lids="slit" mouth="w" floppy="near" />;
  if (pose === "wait") return <FrontFox lids="round" mouth="smile" floppy="none" />;
  return <FrontFox lids="half" mouth="w" floppy="far" />;
}

/**
 * Illustrated kitsune for docs, banners, and OG cards.
 *
 * idle = Watcher C2, watch = Watcher C1, go = Courier, wait = Operator.
 * Flip with `facing` instead of drawing a second character.
 */
export function KunaiFox({
  pose = "idle",
  facing,
  size = 160,
  animated = false,
  title,
  className,
  style,
}: KunaiFoxProps) {
  const side = facing ?? DEFAULT_FACING[pose];
  const flip = side === "left";
  const label = title ?? "Kunai fox";
  const classes = ["kunai-fox", animated ? "kunai-fox--animated" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title ? label : undefined}
      className={classes || undefined}
      style={style}
    >
      {title ? <title>{label}</title> : null}
      <g transform={flip ? "translate(128 0) scale(-1 1)" : undefined}>
        <FoxArtwork pose={pose} />
      </g>
    </svg>
  );
}
