import { describe, expect, test } from "bun:test";

import type { GoogleCastPlaybackTarget } from "@/domain/playback/playback-target";
import type { StreamInfo } from "@/domain/types";
import type { PlayerPlaybackEvent } from "@/infra/player/PlayerService";
import type {
  GoogleCastClientEvents,
  GoogleCastMedia,
  GoogleCastSession,
} from "@/services/playback/cast/google-cast-client";
import {
  extrapolateCastPosition,
  GoogleCastPlaybackBackend,
} from "@/services/playback/cast/google-cast-playback-backend";

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
  test("extrapolates an advancing receiver clock but freezes paused positions", () => {
    expect(extrapolateCastPosition(10, 1_000, 2_250, true)).toBe(11.25);
    expect(extrapolateCastPosition(10, 1_000, 2_250, false)).toBe(10);
    expect(extrapolateCastPosition(10, 2_000, 1_000, true)).toBe(10);
  });

  test("loads subtitle tracks through the session gateway and enables the selected track", async () => {
    const loadedMedia: GoogleCastMedia[] = [];
    let activeTrackIds: readonly number[] | undefined;
    let subtitlesClosed = false;
    let clientEvents: GoogleCastClientEvents | null = null;
    const backend = new GoogleCastPlaybackBackend({
      connect: (async (_endpoint: unknown, events: GoogleCastClientEvents) => {
        clientEvents = events;
        return {
          load: async (media: GoogleCastMedia, _startAt: number, trackIds?: readonly number[]) => {
            loadedMedia.push(media);
            activeTrackIds = trackIds;
            queueMicrotask(() =>
              queueMicrotask(() =>
                clientEvents?.onStatus({ playerState: "IDLE", idleReason: "FINISHED" }),
              ),
            );
            return { playerState: "BUFFERING" };
          },
          play: async () => undefined,
          pause: async () => undefined,
          seek: async () => undefined,
          stop: async () => undefined,
          close: () => undefined,
        };
      }) as never,
      discovery: {
        browse: () => {
          throw new Error("discovery should not run");
        },
      },
      gateway: {
        start: async () => {
          throw new Error("media gateway should not run");
        },
      },
      subtitles: {
        start: async ({ tracks }) => {
          expect(tracks[0]?.url).toBe("https://subs.example/en.srt");
          return {
            tracks: [
              {
                trackId: 1,
                url: "http://192.168.1.10:41000/cast-subtitles/token/1.vtt",
                name: "Selected subtitle",
                language: "en",
              },
            ],
            close: async () => {
              subtitlesClosed = true;
            },
          };
        },
      },
    });

    await backend.play(
      {
        stream: { ...STREAM, subtitle: "https://subs.example/en.srt" },
        options: { url: STREAM.url, displayTitle: "Example Movie" },
      },
      TARGET,
    );

    expect(loadedMedia[0]?.tracks?.[0]).toMatchObject({
      trackId: 1,
      type: "TEXT",
      trackContentType: "text/vtt",
      language: "en",
    });
    expect(activeTrackIds).toEqual([1]);
    expect(subtitlesClosed).toBe(true);
  });

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
        gateway: {
          start: async () => {
            throw new Error("gateway should not run for a direct stream");
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
      "player-ready",
      "playback-started",
      "playback-progress",
    ]);
    expect(result).toMatchObject({
      endReason: "eof",
      watchedSeconds: 78,
      duration: 120,
      lastReliableProgressSeconds: 120,
    });
    expect(activeControlIds).toEqual(["google-cast:cast-1", null]);
  });

  test("routes header-protected media through a session gateway and closes it", async () => {
    const loaded: GoogleCastMedia[] = [];
    let clientEvents: GoogleCastClientEvents | null = null;
    let gatewayClosed = 0;
    const backend = new GoogleCastPlaybackBackend({
      connect: (async (_endpoint: unknown, events: GoogleCastClientEvents) => {
        clientEvents = events;
        return {
          load: async (media: GoogleCastMedia) => {
            loaded.push(media);
            queueMicrotask(() => {
              queueMicrotask(() =>
                clientEvents?.onStatus({ playerState: "IDLE", idleReason: "FINISHED" }),
              );
            });
            return { playerState: "BUFFERING" };
          },
          play: async () => undefined,
          pause: async () => undefined,
          seek: async () => undefined,
          stop: async () => undefined,
          close: () => undefined,
        };
      }) as never,
      discovery: {
        browse: () => {
          throw new Error("discovery should not run for an endpoint-backed target");
        },
      },
      gateway: {
        start: async ({ stream, receiverHost }) => {
          expect(stream.headers).toEqual({ Referer: "https://provider.example" });
          expect(receiverHost).toBe("192.168.1.20");
          return {
            mediaUrl: "http://192.168.1.10:43210/cast/token/1",
            contentType: "video/mp4",
            close: () => {
              gatewayClosed += 1;
            },
          };
        },
      },
    });

    await backend.play(
      {
        stream: { ...STREAM, headers: { Referer: "https://provider.example" } },
        options: { url: STREAM.url, displayTitle: "Example Movie" },
      },
      TARGET,
    );

    expect(loaded[0]?.contentId).toBe("http://192.168.1.10:43210/cast/token/1");
    expect(gatewayClosed).toBe(1);
  });

  test("closes the session gateway when the receiver connection fails", async () => {
    let gatewayClosed = 0;
    const backend = new GoogleCastPlaybackBackend({
      connect: (async () => {
        throw new Error("receiver unavailable");
      }) as never,
      discovery: {
        browse: () => {
          throw new Error("discovery should not run for an endpoint-backed target");
        },
      },
      gateway: {
        start: async () => ({
          mediaUrl: "http://192.168.1.10:43210/cast/token/1",
          contentType: "video/mp4",
          close: () => {
            gatewayClosed += 1;
          },
        }),
      },
    });

    await expect(
      backend.play(
        {
          stream: { ...STREAM, headers: { Referer: "https://provider.example" } },
          options: { url: STREAM.url, displayTitle: "Example Movie" },
        },
        TARGET,
      ),
    ).rejects.toThrow("receiver unavailable");
    expect(gatewayClosed).toBe(1);
  });

  test("ignores the receiver's pre-load IDLE status instead of closing a fresh gateway", async () => {
    let gatewayClosed = 0;
    let loadCalled = false;
    const backend = new GoogleCastPlaybackBackend({
      connect: (async (_endpoint: unknown, events: GoogleCastClientEvents) => {
        events.onStatus({ playerState: "IDLE", currentTime: 0 });
        return {
          load: async () => {
            loadCalled = true;
            return { playerState: "IDLE", idleReason: "FINISHED" };
          },
          play: async () => undefined,
          pause: async () => undefined,
          seek: async () => undefined,
          stop: async () => undefined,
          close: () => undefined,
        };
      }) as never,
      discovery: {
        browse: () => {
          throw new Error("discovery should not run for an endpoint-backed target");
        },
      },
      gateway: {
        start: async () => ({
          mediaUrl: "http://192.168.1.10:43210/cast/token/1",
          contentType: "application/x-mpegURL",
          close: () => {
            gatewayClosed += 1;
          },
        }),
      },
    });

    const result = await backend.play(
      {
        stream: {
          ...STREAM,
          url: "https://media.example/master.m3u8",
          headers: { Referer: "https://provider.example" },
        },
        options: { url: STREAM.url, displayTitle: "Example Episode" },
      },
      TARGET,
    );

    expect(loadCalled).toBe(true);
    expect(result.endReason).toBe("eof");
    expect(gatewayClosed).toBe(1);
  });
});
