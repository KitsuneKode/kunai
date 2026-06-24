import { describe, expect, test } from "bun:test";

import { buildTrackPickTransitionContext } from "@/app/playback/tracks-panel-pick";

const episode = { season: 1, episode: 3 };

describe("tracks panel pick transition context", () => {
  test("captures provider switches from the provider before mutation", () => {
    expect(
      buildTrackPickTransitionContext({
        titleId: "1396",
        episode,
        fromProviderId: "vidking",
        selection: { sourceId: null, streamId: null, providerId: "rivestream" },
      }),
    ).toEqual({
      titleId: "1396",
      season: 1,
      episode: 3,
      fromProvider: "vidking",
      provider: "rivestream",
    });
  });

  test("captures cross-provider source switches with the source id", () => {
    expect(
      buildTrackPickTransitionContext({
        titleId: "1396",
        episode,
        fromProviderId: "vidking",
        selection: {
          sourceId: null,
          streamId: null,
          crossProviderSource: { providerId: "rivestream", sourceId: "server-2" },
        },
      }),
    ).toEqual({
      titleId: "1396",
      season: 1,
      episode: 3,
      fromProvider: "vidking",
      provider: "rivestream",
      sourceId: "server-2",
    });
  });

  test("keeps same-provider stream switches small", () => {
    expect(
      buildTrackPickTransitionContext({
        titleId: "1396",
        episode,
        fromProviderId: "vidking",
        selection: { sourceId: null, streamId: "1080p" },
      }),
    ).toEqual({
      titleId: "1396",
      season: 1,
      episode: 3,
      streamId: "1080p",
    });
  });
});
