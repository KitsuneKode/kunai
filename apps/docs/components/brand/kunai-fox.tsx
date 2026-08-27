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

const DEFAULT_FACING = {
  idle: "right",
  watch: "left",
  go: "right",
  wait: "left",
} satisfies Record<KunaiFoxPose, KunaiFoxFacing>;

/** Public stills exported from the illustrated A/B/C masters. Never a traced SVG. */
const STILLS = {
  wait: {
    left: "/brand/fox/wait.png",
    right: "/brand/fox/wait-right.png",
  },
  go: {
    left: "/brand/fox/go-left.png",
    right: "/brand/fox/go.png",
  },
  watch: {
    left: "/brand/fox/watch.png",
    right: "/brand/fox/watch.png",
  },
  idle: {
    left: "/brand/fox/idle.png",
    right: "/brand/fox/idle.png",
  },
} satisfies Record<KunaiFoxPose, Record<KunaiFoxFacing, string>>;

/**
 * The illustrated kitsune stills — Operator, Courier, Watcher — not a geometric stand-in.
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
  const src = STILLS[pose][side];
  const label = title ?? "Kunai fox";
  const classes = ["kunai-fox", animated ? "kunai-fox--animated" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={title ? label : ""}
      aria-hidden={title ? undefined : true}
      className={classes || undefined}
      style={style}
      draggable={false}
    />
  );
}
