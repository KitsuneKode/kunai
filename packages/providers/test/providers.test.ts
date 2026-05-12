import { expect, test } from "bun:test";

import { createProviderEngine } from "@kunai/core";

import {
  allmangaProviderModule,
  buildAllmangaSourceCandidates,
  createVidkingResultFromPayload,
  getProviderMigrationQueue,
  getProviderResearchProfile,
  miruroProviderModule,
  providerResearchProfiles,
  resolveVidkingDirect,
  rivestreamProviderModule,
  vidkingProviderModule,
} from "../src/index";

test("provider engine exposes registered modules", () => {
  const engine = createProviderEngine({
    modules: [
      rivestreamProviderModule,
      vidkingProviderModule,
      miruroProviderModule,
      allmangaProviderModule,
    ],
  });

  expect(engine.getProviderIds()).toEqual(["rivestream", "vidking", "miruro", "allanime"]);
  expect(engine.get("rivestream")).toBe(rivestreamProviderModule);
  expect(engine.get("vidking")).toBe(vidkingProviderModule);
  expect(engine.get("miruro")).toBe(miruroProviderModule);
  expect(engine.get("allanime")).toBe(allmangaProviderModule);
});

test("provider research profiles are dossier-backed and migration ordered", () => {
  const queue = getProviderMigrationQueue();

  expect(queue[0]?.providerId).toBe("vidking");
  expect(queue[1]?.providerId).toBe("allanime");
  expect(queue.every((profile) => profile.dossierPath.startsWith(".docs/provider-dossiers/"))).toBe(
    true,
  );
  expect(providerResearchProfiles.length).toBeGreaterThanOrEqual(7);
});

test("provider research profiles separate direct providers from legacy fallbacks", () => {
  expect(getProviderResearchProfile("vidking")).toMatchObject({
    status: "production",
    migrationAction: "promote-direct-provider",
    runtimeClass: "direct-http Videasy payload decode",
  });

  expect(getProviderResearchProfile("cineby")).toMatchObject({
    status: "legacy-fallback",
    migrationAction: "keep-as-fallback",
  });

  expect(getProviderResearchProfile("anikai")).toMatchObject({
    migrationAction: "hold-for-future-runtime",
  });
});

test("vidking direct payload creates selected stream, variants, and subtitle inventory", () => {
  const result = createVidkingResultFromPayload({
    input: {
      title: {
        id: "1668",
        tmdbId: "1668",
        kind: "series",
        title: "Friends",
        year: 1994,
      },
      episode: { season: 1, episode: 2 },
      mediaKind: "series",
      preferredSubtitleLanguage: "en",
      qualityPreference: "1080",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    payload: {
      sources: [
        { url: "https://cdn.example/720/index.m3u8", quality: "720p" },
        { url: "https://cdn.example/1080/index.m3u8", quality: "1080p" },
      ],
      subtitles: [
        {
          url: "https://subs.example/en-sdh.vtt",
          language: "English SDH",
          release: "SDH",
        },
        {
          file: "https://subs.example/en.vtt",
          language: "English",
          release: "Clean",
        },
        {
          href: "https://subs.example/es.vtt",
          lang: "spa",
          label: "Spanish",
        },
      ],
    },
    server: "mb-flix",
  });

  expect(result?.selectedStreamId).toBe(result?.streams[0]?.id);
  expect(result?.streams[0]).toMatchObject({
    qualityLabel: "1080p",
    protocol: "hls",
    container: "m3u8",
  });
  expect(result?.variants).toHaveLength(2);
  expect(result?.subtitles.map((subtitle) => subtitle.language)).toEqual(["en", "en", "es"]);
  expect(result?.subtitles[0]?.url).toBe("https://subs.example/en.vtt");
  expect(result?.trace.events?.map((event) => event.type)).toContain("variant:selected");
});

test("vidking direct resolver retries a failing source and preserves trace evidence", async () => {
  const events: unknown[] = [];
  let calls = 0;
  const result = await resolveVidkingDirect(
    {
      title: {
        id: "1668",
        tmdbId: "1668",
        kind: "series",
        title: "Friends",
        year: 1994,
      },
      episode: { season: 1, episode: 2 },
      mediaKind: "series",
      preferredSubtitleLanguage: "en",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    {
      now: () => "2026-05-01T00:00:00.000Z",
      retryPolicy: { maxAttempts: 2, backoff: "none" },
      emit: (event) => events.push(event),
      fetch: {
        runtime: "direct-http",
        fetch: async () => {
          calls += 1;
          return new Response("", { status: 504 });
        },
      },
    },
  );

  expect(calls).toBeGreaterThan(1);
  expect(result?.streams).toEqual([]);
  expect(result?.trace.events?.map((event) => event.type)).toContain("retry:scheduled");
  expect(result?.trace.events?.map((event) => event.type)).toContain("provider:exhausted");
  expect(result?.trace.failures[0]).toMatchObject({
    providerId: "vidking",
    code: "timeout",
    retryable: true,
  });
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "retry:scheduled",
      providerId: "vidking",
      attempt: 2,
    }),
  );
});

test("allmanga source candidates preserve separate source families", () => {
  const sources = buildAllmangaSourceCandidates(
    [
      {
        id: "stream:hls:1080",
        providerId: "allanime",
        sourceId: "source:allanime:fm-hls",
        url: "https://cdn.example/hls.m3u8",
        protocol: "hls",
        confidence: 0.95,
        cachePolicy: {
          ttlClass: "stream-manifest",
          scope: "local",
          keyParts: [],
        },
      },
      {
        id: "stream:mp4:720",
        providerId: "allanime",
        sourceId: "source:allanime:vid-mp4",
        url: "https://cdn.example/720.mp4",
        protocol: "mp4",
        confidence: 0.85,
        cachePolicy: {
          ttlClass: "stream-manifest",
          scope: "local",
          keyParts: [],
        },
      },
    ],
    "source:allanime:fm-hls",
    {
      ttlClass: "stream-manifest",
      scope: "local",
      keyParts: [],
    },
  );

  expect(sources.map((source) => source.id)).toEqual([
    "source:allanime:fm-hls",
    "source:allanime:vid-mp4",
  ]);
  expect(sources.map((source) => source.status)).toEqual(["selected", "available"]);
  expect(sources[0]?.metadata?.streamIds).toBe("stream:hls:1080");
});
