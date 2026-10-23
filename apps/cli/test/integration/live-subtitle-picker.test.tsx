import { expect, spyOn, test } from "bun:test";

import { AppRoot, openPlaybackStreamSelectionPicker } from "@/app-shell/ink-shell";
import { forceSettleAllRootContent } from "@/app-shell/root-content-state";
import { resolveTracksPanelPick } from "@/app/playback/tracks-panel-pick";
import { disposeContainer } from "@/container/dispose-container";
import type { StreamInfo } from "@/domain/types";
import type { PlaybackSubtitleSelection } from "@/infra/player/PlayerControlService";
import React, { act } from "react";

import { render } from "../harness/render-capture";
import { waitUntil } from "../support/wait-until";
import { createIsolatedContainer } from "./helpers/isolated-container";

const subtitleUrl = "https://subs.example/fr.vtt";
function subtitleStream(): StreamInfo {
  return {
    url: "https://media.example/video.mp4",
    headers: {},
    timestamp: Date.now(),
    providerResolveResult: {
      status: "resolved",
      providerId: "vidlink",
      streams: [],
      subtitles: [
        {
          id: "fr",
          providerId: "vidlink",
          url: subtitleUrl,
          language: "fr",
          label: "French",
          format: "vtt",
          confidence: 1,
          source: "provider",
          cachePolicy: { ttlClass: "subtitle-list", scope: "local", keyParts: [] },
        },
      ],
      trace: {
        id: "subtitle-fixture",
        startedAt: new Date().toISOString(),
        title: { id: "tmdb:1", kind: "movie", title: "Subtitle fixture" },
        cacheHit: false,
        steps: [],
        failures: [],
      },
      failures: [],
    },
  };
}

test.each(["provider", "attached"] as const)(
  "the rendered live subtitle picker selects a %s track and then turns it off",
  async (trackOrigin) => {
    const { container, dispose } = await createIsolatedContainer("live-subtitle-picker");
    const selections: PlaybackSubtitleSelection[] = [];
    container.stateManager.dispatch({
      type: "SELECT_TITLE",
      title: { id: "tmdb:1", type: "movie", name: "Subtitle fixture" },
    });
    container.stateManager.dispatch({ type: "SELECT_EPISODE", episode: { season: 1, episode: 1 } });
    const stream = subtitleStream();
    const displayedStream: StreamInfo =
      trackOrigin === "attached"
        ? {
            ...stream,
            providerResolveResult: { ...stream.providerResolveResult!, subtitles: [] },
            subtitleList: [{ url: subtitleUrl, language: "fr", display: "French" }],
          }
        : stream;
    container.stateManager.dispatch({ type: "SET_STREAM", stream: displayedStream });
    container.stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "playing" });
    container.playerControl.setActive({
      id: "fixture-player",
      stop: async () => {
        throw new Error("subtitle picks must not stop playback");
      },
      selectSubtitle: async (selection) => {
        selections.push(selection);
        return true;
      },
    });
    const handle = render(<AppRoot container={container} />, { columns: 100, rows: 35 });
    let now = Date.now();
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    const tick = async (ms: number) => {
      await act(async () => {
        await Bun.sleep(ms);
      });
    };
    const open = async () => {
      let pending!: Promise<void>;
      await act(async () => {
        pending = openPlaybackStreamSelectionPicker(container, "subtitle", "fixture-live-picker");
      });
      await waitUntil(() => handle.lastFrame()?.includes("French") ?? false, {
        tick,
        now: performance.now.bind(performance),
        label: "rendered subtitle rows",
      });
      // The overlay rejects Enter for 300ms after inventory changes. Advance
      // that clock explicitly rather than waiting for scheduler luck.
      now += 301;
      return { pending };
    };
    try {
      const first = await open();
      expect(handle.lastFrame()).toContain("French");
      handle.stdin.enqueue("\u001b[C");
      await act(async () => {});
      handle.stdin.enqueue("\r");
      let firstDone = false;
      void first.pending.then(
        () => {
          firstDone = true;
          return undefined;
        },
        () => {
          firstDone = true;
          return undefined;
        },
      );
      await waitUntil(() => firstDone, {
        tick,
        now: performance.now.bind(performance),
        label: "subtitle pick completed",
      });
      await first.pending;
      expect(selections).toHaveLength(1);
      expect(selections[0]?.subtitleUrl).toBe(subtitleUrl);
      expect(container.stateManager.getState().stream?.subtitle).toBe(subtitleUrl);
      expect(container.stateManager.getState().playbackTrackPreferences.subtitle).toBe("fr");
      const second = await open();
      expect(handle.lastFrame()).toContain("✓ French");
      // Off is always first and receives initial focus in the subtitle pane.
      handle.stdin.enqueue("\r");
      let secondDone = false;
      void second.pending.then(
        () => {
          secondDone = true;
          return undefined;
        },
        () => {
          secondDone = true;
          return undefined;
        },
      );
      await waitUntil(() => secondDone, {
        tick,
        now: performance.now.bind(performance),
        label: "subtitle off completed",
      });
      await second.pending;
      expect(selections).toHaveLength(2);
      expect(selections[1]?.subtitleUrl).toBeNull();
      expect(container.stateManager.getState().stream?.subtitle).toBeUndefined();
      expect(container.stateManager.getState().playbackTrackPreferences.subtitle).toBe("none");
      expect(container.config.getRaw().movieLanguageProfile.subtitle).not.toBe("fr");
    } finally {
      clock.mockRestore();
      handle.unmount();
      forceSettleAllRootContent("live-subtitle-picker-test");
      await disposeContainer(container);
      dispose();
    }
  },
);

