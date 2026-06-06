import { describe, expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";

describe("autoplayRecommendations config", () => {
  test("defaults to true", () => {
    expect(DEFAULT_CONFIG.autoplayRecommendations).toBe(true);
  });
});
