/**
 * L2 wiring for the experimental Stremio addon opt-in: the REAL shell drives
 * Settings → search → the "Experimental: Stremio addons" submenu, and every
 * pick is asserted against config.json — the silent no-op class unit tests
 * cannot see (a submenu that updates the draft but never writes).
 */
import { describe, expect, it } from "bun:test";

import { isJsonString } from "@kunai/types";

import { createAgentSession, type AgentSession } from "./agent-driver";
import { K } from "./keys";

async function withSession(
  label: string,
  options: Parameters<typeof createAgentSession>[0],
  run: (session: AgentSession) => Promise<void>,
): Promise<void> {
  const session = await createAgentSession({ ...options, label });
  try {
    await run(session);
    session.assertPrivacyClean();
  } finally {
    await session.dispose();
  }
}

describe("agent wiring · stremio addons opt-in", () => {
  it("enable writes flag+ack through the real Settings pipeline; disable keeps them", async () => {
    await withSession("wiring-addons-opt-in", {}, async (s) => {
      await s.waitForFrame((f) => f.includes("Search title"), "browse shell");

      s.press("/");
      await s.waitForFrame((f) => f.includes("command"), "command palette");
      s.press("settings", K.enter);
      await s.waitForFrame((f) => f.includes("Footer hints"), "settings panel");
      await s.waitSettled();

      // Filter to the one row instead of tabbing through every section. `/`
      // enters the filter (it is not filter text); a first Enter only leaves
      // the search field, a second opens the selected row's submenu.
      const openSubmenu = async (expectText: string, label: string) => {
        await s.waitSettled();
        // Clear whatever query state the last pick left, then filter fresh —
        // appending to a stale query would hide the row entirely.
        s.press("/", ...Array(12).fill(K.backspace), "experimental");
        await s.waitForFrame(
          (f) => f.includes("Experimental: Stremio addons"),
          `${label}: filtered row`,
        );
        s.press(K.enter);
        await s.waitSettled();
        s.press(K.enter);
        await s.waitForFrame((f) => f.includes(expectText), label);
      };

      // The submenu's subtitle is the shared risk warning while the feature
      // is off and unacknowledged.
      await openSubmenu(
        "Stremio addons are third-party servers you choose",
        "submenu shows the risk warning",
      );
      // The controller starts on index 0 — "Keep addons off". Enter on the
      // default choice is a no-op by design: nothing may be written.
      s.press(K.enter);
      await s.waitForFrame(
        (f) => !f.includes("third-party servers you choose"),
        "submenu closed after keep-off",
      );
      const afterKeep = s.inspect().config();
      expect(afterKeep.experimentalStremioAddons).not.toBe(true);
      expect(afterKeep.stremioAddonsRiskAcknowledgedAt).toBeFalsy();

      // Re-open: the full warning is still on screen (no acknowledgement yet);
      // move to the explicit "Enable addons" choice and pick it.
      await openSubmenu("Stremio addons are third-party servers you choose", "submenu again");
      expect(s.frame()).toContain("Enable addons");
      await s.waitSettled();
      s.press(K.down, K.enter);
      await s.waitForBackend((i) => {
        const config = i.config();
        const ack = config.stremioAddonsRiskAcknowledgedAt;
        return config.experimentalStremioAddons === true && isJsonString(ack) && ack.length > 0;
      }, "config: flag + acknowledgement persisted");
      const acknowledgedAt = s.inspect().config().stremioAddonsRiskAcknowledgedAt;

      // Re-open while on: the warning is gone (acknowledged), and Disable is
      // the second choice.
      await openSubmenu("Disable addons", "on submenu");
      s.press(K.down, K.enter);
      await s.waitForBackend(
        (i) => i.config().experimentalStremioAddons === false,
        "config: flag disabled",
      );

      // The acknowledgement survives the disable — the file keeps it, and a
      // reopened submenu shows post-ack guidance, not the warning again.
      expect(s.inspect().config().stremioAddonsRiskAcknowledgedAt).toBe(acknowledgedAt);
      await openSubmenu("Enable addons", "off-after-ack submenu");
      expect(s.frame()).not.toContain("third-party servers you choose");
    });
  });
});
