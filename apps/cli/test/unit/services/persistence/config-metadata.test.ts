import { describe, expect, test } from "bun:test";

import { CONFIG_METADATA, getConfigMetadata } from "@/services/persistence/config-metadata";

describe("config metadata", () => {
  test("describes user-facing timing and privacy for key runtime settings", () => {
    expect(getConfigMetadata("recoveryMode")).toMatchObject({
      section: "playback",
      effect: "next-playback",
      privacy: "local",
      editable: true,
      options: ["guided", "fallback-first", "manual"],
    });
    expect(getConfigMetadata("startupPriority")).toMatchObject({
      section: "playback",
      effect: "next-resolve",
      options: ["balanced", "fast", "quality-first"],
    });
    expect(getConfigMetadata("presenceDiscordClientId")).toMatchObject({
      section: "presence",
      effect: "after-save",
      envOverride: "KUNAI_DISCORD_CLIENT_ID",
      privacy: "sensitive",
    });
  });

  test("keeps metadata ids unique and stable", () => {
    const ids = CONFIG_METADATA.map((entry) => entry.key);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("footerHints");
    expect(ids).toContain("downloadsEnabled");
    expect(ids).toContain("powerSaverMode");
  });
});
