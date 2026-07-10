import { describe, expect, test } from "bun:test";

import type { ProviderRuntimeContext } from "@kunai/types";

import { resolveVidkingDirect } from "../src/videasy/direct";
import { isVidkingSourceDeprecated } from "../src/videasy/flavors";

/** db.videasy enrich fetch is separate from api.videasy resolve requests. */
function videasyResolveUrls(urls: readonly string[]): string[] {
  return urls.filter((url) => !url.includes("db.videasy.to"));
}

describe("videasy preferred source fallback", () => {
  test("deprecated Sanji source id is recognized", () => {
    expect(isVidkingSourceDeprecated("source:videasy:1movies")).toBe(true);
    expect(isVidkingSourceDeprecated("source:videasy:mb-flix")).toBe(false);
  });

  test("deprecated preferred source skips Sanji and probes Phase A mirrors", async () => {
    const requestedUrls: string[] = [];
    const result = await resolveVidkingDirect(
      {
        title: {
          id: "248244",
          title: "Undercover High School",
          tmdbId: "248244",
          kind: "series",
        },
        mediaKind: "series",
        episode: { season: 1, episode: 4 },
        allowedRuntimes: ["direct-http"],
        startupPriority: "balanced",
        preferredSourceId: "source:videasy:1movies",
        intent: "play",
      },
      {
        now: () => "2026-07-09T00:00:00.000Z",
        retryPolicy: { maxAttempts: 1, backoff: "none" },
        fetch: {
          runtime: "direct-http",
          fetch: async (input) => {
            requestedUrls.push(String(input));
            // Deterministic failure fixture: no live network. Per-server 404s
            // keep cycling through Phase A; session_missing would stop fanout.
            return new Response("", { status: 404 });
          },
        },
        emit: () => {},
      } satisfies ProviderRuntimeContext,
    );

    expect(result?.status).toBe("exhausted");

    const resolveUrls = videasyResolveUrls(requestedUrls);
    expect(resolveUrls.length).toBeGreaterThanOrEqual(1);
    expect(resolveUrls.every((url) => !url.includes("/1movies/"))).toBe(true);
    expect(resolveUrls.some((url) => url.includes("/mb-flix/"))).toBe(true);
    expect(resolveUrls.some((url) => url.includes("/cdn/") || url.includes("/downloader2/"))).toBe(
      true,
    );
  });
});
