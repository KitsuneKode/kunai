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
import { join } from "node:path";

import { DEFAULT_CONFIG } from "@kunai/config";

import {
  createIsolatedCliProfile,
  disposeIsolatedCliProfile,
} from "../integration/helpers/isolated-container";
import { K } from "./keys";
import { startTmuxSession, type TmuxSession } from "./tmux-session";

const hasTmux = Bun.which("tmux") !== null;
if (!hasTmux) {
  // Loud skip — the skip line carries the reason, not silence.
  console.log("onboarding tier skipped: tmux not on PATH");
}

const itTmux = hasTmux ? it : it.skip;

/**
 * Move off the first mode row. Setup's input handler attaches in an effect
 * after the first paint, so a key sent the instant "What do you watch most?"
 * appears can land before anything listens. Resend only while the highlight
 * is still on the first row: a press that did land has moved it, so this can
 * never overshoot.
 */
async function moveToSecondMode(s: TmuxSession): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await s.send(K.down);
    try {
      await s.waitFor((f) => f.includes("▌ Anime"), "Anime highlighted", 2_000);
      return;
    } catch (error) {
      if (!(await s.see()).includes("▌ Shows & movies")) throw error;
    }
  }
  await s.waitFor((f) => f.includes("▌ Anime"), "Anime highlighted");
}

describe("agent driver · fresh-profile onboarding", () => {
  itTmux("the expanded preview owns input at 40×16", async () => {
    const s = await startTmuxSession({ seed: "fresh", columns: 40, rows: 16 });
    try {
      await s.waitFor((f) => f.includes("What do you watch most?"), "quick setup");
      const consentState = () => {
        const config = s.inspect().config();
        return {
          analytics: config.analytics ?? "unset",
          analyticsNoticeShown: config.analyticsNoticeShown ?? false,
          installId: config.installId ?? "",
          onboardingVersion: config.onboardingVersion ?? 0,
          downloadOnboardingDismissed: config.downloadOnboardingDismissed ?? false,
        };
      };
      const before = consentState();
      await s.send(K.enter);
      await s.waitFor((f) => f.includes("Share anonymous usage?"), "neutral consent");
      await s.send(K.enter);
      await s.send("S");
      await s.send("p");
      await s.waitFor((f) => f.includes("Any key goes back."), "expanded preview");
      await s.send(K.esc);
      await s.waitFor((f) => f.includes("Share anonymous usage?"), "Escape closes preview");
      expect(consentState()).toEqual(before);

      await s.send(K.down);
      await s.waitFor((f) => f.includes("▌ Share anonymous usage"), "share row highlighted");
      for (const key of ["s", K.ctrlC]) {
        await s.send("p");
        await s.waitFor((f) => f.includes("Any key goes back."), "expanded preview");
        await s.send(key);
        await s.waitFor((f) => f.includes("▌ Share anonymous usage"), "preview closes only");
        expect(consentState()).toEqual(before);
        expect(await s.isDead()).toBe(false);
      }

      await s.send("s");
      await s.waitFor((f) => f.includes("Setup saved"), "explicit decline finishes setup");
      const config = s.inspect().config();
      expect(config.onboardingVersion).toBeGreaterThan(0);
      expect(config.analytics).toBe("disabled");
      expect(config.installId).toBe("");
    } finally {
      await s.stop();
    }
  });

  itTmux("quick setup only writes mode, consent and onboarding keys in config.json", async () => {
    const profile = createIsolatedCliProfile("quick-setup-config");
    try {
      await Bun.write(
        profile.paths.configPath,
        JSON.stringify({
          ...DEFAULT_CONFIG,
          downloadPath: join(profile.rootDir, "my-downloads"),
          defaultDownloadQuality: "2160p",
          downloadsEnabled: true,
          autoNext: false,
          skipIntro: false,
          updateChecksEnabled: false,
          seriesLanguageProfile: { audio: "ja", subtitle: "none", quality: "720p" },
        }),
      );
      const s = await startTmuxSession({ profile, seed: "fresh", keepProfile: true });
      try {
        await s.waitFor((f) => f.includes("What do you watch most?"), "quick setup");
        const before = s.inspect().config();
        expect(before.defaultDownloadQuality).toBe("2160p");
        await moveToSecondMode(s);
        await s.send(K.enter);
        await s.waitFor((f) => f.includes("Share anonymous usage"), "neutral consent");
        await s.send("s");
        await s.waitFor((f) => f.includes("Setup saved"), "quick setup committed");
        const after = s.inspect().config();
        expect(after.onboardingVersion).toBeGreaterThan(0);
        expect(after).toEqual({
          ...before,
          defaultMode: "anime",
          analytics: "disabled",
          onboardingVersion: after.onboardingVersion,
          downloadOnboardingDismissed: true,
        });
      } finally {
        await s.stop();
      }
    } finally {
      disposeIsolatedCliProfile(profile);
    }
  });

  itTmux(
    "the setup wizard commits an onboarded config without touching analytics",
    async () => {
      const s = await startTmuxSession({
        name: "onboarding-proof",
        seed: "fresh",
        command: "--setup",
      });
      try {
        // First paint is a cold `bun src/main.ts` boot inside tmux — on a
        // throttled CI runner that legitimately exceeds the 15s default.
        await s.waitFor((f) => f.includes("Let's get you watching"), "setup step 1", 45_000);
        // `s` accepts the recommended mode pick on step 2; `S` fast-forwards
        // the remaining preference steps; Enter on the summary commits.
        await s.send("s");
        await s.waitFor((f) => f.includes("setup 2"), "setup step 2");
        await s.send("S");
        await s.waitFor((f) => f.includes("setup 6"), "setup summary");
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
