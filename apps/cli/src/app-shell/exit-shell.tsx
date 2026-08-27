import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";

import { CompanionPet } from "./CompanionPet";
import { palette } from "./shell-theme";

type ExitStep = "dim" | "footer-gone" | "fox" | "closing" | "done";

const STEP_TIMINGS = {
  dim: 0, // initial state — not scheduled, here for completeness
  "footer-gone": 40,
  fox: 80,
  // The pet needs a local PNG upload; 200ms total exited before Kitty painted.
  closing: 420,
  done: 640,
} satisfies Record<ExitStep, number>;

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
  const showFox = step === "fox" || step === "closing" || step === "done";

  return (
    <Box flexDirection="column" paddingY={1}>
      {showFox ? (
        <Box marginBottom={1}>
          <CompanionPet pose="idle" rows={4} cols={6} />
        </Box>
      ) : null}
      <Text dimColor={isDim} color={palette.dim}>
        {showFox ? "◉  see you next time" : ""}
      </Text>
      {(step === "closing" || step === "done") && <Text color={palette.accent}>◈ kunai</Text>}
    </Box>
  );
}
