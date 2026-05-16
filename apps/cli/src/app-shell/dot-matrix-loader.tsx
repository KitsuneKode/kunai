import { Box, Text } from "ink";
import React from "react";

import { palette } from "./shell-theme";

// ── Braille helpers for compact inline dot matrix ─────────────────────────

const BRAILLE_BASE = 0x2800;

/** Encode a 2×4 dot subgrid into a single Braille Unicode character. */
function brailleChar(dots: readonly boolean[]): string {
  let bits = 0;
  // Standard Braille dot mapping:
  // 1(top-left)=0x01, 2(mid-left)=0x02, 3(bot-left)=0x04,
  // 4(top-right)=0x08, 5(mid-right)=0x10, 6(bot-right)=0x20,
  // 7(extra-top-left)=0x40, 8(extra-top-right)=0x80
  const map = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80];
  for (let i = 0; i < 8 && i < dots.length; i++) {
    if (dots[i] as boolean) bits += map[i] as number;
  }
  return String.fromCharCode(BRAILLE_BASE + bits);
}

/** Render a 4×4 boolean grid as two horizontal Braille characters. */
function renderBraille4x4(grid: readonly (readonly boolean[])[]): string {
  // grid is 4 rows × 4 cols
  // Char 0: cols 0-1, Char 1: cols 2-3
  const chars: string[] = [];
  for (let charIdx = 0; charIdx < 2; charIdx++) {
    const colOffset = charIdx * 2;
    const dots: boolean[] = [];
    // Braille order: dot1 (r0,c0), dot2 (r1,c0), dot3 (r2,c0), dot4 (r0,c1), dot5 (r1,c1), dot6 (r2,c1), dot7 (r3,c0), dot8 (r3,c1)
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 2; col++) {
        dots.push(grid[row]?.[colOffset + col] ?? false);
      }
    }
    chars.push(brailleChar(dots));
  }
  return chars.join("");
}

// ── Animation frame generators ─────────────────────────────────────────────

export type DotMatrixVariant =
  | "flux-columns"
  | "echo-ring"
  | "neon-drift"
  | "core-spiral"
  | "pulse-grid";

export type DotMatrixFrame = readonly (readonly boolean[])[];

const MATRIX_SIZE = 5;
const CENTER = Math.floor(MATRIX_SIZE / 2);

function indexToCoord(index: number): { row: number; col: number } {
  return { row: Math.floor(index / MATRIX_SIZE), col: index % MATRIX_SIZE };
}

function distanceFromCenter(index: number): number {
  const { row, col } = indexToCoord(index);
  return Math.hypot(row - CENTER, col - CENTER);
}

function polarAngle(index: number): number {
  const { row, col } = indexToCoord(index);
  return Math.atan2(row - CENTER, col - CENTER);
}

function normalizedRadius(index: number): number {
  const maxR = Math.hypot(CENTER, CENTER);
  return distanceFromCenter(index) / maxR;
}

function buildFrame(cells: readonly boolean[]): DotMatrixFrame {
  const rows: boolean[][] = [];
  for (let r = 0; r < MATRIX_SIZE; r++) {
    rows.push(cells.slice(r * MATRIX_SIZE, (r + 1) * MATRIX_SIZE));
  }
  return rows;
}