test("a rejected subtitle choice preserves the current selection", async () => {
  const { container, dispose } = await createIsolatedContainer("rejected-subtitle");
  const stream = subtitleStream();
  container.stateManager.dispatch({ type: "SET_STREAM", stream });
  container.playerControl.setActive({
    id: "rejecting-player",
    stop: async () => {},
    selectSubtitle: async () => false,
  });
  try {
    const result = await resolveTracksPanelPick({ section: "subtitle", value: subtitleUrl }, null, {
      container,
      title: { id: "tmdb:1", type: "movie", name: "Subtitle fixture" },
      episode: { season: 1, episode: 1 },
      currentProviderId: "vidlink",
      resumeSeconds: 0,
      reason: "test-rejection",
    });
    expect(result).toEqual({ kind: "subtitle-switch", applied: false, label: "French" });
    expect(container.stateManager.getState().stream).toBe(stream);
  } finally {
    await disposeContainer(container);
    dispose();
  }
});

test("a late subtitle acknowledgement cannot overwrite a replacement stream", async () => {
  const { container, dispose } = await createIsolatedContainer("superseded-subtitle");
  const stream = subtitleStream();
  const replacement = { ...stream, url: "https://media.example/next.mp4" };
  container.stateManager.dispatch({ type: "SET_STREAM", stream });
  container.playerControl.setActive({
    id: "superseded-player",
    stop: async () => {},
    selectSubtitle: async () => {
      container.stateManager.dispatch({ type: "SET_STREAM", stream: replacement });
      return true;
    },
  });
  try {
    await resolveTracksPanelPick({ section: "subtitle", value: subtitleUrl }, null, {
      container,
      title: { id: "tmdb:1", type: "movie", name: "Subtitle fixture" },
      episode: { season: 1, episode: 1 },
      currentProviderId: "vidlink",
      resumeSeconds: 0,
      reason: "test-navigation",
    });
    expect(container.stateManager.getState().stream).toBe(replacement);
    expect(container.stateManager.getState().playbackTrackPreferences).toEqual({});
    expect(container.stateManager.getState().stream?.subtitle).toBeUndefined();
  } finally {
    await disposeContainer(container);
    dispose();
  }
});

