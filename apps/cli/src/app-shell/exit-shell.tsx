import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";

import { companionMode } from "./companion-policy";
import { CompanionHost } from "./CompanionHost";
import { palette } from "./shell-theme";

type ExitStep = "dim" | "footer-gone" | "fox" | "closing" | "done";

/**
 * The original budget. Nothing is being uploaded, so nothing needs waiting for.
 */
const TEXT_TIMINGS = {
  dim: 0, // initial state — not scheduled, here for completeness
  "footer-gone": 40,
  fox: 80,
  closing: 120,
  done: 200,
} satisfies Record<ExitStep, number>;

/**
 * Longer, because the illustrated pet needs a local PNG upload and 200ms total
 * exited before Kitty had painted.
 *
 * This is only spent when the pet will actually appear. Charging every user
 * 440ms of extra exit for an image their terminal cannot render is the kind of
 * cost that never shows up in a benchmark and is felt on every single quit.
 */
const GRAPHICS_TIMINGS = {
  dim: 0,
  "footer-gone": 40,
  fox: 80,
  closing: 420,
  done: 640,
} satisfies Record<ExitStep, number>;

export function ExitShell({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<ExitStep>("dim");
  // Resolved once: the terminal's capabilities do not change mid-quit, and this
  // has to stay stable for the effect below that schedules against it.
  const [timings] = useState(() =>
    companionMode() === "graphics" ? GRAPHICS_TIMINGS : TEXT_TIMINGS,
  );

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    const steps: ExitStep[] = ["footer-gone", "fox", "closing", "done"];
    steps.forEach((s) => {
      timers.push(
        setTimeout(() => {
          setStep(s);
          if (s === "done") onDone();
        }, timings[s]),
      );
    });

    return () => timers.forEach(clearTimeout);
  }, [onDone, timings]);

  const isDim = step === "dim" || step === "footer-gone";
  const showFox = step === "fox" || step === "closing" || step === "done";

  return (
    <Box flexDirection="column" paddingY={1}>
      <CompanionHost moment={showFox ? "farewell" : null} rows={4} marginBottom={1} />
      <Text dimColor={isDim} color={palette.dim}>
        {showFox ? "◉  see you next time" : ""}
      </Text>
      {(step === "closing" || step === "done") && <Text color={palette.accent}>◈ kunai</Text>}
    </Box>
  );
}
