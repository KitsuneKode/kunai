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

test("the rendered live subtitle picker selects an external track and then turns it off", async () => {
  const { container, dispose } = await createIsolatedContainer("live-subtitle-picker");
  const selections: PlaybackSubtitleSelection[] = [];
  container.stateManager.dispatch({
    type: "SELECT_TITLE",
    title: { id: "tmdb:1", type: "movie", name: "Subtitle fixture" },
  });
  container.stateManager.dispatch({ type: "SELECT_EPISODE", episode: { season: 1, episode: 1 } });
  container.stateManager.dispatch({ type: "SET_STREAM", stream: subtitleStream() });
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
    void first.pending.then(() => {
      firstDone = true;
    });
    await waitUntil(() => firstDone, {
      tick,
      now: performance.now.bind(performance),
      label: "subtitle pick completed",
    });
    expect(selections).toHaveLength(1);
    expect(selections[0]?.subtitleUrl).toBe(subtitleUrl);
    expect(container.stateManager.getState().stream?.subtitle).toBe(subtitleUrl);
    const second = await open();
    expect(handle.lastFrame()).toContain("✓ French");
    handle.stdin.enqueue("\u001b[C");
    await act(async () => {});
    handle.stdin.enqueue("\r");
    let secondDone = false;
    void second.pending.then(() => {
      secondDone = true;
    });
    await waitUntil(() => secondDone, {
      tick,
      now: performance.now.bind(performance),
      label: "subtitle off completed",
    });
    expect(selections).toHaveLength(2);
    expect(selections[1]?.subtitleUrl).toBeNull();
    expect(container.stateManager.getState().stream?.subtitle).toBeUndefined();
  } finally {
    clock.mockRestore();
    handle.unmount();
    forceSettleAllRootContent("live-subtitle-picker-test");
    await disposeContainer(container);
    dispose();
  }
});

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
    expect(container.stateManager.getState().stream?.subtitle).toBeUndefined();
  } finally {
    await disposeContainer(container);
    dispose();
  }
});
