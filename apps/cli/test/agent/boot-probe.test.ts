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
