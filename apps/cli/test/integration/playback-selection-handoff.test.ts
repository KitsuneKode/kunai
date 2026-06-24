import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PlaybackSelectionCoordinator } from "@/app/playback/playback-selection-coordinator";
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
  let dir = "";

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = "";
  });

  test("E1 manual source pick flows into E2 resolve without carrying streamId", async () => {
    dir = await mkdtemp(join(tmpdir(), "kunai-selection-handoff-"));
    const coordinator = new PlaybackSelectionCoordinator({
      titleId: title.id,
      episodePlaybackSelection: new EpisodePlaybackSelectionService(
        join(dir, "episode-playback-selections.json"),
      ),
      titlePlaybackSource: new TitlePlaybackSourceService(join(dir, "title-playback-sources.json")),
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
