import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";

import { createAgentSession } from "./agent-driver";
import { onboardedConfig } from "./seed";

test("agent launch refuses an override of its analytics suppression", async () => {
  let rejection = "";
  const session = await createAgentSession({
    label: "privacy-override",
    extraEnv: { DO_NOT_TRACK: "0", CI: "0" },
  }).catch((error) => {
    rejection = error instanceof Error ? error.message : String(error);
    return null;
  });
  try {
    expect(rejection).toBe("cannot override isolated profile env: DO_NOT_TRACK");
  } finally {
    await session?.dispose();
  }
});

test("agent privacy assertion reports identity presence without printing the raw id", async () => {
  const session = await createAgentSession({ label: "privacy-message" });
  const id = "11111111-2222-4333-8444-555555555555";
  try {
    writeFileSync(
      session.profile.paths.configPath,
      JSON.stringify({ ...onboardedConfig(), installId: id }),
    );
    let message = "";
    try {
      session.assertPrivacyClean();
    } catch (error) {
      message = String(error);
    }
    expect(message.includes("privacy invariant")).toBe(true);
    expect(message.includes(id)).toBe(false);
  } finally {
    writeFileSync(session.profile.paths.configPath, JSON.stringify(onboardedConfig()));
    await session.dispose();
  }
});