/** Generate all frames for a variant. */
function generateFrames(variant: DotMatrixVariant, frameCount: number): readonly DotMatrixFrame[] {
  const frames: DotMatrixFrame[] = [];
  for (let f = 0; f < frameCount; f++) {
    const cells: boolean[] = [];
    const phase = f / frameCount; // 0..1
    for (let idx = 0; idx < MATRIX_SIZE * MATRIX_SIZE; idx++) {
      const { row, col } = indexToCoord(idx);
      const angle = polarAngle(idx);
      const normR = normalizedRadius(idx);

      let on = false;
      switch (variant) {
        case "flux-columns": {
          // Vertical columns that light up sequentially with a sine envelope
          const colWave = Math.sin((col / MATRIX_SIZE) * Math.PI * 2 + phase * Math.PI * 2);
          const rowFade = Math.sin((row / MATRIX_SIZE) * Math.PI * 2 + phase * Math.PI * 3);
          on = colWave > 0.3 && rowFade > -0.5;
          break;
        }
        case "echo-ring": {
          // Expanding and contracting ring
          const ringRadius = Math.abs(Math.sin(phase * Math.PI));
          const thickness = 0.6;
          on = normR > ringRadius - thickness && normR < ringRadius + thickness;
          break;
        }
        case "neon-drift": {
          // Diagonal wave drifting across the grid
          const drift = Math.sin((row + col) * 0.9 + phase * Math.PI * 2);
          on = drift > 0.2;
          break;
        }
        case "core-spiral": {
          // Dots light up along a spiral path
          const spiralPos = (phase + normR * 0.7) % 1;
          const spiralAngle = (angle / (Math.PI * 2) + phase) % 1;
          on = Math.abs(spiralPos - spiralAngle) < 0.15 || normR < 0.2;
          break;
        }
        case "pulse-grid": {
          // Whole grid pulses from center outward
          const pulse = Math.sin(phase * Math.PI * 2);
          const threshold = 1 - pulse;
          on = normR < threshold && normR > threshold - 0.4;
          break;
        }
      }
      cells.push(on);
    }
    frames.push(buildFrame(cells));
  }
  return frames;
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useDotMatrixAnimation(
  variant: DotMatrixVariant = "flux-columns",
  intervalMs = 80,
  active = true,
): DotMatrixFrame {
  // Memoize frames per variant so they regenerate when variant changes
  // but stay stable across re-renders. 24 frames × 25 cells = small memory footprint.
  const frames = React.useMemo(() => generateFrames(variant, 24), [variant]);
  const [frameIdx, setFrameIdx] = React.useState(0);

  // Reset to frame 0 when variant changes so animation starts cleanly
  React.useEffect(() => {
    setFrameIdx(0);
  }, [variant]);

  React.useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => {
      setFrameIdx((f) => (f + 1) % frames.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs, frames.length]);

  return (
    frames[frameIdx] ??
    frames[0] ??
    buildFrame(Array.from({ length: MATRIX_SIZE * MATRIX_SIZE }, () => false))
  );
}

// ── Full 5×5 grid renderer ─────────────────────────────────────────────────

export function DotMatrixGrid({
  frame,
  onColor = palette.teal,
  offColor = palette.gray,
}: {
  frame: DotMatrixFrame;
  onColor?: string;
  offColor?: string;
}) {
  return (
    <Box flexDirection="column">
      {frame.map((row, r) => (
        // eslint-disable-next-line react/no-array-index-key -- fixed 5×5 grid, structure never changes
        <Box key={`row-${r}`}>
          {row.map((on, c) => (
            // eslint-disable-next-line react/no-array-index-key -- fixed 5×5 grid, structure never changes
            <Text key={`cell-${r}-${c}`} color={on ? onColor : offColor} dimColor={!on}>
              {on ? "●" : "·"}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  );
}

// ── Compact inline Braille renderer (4×4 dots in 2 chars) ─────────────────

export function CompactDotMatrix({
  frame,
  onColor = palette.teal,
}: {
  frame: DotMatrixFrame;
  onColor?: string;
}) {
  // Extract the central 4×4 region from the 5×5 frame
  const subgrid: boolean[][] = [];
  for (let r = 0; r < 4; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < 4; c++) {
      row.push(frame[r + 1]?.[c + 1] ?? false);
    }
    subgrid.push(row);
  }
  const braille = renderBraille4x4(subgrid);
  return <Text color={onColor}>{braille}</Text>;
}

// ── Convenience animated components ────────────────────────────────────────

export function DotMatrixLoader({
  variant = "flux-columns",
  intervalMs = 80,
  active = true,
  onColor,
  offColor,
}: {
  variant?: DotMatrixVariant;
  intervalMs?: number;
  active?: boolean;
  onColor?: string;
  offColor?: string;
}) {
  const frame = useDotMatrixAnimation(variant, intervalMs, active);
  return <DotMatrixGrid frame={frame} onColor={onColor} offColor={offColor} />;
}

export function InlineDotMatrixLoader({
  variant = "flux-columns",
  intervalMs = 80,
  active = true,
  onColor,
}: {
  variant?: DotMatrixVariant;
  intervalMs?: number;
  active?: boolean;
  onColor?: string;
}) {
  const frame = useDotMatrixAnimation(variant, intervalMs, active);
  return <CompactDotMatrix frame={frame} onColor={onColor} />;
}
