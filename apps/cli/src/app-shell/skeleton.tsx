import { Box, Text } from "ink";
import React from "react";

import { palette } from "./shell-theme";

// Animated "content is loading" placeholder rows. A soft accent band sweeps
// left→right across dim bars, staggered per row, so a long request reads as
// intentional ("results are coming") instead of a frozen empty body. Stays
// within the 4-color discipline: the dim base + accent family only.

export type SkeletonTone = "peak" | "near" | "mid" | "base";

const TONE_COLOR: Record<SkeletonTone, string> = {
  peak: palette.accent,
  near: palette.accentDeep,
  mid: palette.accentDim,
  base: palette.dim,
};

/**
 * Pure: tone for each cell of a bar given the current highlight position.
 * `highlight` may sit past `width` (the band is then off-screen — a brief
 * rest between sweeps). Distance from the highlight falls off peak→base.
 */
export function barTones(width: number, highlight: number): SkeletonTone[] {
  const tones: SkeletonTone[] = [];
  for (let x = 0; x < width; x++) {
    const d = Math.abs(x - highlight);
    tones.push(d < 1 ? "peak" : d < 2 ? "near" : d < 3 ? "mid" : "base");
  }
  return tones;
}

/** Collapse consecutive same-tone cells into runs to keep Ink node count low. */
function toRuns(tones: readonly SkeletonTone[]): { tone: SkeletonTone; length: number }[] {
  const runs: { tone: SkeletonTone; length: number }[] = [];
  for (const tone of tones) {
    const last = runs[runs.length - 1];
    if (last && last.tone === tone) last.length += 1;
    else runs.push({ tone, length: 1 });
  }
  return runs;
}

function SkeletonBar({ width, highlight }: { width: number; highlight: number }) {
  const runs = toRuns(barTones(width, highlight));
  return (
    <>
      {runs.map((run, i) => (
        <Text
          // eslint-disable-next-line react/no-array-index-key -- run list is positional and re-derived each frame
          key={`run-${i}`}
          color={TONE_COLOR[run.tone]}
          dimColor={run.tone === "base"}
        >
          {"█".repeat(run.length)}
        </Text>
      ))}
    </>
  );
}

function usePulse(active: boolean, intervalMs: number): number {
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  return tick;
}

const SPEED = 1; // cells advanced per tick
const STAGGER = 4; // per-row offset so the wave cascades down the list
const TAIL = 6; // off-screen rest between sweeps

export const SkeletonRows = React.memo(function SkeletonRows({
  rows = 4,
  titleWidth = 26,
  metaWidth = 10,
  active = true,
  intervalMs = 90,
  label,
}: {
  rows?: number;
  titleWidth?: number;
  metaWidth?: number;
  active?: boolean;
  intervalMs?: number;
  label?: string;
}) {
  const tick = usePulse(active, intervalMs);
  const span = titleWidth + TAIL;

  return (
    <Box flexDirection="column" paddingY={1}>
      {label ? (
        <Box marginBottom={1}>
          <Text color={palette.muted} dimColor>
            {label}
          </Text>
        </Box>
      ) : null}
      {Array.from({ length: rows }, (_, row) => {
        // Each row's band is offset so the shimmer cascades down the list.
        const highlight = active ? (tick * SPEED + row * STAGGER) % span : -TAIL;
        return (
          <Box key={`skeleton-row-${row}`} marginBottom={row === rows - 1 ? 0 : 1}>
            <Text color={palette.dim} dimColor>
              {"▓▓ "}
            </Text>
            <SkeletonBar width={titleWidth} highlight={highlight} />
            <Text>{"  "}</Text>
            <SkeletonBar width={metaWidth} highlight={highlight - titleWidth * 0.5} />
          </Box>
        );
      })}
    </Box>
  );
});
