// =============================================================================
// SakuraPetal.tsx — the ❀ signature motif, animated once and reused everywhere
//
// One primitive, three modes:
//   • loading     — a gentle bloom cycle in rose `accent` (in-flight)
//   • placeholder — a calm static ❀ in `dim` for empty poster/thumb slots
//   • complete    — settles to mint `ok`
//
// Honors reduced-motion (static ❀) via KUNAI_REDUCED_MOTION / NO_MOTION, and a
// viewport-pause `active` prop so off-screen petals stop reconciling. The glyph
// stays a single cell so terminals never see width jitter mid-cycle.
// =============================================================================

import { Text } from "ink";
import React from "react";

import { palette } from "../shell-theme";

export type SakuraPetalMode = "loading" | "placeholder" | "complete";

/** Bloom cycle — all single-cell Dingbats so the slot width never shifts. */
export const BLOOM_FRAMES = ["❀", "✿", "❁", "✾"] as const;
export const STATIC_PETAL = "❀";

const FRAME_INTERVAL_MS = 150;

/** Reduced-motion gate honored by every Sakura animation (petal + loader). */
export function reducedMotionEnabled(): boolean {
  return Boolean(process.env.KUNAI_REDUCED_MOTION || process.env.NO_MOTION);
}

/**
 * Monotonic frame tick shared by the loader's shimmer/drift. `active` pauses the
 * clock (viewport-freeze) and reduced-motion pins it to 0, so callers can derive
 * any cycle length via modulo without spinning a timer no one can see.
 */
export function useFrameTick(active = true, intervalMs = FRAME_INTERVAL_MS): number {
  const [tick, setTick] = React.useState(0);
  const animate = active && !reducedMotionEnabled();
  React.useEffect(() => {
    if (!animate) return undefined;
    const timer = setInterval(() => setTick((current) => current + 1), intervalMs);
    return () => clearInterval(timer);
  }, [animate, intervalMs]);
  return animate ? tick : 0;
}

function modeColor(mode: SakuraPetalMode): string {
  if (mode === "complete") return palette.ok;
  if (mode === "placeholder") return palette.dim;
  return palette.accent;
}

/**
 * Shared bloom frame index. `active` pauses the clock (viewport-freeze), and
 * reduced-motion pins it to frame 0 — both keep the petal perfectly still
 * instead of spinning a timer no one can see.
 */
export function useSakuraFrame(active = true): number {
  const [tick, setTick] = React.useState(0);
  const animate = active && !reducedMotionEnabled();
  React.useEffect(() => {
    if (!animate) return undefined;
    const timer = setInterval(() => setTick((current) => current + 1), FRAME_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [animate]);
  return animate ? tick % BLOOM_FRAMES.length : 0;
}

export function SakuraPetal({
  mode = "loading",
  active = true,
  color,
  bold = true,
}: {
  readonly mode?: SakuraPetalMode;
  readonly active?: boolean;
  readonly color?: string;
  readonly bold?: boolean;
}) {
  const frame = useSakuraFrame(active && mode === "loading");
  const glyph = mode === "loading" ? (BLOOM_FRAMES[frame] ?? STATIC_PETAL) : STATIC_PETAL;
  return (
    <Text color={color ?? modeColor(mode)} bold={bold}>
      {glyph}
    </Text>
  );
}
