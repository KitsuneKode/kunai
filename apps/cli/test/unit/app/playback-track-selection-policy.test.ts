import { describe, expect, test } from "bun:test";

import {
  applyPlaybackControlTrackSelection,
  buildTrackOverrideDiagnosticContext,
  type PlaybackTrackSelectionEffects,
} from "@/app/playback/playback-track-selection-policy";
import type { StreamSelectionIntent } from "@/app/playback/source-quality";
import type { EpisodeInfo } from "@/domain/types";

const episode: EpisodeInfo = { season: 2, episode: 7 };

function createEffects() {
  const calls: string[] = [];
  const effects: PlaybackTrackSelectionEffects = {
    applyManualSourcePick: async (providerId, targetEpisode, sourceId) => {
      calls.push(
        `manual:${providerId}:${targetEpisode.season}:${targetEpisode.episode}:${sourceId}`,
      );
    },
    applyEpisodeSelection: async (providerId, targetEpisode, selection) => {
      calls.push(
        `episode:${providerId}:${targetEpisode.season}:${targetEpisode.episode}:${describeSelection(selection)}`,
      );
    },
    prepareStreamSwitchRestart: async (targetEpisode) => {
      calls.push(`overlay:${targetEpisode.season}:${targetEpisode.episode}`);
    },
  };
  return { calls, effects };
}

function describeSelection(selection: StreamSelectionIntent): string {
  return selection.sourceId ?? selection.streamId ?? selection.audioMode ?? "empty";
}

describe("playback track selection policy", () => {
  test("source picks persist title source preference and restart through episode navigation", async () => {
    const { calls, effects } = createEffects();

    const result = await applyPlaybackControlTrackSelection({
      action: "pick-source",
      providerId: "vidking",
      episode,
      selection: { sourceId: "source:zoro", streamId: null },
      resumeSeconds: 91,
      effects,
    });

    expect(result).toEqual({
      startIntent: { startAt: 0, resumePromptAt: 91, suppressResumePrompt: false },
      diagnostic: {
        message: "Source override selected",
        context: { sourceId: "source:zoro", resumeSeconds: 91 },
      },
    });
    expect(calls).toEqual(["manual:vidking:2:7:source:zoro", "overlay:2:7"]);
  });

  test("stream picks persist episode stream preference and restart through episode navigation", async () => {
    const { calls, effects } = createEffects();

    const result = await applyPlaybackControlTrackSelection({
      action: "pick-stream",
      providerId: "vidking",
      episode,
      selection: { sourceId: null, streamId: "stream-1080" },
      resumeSeconds: 38,
      effects,
    });

    expect(result.startIntent).toEqual({
      startAt: 0,
      resumePromptAt: 38,
      suppressResumePrompt: false,
    });
    expect(result.diagnostic.message).toBe("Stream override selected");
    expect(calls).toEqual(["episode:vidking:2:7:stream-1080", "overlay:2:7"]);
  });

  test("quality picks persist episode stream preference and resume in place", async () => {
    const { calls, effects } = createEffects();

    const result = await applyPlaybackControlTrackSelection({
      action: "pick-quality",
      providerId: "vidking",
      episode,
      selection: { sourceId: null, streamId: "stream-720" },
      resumeSeconds: 12,
      effects,
    });

    expect(result).toEqual({
      startIntent: { startAt: 12, resumePromptAt: 0, suppressResumePrompt: true },
      diagnostic: {
        message: "Quality override selected",
        context: { streamId: "stream-720", resumeSeconds: 12 },
      },
    });
    expect(calls).toEqual(["episode:vidking:2:7:stream-720"]);
  });

  test("track override diagnostics keep only stable selection identifiers", () => {
    expect(
      buildTrackOverrideDiagnosticContext({
        section: "quality",
        selection: { sourceId: null, streamId: "stream-720" },
      }),
    ).toEqual({ section: "quality", streamId: "stream-720" });
  });
});
