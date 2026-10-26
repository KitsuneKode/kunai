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

test.each(["vidlink", "youtube"] as const)(
  "Tracks quality and Auto for %s preserve subtitles and saved defaults",
  async (providerId) => {
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
        providerId,
        selectedStreamId: "1080",
        sources: [
          {
            id: "source-a",
            providerId,
            kind: "mirror",
            status: "selected",
            confidence: 1,
          },
        ],
        streams: [1080, 720].map((quality) => ({
          id: String(quality),
          providerId,
          sourceId: "source-a",
          variantId: `format-${quality}`,
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
      currentProviderId: providerId,
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
      const low = applyPreferredStreamSelection(stream, { sourceId: null, streamId: "720" });
      container.stateManager.dispatch({ type: "SET_STREAM", stream: low });
      const result = await resolveTracksPanelPick(
        auto,
        streamSelectionFromTrackPick(auto),
        context,
      );
      expect(result.kind).toBe("stream-selection");
      if (result.kind !== "stream-selection") throw new Error("Expected a real restart intent");
      expect(
        applyPreferredStreamSelection(
          low,
          await (async () => {
            const { PlaybackSelectionCoordinator } =
              await import("@/app/playback/playback-selection-coordinator");
            const coordinator = new PlaybackSelectionCoordinator({
              titleId: title.id,
              episodePlaybackSelection: container.episodePlaybackSelection,
              titlePlaybackSource: container.titlePlaybackSource,
            });
            await coordinator.applyEpisodeSelection(providerId, episode, result.selection);
            return coordinator.getEffective(providerId, episode);
          })(),
          "best",
        ).providerResolveResult?.selectedStreamId,
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
  },
);

test("native observations arriving before acknowledgement preserve the accepted Off preference", async () => {
  const { container, dispose } = await createIsolatedContainer("subtitle-observation-ack");
  const stream = { ...subtitleStream(), subtitle: subtitleUrl };
  container.stateManager.dispatch({ type: "SET_STREAM", stream });
  container.stateManager.dispatch({
    type: "SET_SESSION_TRACK_PREFERENCES",
    preferences: { subtitle: "en" },
  });
  container.playerControl.setActive({
    id: "observation-player",
    stop: async () => {},
    selectSubtitle: async () => {
      container.stateManager.dispatch({
        type: "SET_STREAM",
        stream: { ...stream, playbackSubtitle: { id: 0, visible: true } },
      });
      return true;
    },
  });
  try {
    await resolveTracksPanelPick({ section: "subtitle", value: "subtitle:off" }, null, {
      container,
      title: { id: "tmdb:1", type: "movie", name: "Subtitle fixture" },
      episode: { season: 1, episode: 1 },
      currentProviderId: "vidlink",
      resumeSeconds: 0,
      reason: "observation-race",
    });
    expect(container.stateManager.getState().playbackTrackPreferences.subtitle).toBe("none");
    expect(container.stateManager.getState().stream?.subtitle).toBeUndefined();
    expect(container.stateManager.getState().stream?.playbackSubtitle).toEqual({
      id: 0,
      visible: true,
    });
  } finally {
    await disposeContainer(container);
    dispose();
  }
});

test.each(["native-state", "explicit-off", "replaced-file"] as const)(
  "late subtitle lookup preserves newer %s",
  async (change) => {
    const { PlaybackPhase } = await import("@/app/playback/PlaybackPhase");
    const { container, dispose } = await createIsolatedContainer(`late-lookup-${change}`);
    const title = {
      id: "tmdb:550",
      type: "movie" as const,
      name: "Late fixture",
      externalIds: { tmdbId: "550" },
    };
    const episode = { season: 1, episode: 1 };
    const stream: StreamInfo = {
      url: "https://media.example/late.mp4",
      headers: {},
      timestamp: Date.now(),
    };
    const live = { ...stream, playbackSubtitle: { id: 0, visible: false } };
    const replacement = { ...stream, url: "https://media.example/another.mp4" };
    const originalFetch = globalThis.fetch;
    let finished = false;
    const originalRecord = container.diagnosticsService.record.bind(container.diagnosticsService);
    const recorded = spyOn(container.diagnosticsService, "record").mockImplementation((event) => {
      originalRecord(event);
      if (
        event.message === "Late subtitle lookup attached tracks" ||
        event.message === "Late subtitle lookup failed"
      )
        finished = true;
    });
    const online = spyOn(container.connectivity, "isOnline").mockReturnValue(true);
    const controller = new AbortController();
    try {
      await container.config.update({ wyzieApiKey: "isolated-test-key" });
      container.stateManager.dispatch({ type: "SELECT_TITLE", title });
      container.stateManager.dispatch({ type: "SELECT_EPISODE", episode });
      container.stateManager.dispatch({ type: "SET_STREAM", stream });
      container.stateManager.dispatch({
        type: "SET_SESSION_TRACK_PREFERENCES",
        preferences: { subtitle: "en" },
      });
      globalThis.fetch = Object.assign(
        async () =>
          new Response(
            JSON.stringify([
              { id: "late-en", url: subtitleUrl, language: "en", display: "English" },
            ]),
            { headers: { "content-type": "application/json" } },
          ),
        { preconnect: originalFetch.preconnect },
      );
      container.playerControl.setActive({
        id: "late-lookup-player",
        stop: async () => {},
        attachSubtitles: async () => {
          container.stateManager.dispatch({
            type: "SET_STREAM",
            stream: change === "replaced-file" ? replacement : live,
          });
          if (change === "explicit-off")
            container.stateManager.dispatch({
              type: "SET_SESSION_TRACK_PREFERENCES",
              preferences: { subtitle: "none" },
            });
          return { status: "attached", attachedCount: 1 };
        },
      });
      new PlaybackPhase()["startLateSubtitleResolver"]({
        stream,
        title,
        episode,
        context: { container, signal: controller.signal },
      });
      await waitUntil(() => finished, { label: "late lookup completes" });
      const current = container.stateManager.getState().stream;
      if (change === "replaced-file") {
        expect(current).toBe(replacement);
        expect(container.stateManager.getState().playbackNote).toBeNull();
        expect(current?.subtitleList).toBeUndefined();
      } else {
        expect(current?.playbackSubtitle).toEqual(live.playbackSubtitle);
        expect(current?.subtitleList?.some((track) => track.url === subtitleUrl)).toBe(true);
        if (change === "explicit-off") expect(current?.subtitle).toBeUndefined();
      }
    } finally {
      controller.abort();
      globalThis.fetch = originalFetch;
      recorded.mockRestore();
      online.mockRestore();
      await disposeContainer(container);
      dispose();
    }
  },
);
