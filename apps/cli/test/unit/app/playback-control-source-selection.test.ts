import { describe, expect, test } from "bun:test";

import { applyPlaybackControlSourceSelection } from "@/app/playback/playback-control-source-selection";

const episode = { season: 1, episode: 5 };

describe("playback control source selection", () => {
  test("source id selections become title-level manual source picks", async () => {
    const calls: string[] = [];

    await applyPlaybackControlSourceSelection({
      providerId: "vidking",
      episode,
      selection: { sourceId: "source:zoro", streamId: null },
      deps: {
        applyManualSourcePick: async (providerId, targetEpisode, sourceId) => {
          calls.push(
            `manual:${providerId}:${targetEpisode.season}:${targetEpisode.episode}:${sourceId}`,
          );
        },
        applyEpisodeSelection: async () => {
          calls.push("episode");
        },
      },
    });

    expect(calls).toEqual(["manual:vidking:1:5:source:zoro"]);
  });

  test("stream-only selections stay episode-specific", async () => {
    const calls: string[] = [];

    await applyPlaybackControlSourceSelection({
      providerId: "vidking",
      episode,
      selection: { sourceId: null, streamId: "stream-1080" },
      deps: {
        applyManualSourcePick: async () => {
          calls.push("manual");
        },
        applyEpisodeSelection: async (providerId, targetEpisode, selection) => {
          calls.push(
            `episode:${providerId}:${targetEpisode.season}:${targetEpisode.episode}:${selection.streamId}`,
          );
        },
      },
    });

    expect(calls).toEqual(["episode:vidking:1:5:stream-1080"]);
  });
});
