import { describe, expect, test } from "bun:test";

import type { StreamSelectionIntent } from "@/app/playback/source-quality";
import {
  applyTrackPickRestart,
  type TrackPickRestartEffects,
} from "@/app/playback/track-pick-restart";
import type { EpisodeInfo } from "@/domain/types";

const episode: EpisodeInfo = { season: 1, episode: 4 };

function createEffects() {
  const calls: string[] = [];
  const effects: TrackPickRestartEffects = {
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
    invalidateRecentEpisodeStream: (targetEpisode) => {
      calls.push(`invalidate:${targetEpisode.season}:${targetEpisode.episode}`);
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

describe("track pick restart policy", () => {
  test("provider switch invalidates and asks for a fresh episode resolve", async () => {
    const { calls, effects } = createEffects();

    const result = await applyTrackPickRestart({
      resolved: { kind: "provider-switch", providerId: "rivestream" },
      currentProviderId: "vidking",
      episode,
      resumeSeconds: 120,
      effects,
    });

    expect(result).toEqual({
      startIntent: { startAt: 0, resumePromptAt: 120, suppressResumePrompt: false },
      resolvedProviderId: "rivestream",
      requiresFreshResolve: true,
    });
    expect(calls).toEqual(["invalidate:1:4"]);
  });

  test("cross-provider source switch persists the manual source pick before restart", async () => {
    const { calls, effects } = createEffects();

    const result = await applyTrackPickRestart({
      resolved: { kind: "cross-provider-source", providerId: "rivestream", sourceId: "server-2" },
      currentProviderId: "vidking",
      episode,
      resumeSeconds: 90,
      effects,
    });

    expect(result.resolvedProviderId).toBe("rivestream");
    expect(result.requiresFreshResolve).toBe(true);
    expect(result.startIntent).toEqual({
      startAt: 0,
      resumePromptAt: 90,
      suppressResumePrompt: false,
    });
    expect(calls).toEqual(["manual:rivestream:1:4:server-2", "invalidate:1:4", "overlay:1:4"]);
  });

  test("same-provider source switch persists a title source and restarts from navigation", async () => {
    const { calls, effects } = createEffects();

    const result = await applyTrackPickRestart({
      resolved: {
        kind: "stream-selection",
        section: "source",
        selection: { sourceId: "server-3", streamId: null },
      },
      currentProviderId: "vidking",
      episode,
      resumeSeconds: 45,
      effects,
    });

    expect(result).toEqual({
      startIntent: { startAt: 0, resumePromptAt: 45, suppressResumePrompt: false },
      resolvedProviderId: "vidking",
      requiresFreshResolve: true,
    });
    expect(calls).toEqual(["manual:vidking:1:4:server-3", "overlay:1:4"]);
  });

  test("quality stream switch saves the episode selection without fresh provider resolve", async () => {
    const { calls, effects } = createEffects();

    const result = await applyTrackPickRestart({
      resolved: {
        kind: "stream-selection",
        section: "quality",
        selection: { sourceId: null, streamId: "1080p" },
      },
      currentProviderId: "vidking",
      episode,
      resumeSeconds: 33,
      effects,
    });

    expect(result).toEqual({
      startIntent: { startAt: 33, resumePromptAt: 0, suppressResumePrompt: true },
      resolvedProviderId: "vidking",
      requiresFreshResolve: false,
    });
    expect(calls).toEqual(["episode:vidking:1:4:1080p"]);
  });
});
