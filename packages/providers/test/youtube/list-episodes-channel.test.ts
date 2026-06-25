import { afterEach, describe, expect, test } from "bun:test";

import {
  configureYoutubeProvider,
  toYoutubeChannelCatalogId,
  youtubeProviderModule,
} from "@kunai/providers/youtube";
import type { ProviderRuntimeContext } from "@kunai/types";

const TEST_CONTEXT: ProviderRuntimeContext = {
  providerId: "youtube",
  now: () => new Date().toISOString(),
};

describe("listYoutubeEpisodes channel", () => {
  const originalFetch = globalThis.fetch;
  const preferred = "https://invidious.test";

  afterEach(() => {
    globalThis.fetch = originalFetch;
    configureYoutubeProvider({});
  });

  test("maps latestVideos from channel root response", async () => {
    configureYoutubeProvider({ invidiousInstanceUrl: preferred });
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.startsWith(`${preferred}/api/v1/channels/`)) {
        return new Response(
          JSON.stringify({
            author: "Test Channel",
            latestVideos: [{ title: "First upload", videoId: "dQw4w9WgXcQ", lengthSeconds: 212 }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const listEpisodes = youtubeProviderModule.listEpisodes;
    if (!listEpisodes) throw new Error("YouTube provider listEpisodes adapter is not configured");

    const episodes = await listEpisodes(
      {
        title: {
          id: toYoutubeChannelCatalogId("UCtestchannel1"),
          kind: "video",
          title: "Test Channel",
        },
      },
      TEST_CONTEXT,
    );

    expect(episodes).not.toBeNull();
    expect(episodes).toHaveLength(1);
    expect(episodes?.[0]?.name).toBe("First upload");
    expect(episodes?.[0]?.externalIds?.youtubeId).toBe("dQw4w9WgXcQ");
    expect(episodes?.[0]?.label).toContain("3:32");
  });
});
