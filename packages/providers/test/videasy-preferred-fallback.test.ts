import { describe, expect, test } from "bun:test";

import type { ProviderRuntimeContext } from "@kunai/types";

import { videasyProviderModule } from "../src/videasy/direct";
import { isVidkingSourceDeprecated } from "../src/videasy/flavors";

const context = {
  now: () => new Date().toISOString(),
  signal: AbortSignal.timeout(120_000),
  retryPolicy: { maxAttempts: 2, backoff: "none" as const },
  fetch: { runtime: "direct-http" as const, fetch },
  emit: () => {},
} satisfies ProviderRuntimeContext;

describe("videasy preferred source fallback", () => {
  test("deprecated Sanji source id is recognized", () => {
    expect(isVidkingSourceDeprecated("source:videasy:1movies")).toBe(true);
    expect(isVidkingSourceDeprecated("source:videasy:mb-flix")).toBe(false);
  });

  test("deprecated preferred source falls back to Phase A mirrors", async () => {
    const result = await videasyProviderModule.resolve(
      {
        title: { id: "248244", title: "Undercover High School", tmdbId: "248244", kind: "series" },
        mediaKind: "series",
        episode: { season: 1, episode: 4 },
        allowedRuntimes: ["direct-http"],
        startupPriority: "balanced",
        preferredSourceId: "source:videasy:1movies",
        intent: "play",
      },
      context,
    );

    expect(result.status).toBe("resolved");
    expect(
      result.sources?.some((source) => source.status === "selected" && source.label === "Luffy"),
    ).toBe(true);
  }, 120_000);
});
