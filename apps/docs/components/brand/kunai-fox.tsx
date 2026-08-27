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
  /** Use the 96px nav still instead of the 320px pose still. */
  readonly compact?: boolean;
};

/**
 * The still each pose was drawn at, and which way that drawing faces.
 *
 * Only `go` and `wait` have a real mirrored pair in the master batch. Rather
 * than accept a `facing` the art cannot honour — the shape this had before,
 * where `watch` and `idle` silently returned the same file for both
 * directions — the odd direction is produced by flipping the still. Every
 * `facing` value therefore changes what renders.
 */
const STILLS = {
  wait: { left: "/brand/fox/wait.png", right: "/brand/fox/wait-right.png" },
  go: { left: "/brand/fox/go-left.png", right: "/brand/fox/go.png" },
  watch: { left: "/brand/fox/watch.png", right: null },
  idle: { left: null, right: "/brand/fox/idle.png" },
} satisfies Record<KunaiFoxPose, { left: string | null; right: string | null }>;

/** Where each pose looks when the caller does not ask for a direction. */
const DEFAULT_FACING = {
  idle: "right",
  watch: "left",
  go: "right",
  wait: "left",
} satisfies Record<KunaiFoxPose, KunaiFoxFacing>;

/**
 * The 96px still the nav and other sub-40px slots load.
 *
 * A2 rather than the pose still on purpose: the pose masters are composed to
 * emerge from a corner, so several are cropped through an ear and collapse into
 * an unreadable smudge at 28px. A2 sits square in frame with both ears intact.
 */
const NAV_STILL = "/brand/fox/nav.png";

type ResolvedStill = { readonly src: string; readonly mirrored: boolean };

/** Pick the drawn still for a direction, flipping the opposite one when needed. */
export function resolveFoxStill(pose: KunaiFoxPose, facing: KunaiFoxFacing): ResolvedStill {
  const pair = STILLS[pose];
  const drawn = pair[facing];
  if (drawn) return { src: drawn, mirrored: false };
  const opposite = facing === "left" ? pair.right : pair.left;
  // Every pose has at least one drawn direction, so this is always populated.
  return { src: opposite as string, mirrored: true };
}

/**
 * The illustrated kitsune stills — Operator, Courier, Watcher — not a traced SVG.
 *
 * Decorative by default: with no `title` the image is `aria-hidden` and carries
 * an empty alt, because on most surfaces she sits beside copy that already says
 * what the section is.
 */
export function KunaiFox({
  pose = "idle",
  facing,
  size = 160,
  animated = false,
  title,
  className,
  style,
  compact = false,
}: KunaiFoxProps) {
  const side = facing ?? DEFAULT_FACING[pose];
  const { src, mirrored } = resolveFoxStill(pose, side);
  const label = title ?? "Kunai fox";
  const classes = [
    "kunai-fox",
    animated ? "kunai-fox--animated" : "",
    mirrored ? "kunai-fox--mirrored" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <img
      src={compact ? NAV_STILL : src}
      width={size}
      height={size}
      alt={title ? label : ""}
      aria-hidden={title ? undefined : true}
      className={classes || undefined}
      style={style}
      draggable={false}
      loading={compact ? "eager" : "lazy"}
      decoding="async"
    />
  );
}