test("a provider default subtitle is cleared before playback when this session chose Off", async () => {
  const { PlaybackPhase } = await import("@/app/playback/PlaybackPhase");
  const { container, dispose } = await createIsolatedContainer("off-before-playback");
  const savedProfile = { ...container.config.getRaw().movieLanguageProfile };
  const phase = new PlaybackPhase();
  // Exercise the preparation path that runs after every provider/source resolve.
  const prepare = phase["preparePlaybackStream"].bind(phase);
  try {
    container.stateManager.dispatch({
      type: "SET_SESSION_TRACK_PREFERENCES",
      preferences: { subtitle: "none" },
    });
    const selected = { ...subtitleStream(), subtitle: subtitleUrl };
    const prepared = await prepare(
      selected,
      { id: "tmdb:1", type: "movie", name: "Subtitle fixture" },
      { season: 1, episode: 1 },
      { container, signal: new AbortController().signal },
    );
    expect(prepared.subtitle).toBeUndefined();
    expect(prepared.providerResolveResult?.subtitles).toHaveLength(1);
    expect(container.config.getRaw().movieLanguageProfile).toEqual(savedProfile);
  } finally {
    await disposeContainer(container);
    dispose();
  }
});

test("Tracks quality and Auto are reversible session choices that preserve subtitles and saved defaults", async () => {
  const { buildTracksPanelData } = await import("@/app-shell/tracks-panel-data");
  const { applyPreferredStreamSelection, streamSelectionFromTrackPick } =
    await import("@/app/playback/source-quality");
  const { container, dispose } = await createIsolatedContainer("session-quality-auto");
  const title = { id: "tmdb:1", type: "movie" as const, name: "Quality fixture" };
  const episode = { season: 1, episode: 1 };
  const base = subtitleStream();
  const inventory = base.providerResolveResult;
  if (!inventory) throw new Error("Fixture inventory missing");
  const stream: StreamInfo = {
    ...base,
    providerResolveResult: {
      ...inventory,
      selectedStreamId: "1080",
      sources: [
        {
          id: "source-a",
          providerId: "vidlink",
          kind: "mirror",
          status: "selected",
          confidence: 1,
        },
      ],
      streams: [1080, 720].map((quality) => ({
        id: String(quality),
        providerId: "vidlink",
        sourceId: "source-a",
        protocol: "hls" as const,
        qualityRank: quality,
        qualityLabel: `${quality}p`,
        url: `https://media.example/${quality}.m3u8`,
        confidence: 1,
        cachePolicy: {
          ttlClass: "stream-manifest" as const,
          scope: "local" as const,
          keyParts: [],
        },
      })),
    },
  };
  const saved = structuredClone(container.config.getRaw());
  container.stateManager.dispatch({ type: "SELECT_TITLE", title });
  container.stateManager.dispatch({ type: "SELECT_EPISODE", episode });
  container.stateManager.dispatch({ type: "SET_STREAM", stream });
  container.stateManager.dispatch({
    type: "SET_SESSION_TRACK_PREFERENCES",
    preferences: { subtitle: "none" },
  });
  const context = {
    container,
    title,
    episode,
    currentProviderId: "vidlink",
    resumeSeconds: 17,
    reason: "quality-test",
  };
  try {
    const pick = { section: "quality" as const, value: "720" };
    await resolveTracksPanelPick(pick, streamSelectionFromTrackPick(pick), context);
    expect(container.stateManager.getState().playbackTrackPreferences).toEqual({
      subtitle: "none",
      quality: "720p",
    });
    const data = await buildTracksPanelData(stream, container);
    expect(data.groups.find((group) => group.section === "quality")?.rows[0]).toMatchObject({
      label: "Auto",
      enabled: true,
      selected: false,
    });
    const auto = { section: "quality" as const, value: "quality:auto" };
    const result = await resolveTracksPanelPick(auto, streamSelectionFromTrackPick(auto), context);
    expect(result.kind).toBe("stream-selection");
    if (result.kind !== "stream-selection") throw new Error("Expected a real restart intent");
    expect(
      applyPreferredStreamSelection(stream, result.selection, "best").providerResolveResult
        ?.selectedStreamId,
    ).toBe("1080");
    expect(container.stateManager.getState().playbackTrackPreferences).toEqual({
      subtitle: "none",
      quality: "best",
    });
    expect(container.config.getRaw()).toEqual(saved);
  } finally {
    await disposeContainer(container);
    dispose();
  }
});
