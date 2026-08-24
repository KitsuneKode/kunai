import { describe, expect, test } from "bun:test";

import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import { rivestreamProviderModule } from "../src/rivestream/direct";

const CONTEXT = {
  providerId: "rivestream",
  now: () => new Date().toISOString(),
  fetch: {
    runtime: "direct-http",
    fetch: async () => {
      throw new Error("network must not be reached for invalid input");
    },
  },
} as unknown as ProviderRuntimeContext;

function buildInput(overrides: Record<string, unknown> = {}): ProviderResolveInput {
  return {
    mediaKind: "series",
    title: { id: "tmdb:1396", title: "Breaking Bad", tmdbId: 1396 },
    allowedRuntimes: ["direct-http"],
    qualityPreference: "best",
    startupPriority: "balanced",
    ...overrides,
  } as unknown as ProviderResolveInput;
}

async function resolve(input: ProviderResolveInput) {
  const { resolve: resolveStream } = rivestreamProviderModule;
  if (!resolveStream) throw new Error("rivestream module must expose resolve");
  return resolveStream(input, CONTEXT);
}

describe("rivestream input validation", () => {
  test("a series with no episode fails closed instead of playing S1E1", async () => {
    // The old `?? 1` default silently played the pilot — wrong content is worse
    // than no content.
    const result = await resolve(buildInput());
    expect(result.status).toBe("exhausted");
    expect(result.failures.at(-1)?.message).toContain("season and episode");
  });

  test("a series missing only the episode number still fails closed", async () => {
    const result = await resolve(buildInput({ episode: { season: 2 } }));
    expect(result.status).toBe("exhausted");
    // Assert on the reason, not just the status: a network throw also exhausts,
    // which would let the old `?? 1` default pass this test.
    expect(result.failures.at(-1)?.message).toContain("season and episode");
  });

  test("season 0 specials remain resolvable", async () => {
    // Reaching the network proves validation passed; the stub then throws.
    const result = await resolve(buildInput({ episode: { season: 0, episode: 1 } }));
    expect(result.failures.at(-1)?.message).not.toContain("season and episode");
  });

  test.each([
    ["tmdb:0", 0],
    ["tmdb:-5", -5],
    ["tmdb:007", 7],
    ["tmdb:abc", "abc"],
  ])("rejects a malformed TMDB id (%s)", async (id) => {
    const result = await resolve(
      buildInput({
        mediaKind: "movie",
        title: { id, title: "bad id" },
        episode: undefined,
      }),
    );
    expect(result.status).toBe("exhausted");
    expect(result.failures.at(-1)?.message).toContain("numeric TMDB ID");
  });

  test("a valid movie id passes validation and reaches the network", async () => {
    const result = await resolve(
      buildInput({ mediaKind: "movie", title: { id: "tmdb:27205", title: "Inception" } }),
    );
    expect(result.failures.at(-1)?.message).not.toContain("numeric TMDB ID");
  });
});
