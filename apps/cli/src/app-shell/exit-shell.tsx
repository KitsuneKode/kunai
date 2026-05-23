import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";

import { palette } from "./shell-theme";

type ExitStep = "dim" | "footer-gone" | "fox" | "closing" | "done";

const STEP_TIMINGS: Record<ExitStep, number> = {
  dim: 0, // initial state — not scheduled, here for completeness
  "footer-gone": 40,
  fox: 80,
  closing: 120,
  done: 200,
};

export function ExitShell({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<ExitStep>("dim");

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    const steps: ExitStep[] = ["footer-gone", "fox", "closing", "done"];
    steps.forEach((s) => {
      timers.push(
        setTimeout(() => {
          setStep(s);
          if (s === "done") onDone();
        }, STEP_TIMINGS[s]),
      );
    });

    return () => timers.forEach(clearTimeout);
  }, [onDone]);

  const isDim = step === "dim" || step === "footer-gone";

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text dimColor={isDim} color={palette.dim}>
        {step === "fox" || step === "closing" || step === "done" ? "◉  see you next time" : ""}
      </Text>
      {(step === "closing" || step === "done") && <Text color={palette.accent}>◈ kunai</Text>}
    </Box>
  );
}
