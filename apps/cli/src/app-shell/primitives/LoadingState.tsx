import { Box, Text } from "ink";
import React from "react";

import { reducedMotionEnabled } from "../motion-policy";
import { useIsInsideOverlay } from "../overlay-layout-context";
import { palette } from "../shell-theme";
import { STATIC_PETAL } from "./SakuraPetal";

const BUSY_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function useBrailleSpinner(active: boolean): string {
  const [frame, setFrame] = React.useState(0);
  const reduced = reducedMotionEnabled();
  const animate = active && !reduced;
  React.useEffect(() => {
    if (!animate) return undefined;
    const timer = setInterval(() => setFrame((value) => (value + 1) % BUSY_FRAMES.length), 80);
    return () => clearInterval(timer);
  }, [animate]);
  // Under reduced motion the message still says it is busy; the glyph just stops cycling.
  return reduced ? STATIC_PETAL : (BUSY_FRAMES[frame] ?? "⠋");
}

export function LoadingState({
  message,
  subtitle,
  active = true,
  framed,
}: {
  readonly message: string;
  readonly subtitle?: string;
  readonly active?: boolean;
  /** When true, skip extra chrome when the overlay host already frames the pane. */
  readonly framed?: boolean;
}) {
  const insideOverlay = useIsInsideOverlay();
  const skipChrome = framed ?? insideOverlay;
  const spinner = useBrailleSpinner(active);

  return (
    <Box marginTop={skipChrome ? 0 : 1} flexDirection="column">
      <Text color={palette.accent}>
        {spinner} {message}
      </Text>
      {subtitle ? <Text color={palette.dim}>{subtitle}</Text> : null}
    </Box>
  );
}
