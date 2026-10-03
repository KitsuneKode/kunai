import { describe, expect, test } from "bun:test";

import type { LocalEpisodePlaybackResolution } from "@/app/playback/episode-playback-source";
import { resolvePlaybackSourceAuthority } from "@/app/playback/playback-source-authority";
import type { Provider } from "@/services/providers/Provider";

const local: LocalEpisodePlaybackResolution = {
  stream: { url: "/library/movie.mp4", headers: {}, timestamp: 1 },
  jobId: "download-1",
  source: {
    kind: "local",
    jobId: "download-1",
    titleId: "tmdb:1",
    titleName: "Downloaded movie",
    mediaKind: "movie",
    providerId: "retired-provider",
    filePath: "/library/movie.mp4",
  },
  timing: null,
};

describe("playback source authority", () => {
  for (const offlineOnly of [true, false]) {
    test(`verified local media precedes provider lookup (offlineOnly=${offlineOnly})`, async () => {
      const result = await resolvePlaybackSourceAuthority({
        configuredProviderId: "retired-provider",
        offlineOnly,
        resolveLocal: async () => local,
        getProvider: () => {
          throw new Error("local media must not require a provider");
        },
      });
      expect(result).toEqual({ kind: "local", resolution: local });
      if (result.kind === "local") expect(result.resolution).toBe(local);
    });
  }

  test("unavailable offline media never falls through to a registered provider", async () => {
    const result = await resolvePlaybackSourceAuthority({
      configuredProviderId: "still-registered",
      offlineOnly: true,
      resolveLocal: async () => null,
      getProvider: () => {
        throw new Error("offline-only must fail closed");
      },
    });
    expect(result).toEqual({ kind: "offline-unavailable" });
  });

  test("online acquisition without local media preserves the missing provider error", async () => {
    const reads: string[] = [];
    const result = await resolvePlaybackSourceAuthority({
      configuredProviderId: "retired-provider",
      offlineOnly: false,
      resolveLocal: async () => null,
      getProvider: (id) => {
        reads.push(id);
        return undefined;
      },
    });
    expect(result).toEqual({ kind: "provider-unavailable", providerId: "retired-provider" });
    expect(reads).toEqual(["retired-provider"]);
  });

  test("online acquisition returns the exact registered provider after local policy declines", async () => {
    const events: string[] = [];
    // Only object identity is needed; this test does not invoke the adapter.
    const provider = { metadata: { id: "registered" } } as Provider;
    const result = await resolvePlaybackSourceAuthority({
      configuredProviderId: "registered",
      offlineOnly: false,
      resolveLocal: async () => {
        events.push("local");
        return null;
      },
      getProvider: () => {
        events.push("provider");
        return provider;
      },
    });
    expect(result).toEqual({ kind: "provider", provider });
    expect(events).toEqual(["local", "provider"]);
  });
});
