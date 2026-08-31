import { describe, expect, test } from "bun:test";

import type { GoogleCastPlaybackTarget } from "@/domain/playback/playback-target";
import type { StreamInfo } from "@/domain/types";
import type { PlayerPlaybackEvent } from "@/infra/player/PlayerService";
import type {
  GoogleCastClientEvents,
  GoogleCastMedia,
  GoogleCastSession,
} from "@/services/playback/cast/GoogleCastClient";
import { GoogleCastPlaybackBackend } from "@/services/playback/cast/GoogleCastPlaybackBackend";

const TARGET: GoogleCastPlaybackTarget = {
  kind: "google-cast",
  id: "cast-1",
  name: "Living Room TV",
  host: "192.168.1.20",
  port: 8009,
  capabilities: ["audio", "video"],
};

const STREAM: StreamInfo = {
  url: "https://media.example/movie.mp4",
  headers: {},
  timestamp: 1,
};

describe("GoogleCastPlaybackBackend", () => {
  test("loads direct media and maps receiver status into the playback lifecycle", async () => {
    const loaded: Array<{ media: GoogleCastMedia; startAt: number }> = [];
    const emitted: PlayerPlaybackEvent[] = [];
    const activeControlIds: Array<string | null> = [];
    let activeControl: { id: string; stop(): Promise<void> } | null = null;
    let clientEvents: GoogleCastClientEvents | null = null;
    const session: GoogleCastSession = {
      load: async (media, startAt) => {
        loaded.push({ media, startAt });
        queueMicrotask(() => {
          clientEvents?.onStatus({
            playerState: "PLAYING",
            currentTime: 43,
            media: { duration: 120 },
          });
          clientEvents?.onStatus({
            playerState: "IDLE",
            idleReason: "FINISHED",
            currentTime: 120,
            media: { duration: 120 },
          });
        });
        return { playerState: "BUFFERING" };
      },
      play: async () => undefined,
      pause: async () => undefined,
      seek: async () => undefined,
      stop: async () => undefined,
      close: () => undefined,
    };
    const backend = new GoogleCastPlaybackBackend(
      {
        connect: (async (
          _endpoint: { readonly host: string; readonly port?: number },
          events: GoogleCastClientEvents,
        ) => {
          clientEvents = events;
          return session;
        }) as never,
        discovery: {
          browse: () => {
            throw new Error("discovery should not run for an endpoint-backed target");
          },
        },
      },
      {
        getActive: () => activeControl,
        setActive: (control) => {
          activeControl = control;
          activeControlIds.push(control?.id ?? null);
        },
      },
    );

    const result = await backend.play(
      {
        stream: STREAM,
        options: {
          url: STREAM.url,
          displayTitle: "Example Movie",
          startAt: 42,
          onPlaybackEvent: ({ event }) => emitted.push(event),
        },
      },
      TARGET,
    );

    expect(loaded).toEqual([
      {
        media: {
          contentId: STREAM.url,
          contentType: "video/mp4",
          streamType: "BUFFERED",
          metadata: { metadataType: 0, title: "Example Movie" },
        },
        startAt: 42,
      },
    ]);
    expect(emitted.map((event) => event.type)).toEqual([
      "launching-player",
      "opening-stream",
      "playback-started",
      "playback-progress",
      "player-ready",
    ]);
    expect(result).toMatchObject({
      endReason: "eof",
      watchedSeconds: 78,
      duration: 120,
      lastReliableProgressSeconds: 120,
    });
    expect(activeControlIds).toEqual(["google-cast:cast-1", null]);
  });

  test("refuses protected streams until the Phase-3 gateway exists", async () => {
    const backend = new GoogleCastPlaybackBackend();

    expect(
      backend.play(
        {
          stream: { ...STREAM, headers: { Referer: "https://provider.example" } },
          options: { url: STREAM.url, displayTitle: "Example Movie" },
        },
        TARGET,
      ),
    ).rejects.toThrow("requires the local media gateway: headers");
  });
});
