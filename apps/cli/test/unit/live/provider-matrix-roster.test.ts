import { describe, expect, test } from "bun:test";

import { loadProductionProviderModules } from "@/container/bootstrap-providers";
import { createProviderPrioritySnapshot } from "@/services/providers/provider-priority";
import { DEFAULT_CONFIG } from "@kunai/config";

import { MATRIX } from "../../live/provider-matrix-roster";

describe("provider matrix roster", () => {
  test("names every production provider and no retired one", async () => {
    const modules = await loadProductionProviderModules(
      createProviderPrioritySnapshot(DEFAULT_CONFIG),
    );
    const live = modules.map((module) => module.providerId).sort();
    const matrix = MATRIX.map((entry) => entry.provider).sort();

    expect(matrix).toEqual(live);
    expect(matrix).not.toContain("anidb");
    expect(new Set(matrix).size).toBe(matrix.length);
  });

  test("every row has a smoke command", () => {
    for (const entry of MATRIX) {
      expect(entry.command.length).toBeGreaterThan(0);
      expect(entry.fixture.length).toBeGreaterThan(0);
    }
  });
});
