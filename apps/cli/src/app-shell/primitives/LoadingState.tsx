import { Box, Text } from "ink";
import React from "react";

import { useIsInsideOverlay } from "../overlay-layout-context";
import { palette } from "../shell-theme";

const BUSY_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function useBrailleSpinner(active: boolean): string {
  const [frame, setFrame] = React.useState(0);
  React.useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setFrame((value) => (value + 1) % BUSY_FRAMES.length), 80);
    return () => clearInterval(timer);
  }, [active]);
  return BUSY_FRAMES[frame] ?? "⠋";
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
      {subtitle ? (
        <Text color={palette.dim} dimColor>
          {subtitle}
        </Text>
      ) : null}
    </Box>
  );
}
