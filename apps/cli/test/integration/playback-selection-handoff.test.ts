import { describe, expect, test } from "bun:test";

import { PlaybackSelectionCoordinator } from "@/app/playback-selection-coordinator";
import { resolveEffectiveStreamSelection } from "@/domain/playback/playback-selection-policy";
import type { EpisodeInfo } from "@/domain/types";
import { EpisodePlaybackSelectionService } from "@/services/playback/EpisodePlaybackSelectionService";
import { TitlePlaybackSourceService } from "@/services/playback/TitlePlaybackSourceService";
import { streamRequestToResolveInput } from "@/services/providers/stream-request-adapter";

const title = {
  id: "allanime:show-demo",
  type: "series" as const,
  name: "Demo Anime",
};

const e1: EpisodeInfo = { season: 1, episode: 1 };
const e2: EpisodeInfo = { season: 1, episode: 2 };

describe("playback selection handoff", () => {
  test("E1 manual source pick flows into E2 resolve without carrying streamId", async () => {
    class MockEpisodeStore {
      async get() {
        return null;
      }
      async set() {}
    }

    class MockTitleStore {
      data: { sourceId: string; updatedAt: string } | null = null;
      async get() {
        return this.data;
      }
      async set(input: { sourceId: string }) {
        this.data = { sourceId: input.sourceId, updatedAt: "now" };
      }
    }

    const coordinator = new PlaybackSelectionCoordinator({
      titleId: title.id,
      episodePlaybackSelection:
        new MockEpisodeStore() as unknown as EpisodePlaybackSelectionService,
      titlePlaybackSource: new MockTitleStore() as unknown as TitlePlaybackSourceService,
    });

    await coordinator.applyManualSourcePick("vidking", e1, "source:zoro");
    await coordinator.hydrateTitleSource("vidking");

    const effective = coordinator.getEffective("vidking", e2);
    expect(effective).toEqual({ sourceId: "source:zoro", streamId: null });
    expect(resolveEffectiveStreamSelection({ titleSourceId: effective.sourceId })).toEqual({
      sourceId: "source:zoro",
      streamId: null,
    });

    const resolveInput = streamRequestToResolveInput(
      {
        title,
        episode: e2,
        audioPreference: "original",
        subtitlePreference: "en",
        selectedSourceId: effective.sourceId ?? undefined,
        selectedStreamId: effective.streamId ?? undefined,
      },
      "anime",
    );

    expect(resolveInput.preferredSourceId).toBe("source:zoro");
    expect(resolveInput.preferredStreamId).toBeUndefined();
    expect(resolveInput.preferredPresentation).toBe("sub");
  });
});
