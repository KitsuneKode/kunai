import { afterEach, expect, test } from "bun:test";

import type { StreamInfo } from "@/domain/types";
import type { PlayerOptions } from "@/infra/player/PlayerService";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigService";
import type { PlaybackResolveInput } from "@/services/playback/PlaybackResolveService";
import type { CompanionLane } from "@/services/web-companion/companion-catalog";
import {
  CompanionRunState,
  createCompanionFetchHandler,
} from "@/services/web-companion/companion-server";
import { z } from "zod";

import { createContainerFixture } from "../../../support/container-fixture";

const origin = "http://127.0.0.1:4141";
const secret = "a".repeat(32);
const runs: CompanionRunState[] = [];
afterEach(() => {
  for (const run of runs.splice(0)) run.close();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(detached = false) {
  const run = new CompanionRunState();
  runs.push(run);
  const requests: PlaybackResolveInput[] = [];
  const plays: PlayerOptions[] = [];
  let stopCount = 0;
  let pending: ReturnType<
    typeof deferred<{
      stream: { url: string; timestamp: number; headers: Record<string, string> };
      providerId: string;
    }>
  > | null = null;
  const providers = ["series", "anime", "youtube"].map((mode) => ({
    metadata: {
      id: mode,
      name: mode,
      providerLane: mode,
      isAnimeProvider: mode === "anime",
      isYoutubeProvider: mode === "youtube",
      catalogIdentity: "provider-native",
    },
    search: async () => [
      {
        id: mode + "-native",
        type: "series",
        title: "A title",
        year: "2020",
        overview: "",
        posterPath: null,
        rating: null,
        popularity: null,
      },
    ],
    listEpisodes: async () => [
      {
        index: 12.5,
        label: "Special",
        providerEpisodeIdentity: { providerId: "anime", value: "native-episode-12.5" },
      },
    ],
  }));
  // SAFETY: The handler exercises only these in-memory ports; no real profile or provider runtime is constructed.
  const { container } = createContainerFixture({
    config: DEFAULT_CONFIG,
    stateManager: { getState: () => ({ provider: "series" }) },
    providerRegistry: {
      getAllRegistered: () => providers,
      getAll: () => providers,
      get: (id: string) => providers.find((p) => p.metadata.id === id),
      getDefaultForMode: (mode: string) => providers.find((p) => p.metadata.id === mode),
      getDefault: (anime: boolean) =>
        providers.find((p) => p.metadata.id === (anime ? "anime" : "series")),
      getManifest: () => ({ mediaKinds: ["anime"] }),
    },
    searchRegistry: {
      getForProvider: () => undefined,
      getDefault: () => ({ search: async () => [] }),
    },
    playbackResolveWork: {
      resolve: async (input: PlaybackResolveInput) => {
        requests.push(input);
        if (pending) return pending.promise;
        return {
          stream: { url: "https://media.example.test/video.mp4", headers: {}, timestamp: 1 },
          providerId: input.providerId,
        };
      },
    },
    player: {
      capabilities: { observation: detached ? "detached" : "managed" },
      play: async (_stream: StreamInfo, options: PlayerOptions) => {
        plays.push(options);
        return { endReason: "eof", watchedSeconds: 1, duration: 1 };
      },
    },
    playerControl: {
      stopCurrentPlayback: async () => {
        stopCount++;
        return true;
      },
    },
  } as never);
  const fetch = createCompanionFetchHandler({
    container,
    run,
    runSecret: secret,
    bindHost: "127.0.0.1",
    bindPort: 4141,
  });
  const request = (path: string, body?: string, headers: Record<string, string> = {}) => {
    const init: RequestInit = {
      method: body === undefined ? "GET" : "POST",
      headers: { cookie: `kunai_companion_session=${secret}`, origin, ...headers },
    };
    if (body !== undefined) init.body = body;
    return fetch(new Request(origin + path, init));
  };
  const title = (lane: CompanionLane = "anime") =>
    run.catalog.put({
      title: {
        id: "native-id",
        type: lane === "movies" ? "movie" : "series",
        name: "A title",
        isAnime: lane === "anime",
      },
      providerId: lane === "movies" ? "series" : lane,
      mode: lane === "movies" ? "series" : lane,
      lane,
      result: {
        id: "native-id",
        type: "series",
        title: "A title",
        year: "2020",
        overview: "",
        posterPath: null,
        rating: null,
        popularity: null,
      },
    });
  return {
    run,
    request,
    title,
    requests,
    plays,
    getStopCount: () => stopCount,
    delayResolve: () => {
      pending = deferred();
      return pending;
    },
  };
}

test("browser release preserves selected opaque catalog identity", async () => {
  const f = fixture();
  const id = f.title("movies");
  expect((await f.request("/api/release", "{}")).status).toBe(200);
  expect((await f.request(`/api/episodes?id=${id}&lane=movies`)).status).toBe(200);
});

test("opaque titles cannot be reinterpreted as another mode", async () => {
  const f = fixture();
  const id = f.title("anime");
  expect((await f.request(`/api/episodes?id=${id}&lane=movies`)).status).toBe(400);
  expect((await f.request(`/api/stream?titleId=${id}&lane=youtube`)).status).toBe(400);
  expect(f.requests).toHaveLength(0);
});

test("search binds YouTube results to the actual YouTube provider", async () => {
  const f = fixture();
  const response = await f.request("/api/search?q=title&lane=youtube");
  const body = z
    .object({ results: z.array(z.object({ id: z.string(), providerId: z.string() })) })
    .parse(await response.json());
  expect(body.results[0]?.providerId).toBe("youtube");
  expect(f.run.catalog.get(body.results[0]!.id)?.providerId).toBe("youtube");
});

test("control rejects null, primitive JSON and malformed episode coordinates", async () => {
  const f = fixture();
  const id = f.title();
  for (const raw of [
    "null",
    "4",
    "[]",
    JSON.stringify({ action: "play", titleId: id, lane: "anime", episode: "2oops" }),
    JSON.stringify({ action: "play", titleId: id, lane: "anime", episode: -1 }),
    JSON.stringify({ action: "play", titleId: id, lane: "anime", episode: null }),
  ]) {
    expect((await f.request("/api/control", raw)).status).toBe(400);
  }
  expect(f.plays).toHaveLength(0);
});

test("a real fractional provider episode keeps its native identity through resolve", async () => {
  const f = fixture();
  const id = f.title();
  const episodes = await f.request(`/api/episodes?id=${id}&lane=anime`);
  expect(episodes.status).toBe(200);
  await f.request(`/api/stream?titleId=${id}&lane=anime&episode=12.5`);
  expect(f.requests[0]?.episode).toMatchObject({
    episode: 12.5,
    providerEpisodeIdentity: { value: "native-episode-12.5" },
  });
});

test("stop cancels a pending resolve before there is an active player", async () => {
  const f = fixture();
  const id = f.title("movies");
  const pending = f.delayResolve();
  expect(
    (
      await f.request(
        "/api/control",
        JSON.stringify({ action: "play", titleId: id, lane: "movies" }),
      )
    ).status,
  ).toBe(202);
  await f.request("/api/control", JSON.stringify({ action: "stop" }));
  expect(f.requests[0]?.signal.aborted).toBe(true);
  pending.resolve({
    stream: { url: "https://media.example.test/movie.mp4", headers: {}, timestamp: 1 },
    providerId: "series",
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(f.plays).toHaveLength(0);
});

test("foreign origins and malformed JSON bootstrap are refused without throwing", async () => {
  const f = fixture();
  expect(
    (await f.request("/api/status", undefined, { origin: "https://foreign.example.test" })).status,
  ).toBe(403);
  expect((await f.request("/api/session", "null")).status).toBe(400);
  expect((await f.request("/proxy?url=https://example.test")).status).toBe(404);
});

test("release aborts pending browser resolution without allowing a late gateway", async () => {
  const f = fixture();
  const id = f.title("movies");
  const pending = f.delayResolve();
  const request = f.request(`/api/stream?titleId=${id}&lane=movies`);
  expect(f.requests).toHaveLength(1);
  await f.request("/api/release", "{}");
  expect(f.requests[0]!.signal.aborted).toBe(true);
  pending.resolve({
    stream: { url: "https://media.example.test/movie.mp4", headers: {}, timestamp: 1 },
    providerId: "series",
  });
  expect((await request).status).toBe(409);
  expect(f.run.gateway).toBeNull();
  expect(f.run.catalog.get(id)).toBeDefined();
});

test("detached player status and stop do not imply control of the external app", async () => {
  const f = fixture(true);
  f.run.playback = { state: "handed-off", title: "A title" };
  const status = await f.request("/api/status");
  expect(await status.json()).toMatchObject({ controls: ["play"] });
  expect((await f.request("/api/control", JSON.stringify({ action: "stop" }))).status).toBe(409);
  expect(f.getStopCount()).toBe(0);
  expect(f.run.playback.state).toBe("handed-off");
});
