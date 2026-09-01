import { Box, measureElement, Text, useStdin, useStdout } from "ink";
import React from "react";

import { barFill } from "../format/bar";
import { palette } from "../shell-theme";

const SGR_MOUSE_EVENT = new RegExp(`${String.fromCharCode(27)}\\[<(\\d+);(\\d+);(\\d+)([Mm])`, "g");

export type ProgressBarBounds = { x: number; y: number; width: number; height: number };

export function progressBarValueFromClick(
  column: number,
  row: number,
  bounds: ProgressBarBounds,
  max: number,
): number | null {
  const x = column - 1;
  const y = row - 1;
  if (
    max <= 0 ||
    x < bounds.x ||
    x >= bounds.x + bounds.width ||
    y < bounds.y ||
    y >= bounds.y + bounds.height
  ) {
    return null;
  }
  const ratio = bounds.width <= 1 ? 0 : (x - bounds.x) / Math.max(1, bounds.width - 1);
  return Math.min(max, Math.max(0, ratio * max));
}

export const ProgressBar = React.memo(function ProgressBar({
  value,
  max,
  width = 20,
  color = palette.accentDeep,
  onSelect,
}: {
  value: number;
  max: number;
  width?: number;
  color?: string;
  /** Enables terminal left-click seeking within this bar's measured bounds. */
  onSelect?: (value: number) => void;
}) {
  const barRef = React.useRef<React.ElementRef<typeof Box>>(null);
  const { stdin, isRawModeSupported } = useStdin();
  const { stdout } = useStdout();
  const { filled, track } = barFill(value, max, width);

  React.useEffect(() => {
    if (!onSelect || !isRawModeSupported || max <= 0) return undefined;
    const handleMouse = (chunk: Buffer | string) => {
      const input = String(chunk);
      for (const match of input.matchAll(SGR_MOUSE_EVENT)) {
        const button = Number(match[1]);
        const column = Number(match[2]);
        const row = Number(match[3]);
        if (button !== 0 || match[4] !== "M" || !barRef.current) continue;
        const bounds = measureElement(barRef.current);
        const selected = progressBarValueFromClick(column, row, bounds, max);
        if (selected !== null) onSelect(selected);
      }
    };
    stdout.write("\u001b[?1000h\u001b[?1006h");
    stdin.on("data", handleMouse);
    return () => {
      stdin.off("data", handleMouse);
      stdout.write("\u001b[?1000l\u001b[?1006l");
    };
  }, [isRawModeSupported, max, onSelect, stdin, stdout]);

  return (
    <Box ref={barRef}>
      <Text color={color}>{"█".repeat(filled)}</Text>
      <Text color={palette.dim}>{"┈".repeat(track)}</Text>
    </Box>
  );
});
