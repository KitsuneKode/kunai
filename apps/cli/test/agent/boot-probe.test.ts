import { afterEach, describe, expect, it } from "bun:test";

import { createAgentSession, type AgentSession } from "./agent-driver";

describe("agent driver boot", () => {
  let session: AgentSession | null = null;
  afterEach(async () => {
    await session?.dispose();
    session = null;
  });

  it("mounts the real root shell on a seeded profile", async () => {
    session = await createAgentSession({ label: "boot-probe" });
    await session.waitSettled();
    const frame = session.frame();
    console.log("=== FRAME ===\n" + frame + "\n=== END ===");
    expect(frame.length).toBeGreaterThan(0);
    session.assertPrivacyClean();
  });
});

it("L2 shell uses the seeded movie subtitle profile, matching main startup", async () => {
  const s = await createAgentSession({ label: "boot-profile", mpv: "fake", fakeMpvMode: "hold" });
  try {
    await s.waitSettled();
    s.press("smoke", "\r");
    await s.waitForFrame((frame) => frame.includes("Smoke Movie"), "fixture results");
    s.press("\r");
    await s.waitForFrame((frame) => frame.includes("Tracks and subtitles"), "playing surface");
    expect(s.inspect().config().movieLanguageProfile).toMatchObject({ subtitle: "none" });
    expect(s.frame()).toContain("subs off");
  } finally {
    await s.dispose();
  }
});
