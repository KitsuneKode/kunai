import { describe, expect, test } from "bun:test";

import { deliverNotificationPlayback } from "@/app-shell/notification-playback-delivery";
import { forceSettleAllRootContent, mountRootContent } from "@/app-shell/root-content-state";
import type { BrowseShellResult, PlaybackShellResult } from "@/app-shell/types";
import type { EpisodeInfo, SearchResult, TitleInfo } from "@/domain/types";
import type { PlaybackTitleSelection } from "@/infra/player/PlayerControlService";
import type { DiagnosticEventInput } from "@/services/diagnostics/diagnostic-event";

const TITLE: TitleInfo = { id: "tmdb:1", type: "series", name: "Notified" };
const EPISODE: EpisodeInfo = { season: 1, episode: 4 };
const INTENT = { title: TITLE, episode: EPISODE };

function containerStub({
  playbackStatus = "idle",
  cancelActive = false,
  switchDelivered = true,
}: {
  readonly playbackStatus?: string;
  readonly cancelActive?: boolean;
  readonly switchDelivered?: boolean;
} = {}) {
  const events: string[] = [];
  const dispatched: Array<{ type: string; note?: string | null }> = [];
  // SAFETY: deliberately partial container — delivery reads only
  // playerControl, workControl, stateManager and diagnosticsService.
  const container = {
    playerControl: {
      signalTitleSwitch(selection: PlaybackTitleSelection) {
        events.push("signal-title-switch");
        void selection;
      },
      async switchToTitlePlayback(selection: PlaybackTitleSelection, _reason?: string) {
        events.push("switch-to-title");
        void selection;
        return switchDelivered;
      },
    },
    workControl: {
      cancelActive(_reason: string) {
        events.push("cancel-active");
        return cancelActive;
      },
    },
    stateManager: {
      getState() {
        return { playbackStatus };
      },
      dispatch(action: { type: string; note?: string | null }) {
        dispatched.push(action);
      },
    },
    diagnosticsService: {
      record(_entry: DiagnosticEventInput) {
        events.push("diagnostic");
      },
    },
    // SAFETY: deliberately partial container — delivery reads only
    // playerControl, workControl, stateManager and diagnosticsService.
  } as never;
  return { container, events, dispatched };
}

describe("deliverNotificationPlayback", () => {
  test("a retained browse session settles with launch-playback", async () => {
    const mounted = mountRootContent<BrowseShellResult<SearchResult>>({
      kind: "browse",
      fallbackValue: { type: "cancelled" },
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
      renderContent: () => null as never,
    });
    const { container, events } = containerStub();

    const delivery = await deliverNotificationPlayback(container, INTENT);

    expect(delivery).toBe("browse-launch");
    await expect(mounted.result).resolves.toEqual({
      type: "launch-playback",
      launch: { title: TITLE, episode: EPISODE },
    });
    expect(events).toEqual([]);
    forceSettleAllRootContent("test-cleanup");
  });

  test("a mounted post-play session settles with launch-playback", async () => {
    const mounted = mountRootContent<PlaybackShellResult>({
      kind: "post-playback",
      fallbackValue: "quit" as const,
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
      renderContent: () => null as never,
    });
    const { container } = containerStub();

    const delivery = await deliverNotificationPlayback(container, INTENT);

    expect(delivery).toBe("post-play-launch");
    await expect(mounted.result).resolves.toEqual({
      type: "launch-playback",
      launch: { title: TITLE, episode: EPISODE },
    });
    forceSettleAllRootContent("test-cleanup");
  });

  test("live playback without a session switches titles by stopping the file", async () => {
    const { container, events } = containerStub({
      playbackStatus: "playing",
      cancelActive: false,
    });

    const delivery = await deliverNotificationPlayback(container, INTENT);

    expect(delivery).toBe("title-switch");
    expect(events).toEqual(["cancel-active", "switch-to-title"]);
  });

  test("an in-flight resolve arms the switch without stopping anything", async () => {
    const { container, events } = containerStub({
      playbackStatus: "loading",
      cancelActive: true,
    });

    const delivery = await deliverNotificationPlayback(container, INTENT);

    expect(delivery).toBe("title-switch");
    expect(events).toEqual(["cancel-active", "signal-title-switch"]);
  });

  test("a refused switch reports failure honestly", async () => {
    const { container, events, dispatched } = containerStub({
      playbackStatus: "playing",
      cancelActive: false,
      switchDelivered: false,
    });

    const delivery = await deliverNotificationPlayback(container, INTENT);

    expect(delivery).toBe("undeliverable");
    expect(events).toEqual(["cancel-active", "switch-to-title"]);
    expect(dispatched.at(-1)?.type).toBe("SET_PLAYBACK_FEEDBACK");
    expect(dispatched.at(-1)?.note).toContain("Notified");
  });

  test("nothing to deliver to fails honestly instead of dropping the intent", async () => {
    const { container, events, dispatched } = containerStub({ playbackStatus: "idle" });

    const delivery = await deliverNotificationPlayback(container, INTENT);

    expect(delivery).toBe("undeliverable");
    expect(events).toEqual(["diagnostic"]);
    expect(dispatched.at(-1)?.type).toBe("SET_PLAYBACK_FEEDBACK");
    expect(dispatched.at(-1)?.note).toContain("Notified");
  });
});
