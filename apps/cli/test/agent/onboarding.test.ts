/**
 * Fresh-profile onboarding proof (L3, tmux-gated).
 *
 * The setup wizard only runs on a real TTY — L2's in-process stdin correctly
 * skips it — so this scenario lives on the tmux driver over real `main.ts`.
 * On hosts without tmux it lands in the skip line, not the failure line.
 *
 * What it proves beyond "the wizard renders": the committed config is the
 * wizard's real output (onboardingVersion set, mode saved) AND the analytics
 * contract held — nobody keystroked consent, so it must stay "unset".
 */
import { describe, expect, it } from "bun:test";

import { startTmuxSession } from "./tmux-session";

const hasTmux = Bun.which("tmux") !== null;
if (!hasTmux) {
  // Loud skip — the skip line carries the reason, not silence.
  console.log("onboarding tier skipped: tmux not on PATH");
}

const itTmux = hasTmux ? it : it.skip;

describe("agent driver · fresh-profile onboarding", () => {
  itTmux(
    "the setup wizard commits an onboarded config without touching analytics",
    async () => {
      const s = await startTmuxSession({ name: "onboarding-proof", seed: "fresh" });
      try {
        await s.waitFor((f) => f.includes("Let's get you watching"), "setup step 1");
        // `s` accepts the recommended mode pick on step 2; `S` fast-forwards
        // the remaining preference steps; Enter on the summary commits.
        await s.send("s");
        await s.waitFor((f) => f.includes("setup 2"), "setup step 2");
        await s.send("S");
        await s.waitFor((f) => f.includes("setup 7"), "setup summary");
        await s.send("\r");
        await s.waitFor((f) => f.includes("Search title"), "browse shell after wizard");

        const config = s.inspect().config();
        expect(config.onboardingVersion).toBeGreaterThan(0);
        expect(config.analytics).toBe("unset");
      } finally {
        await s.stop();
      }
    },
    90_000,
  );
});
