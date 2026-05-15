import { expect, test } from "bun:test";

import type {
  ProviderResolveInput,
  ProviderModule,
  ProviderResolveResult,
  ProviderRuntimeContext,
  ProviderTraceEvent,
  ResolveTrace,
} from "../src/index";

test("provider resolve result requires trace and immutable candidate arrays", () => {
  const trace: ResolveTrace = {
    id: "trace-1",
    startedAt: "2026-04-29T00:00:00.000Z",
    title: {
      id: "tmdb:1",
      kind: "movie",
      title: "Example",
    },
    cacheHit: false,
    steps: [],
    failures: [],
  };

  const result: ProviderResolveResult = {
    providerId: "vidking",
    streams: [],
    subtitles: [],
    trace,
    failures: [],
  };

  expect(result.trace.id).toBe("trace-1");
  expect(result.streams.length).toBe(0);
});

test("provider sdk contract models selected output plus discovered source inventory", async () => {
  const emitted: ProviderTraceEvent[] = [];
  const context: ProviderRuntimeContext = {
    now: () => "2026-05-01T00:00:00.000Z",
    emit(event) {
      emitted.push(event);
    },
  };

  const module: ProviderModule = {
    providerId: "vidking",
    async resolve(input, runtime) {
      runtime.emit?.({
        type: "source:start",
        at: runtime.now(),
        providerId: "vidking",
        sourceId: "oxygen",
        message: "Trying Oxygen mirror",
      });

      return {
        providerId: "vidking",
        selectedStreamId: "stream-1080p",
        sources: [
          {
            id: "oxygen",
            providerId: "vidking",
            kind: "mirror",
            label: "Oxygen",
            status: "selected",
            confidence: 0.9,
          },
        ],
        variants: [
          {
            id: "oxygen-1080p",
            providerId: "vidking",
            sourceId: "oxygen",
            qualityLabel: "1080p",
            streamIds: ["stream-1080p"],
            selected: true,
            confidence: 0.9,
          },
        ],
        streams: [
          {
            id: "stream-1080p",
            providerId: "vidking",
            sourceId: "oxygen",
            variantId: "oxygen-1080p",
            url: "https://cdn.example/master.m3u8",
            protocol: "hls",
            confidence: 0.9,
            cachePolicy: {
              ttlClass: "stream-manifest",
              scope: "local",
              keyParts: ["provider", "vidking", input.title.id],
            },
          },
        ],
        subtitles: [],
        trace: {
          id: "trace-1",
          startedAt: runtime.now(),
          title: input.title,
          selectedProviderId: "vidking",
          selectedStreamId: "stream-1080p",
          cacheHit: false,
          steps: [],
          events: emitted,
          failures: [],
        },
        failures: [],
      };
    },
  };

  const result = await module.resolve(
    {
      title: { id: "tmdb:1", kind: "movie", title: "Example" },
      mediaKind: "movie",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    context,
  );

  expect(result.selectedStreamId).toBe("stream-1080p");
  expect(result.sources?.[0]?.kind).toBe("mirror");
  expect(result.variants?.[0]?.qualityLabel).toBe("1080p");
  expect(result.trace.events?.[0]?.type).toBe("source:start");
});

test("provider contract carries presentation and subtitle delivery preferences", () => {
  const input: ProviderResolveInput = {
    title: { id: "anilist:1", kind: "anime", title: "Example Anime" },
    mediaKind: "anime",
    preferredAudioLanguage: "dub",
    preferredSubtitleLanguage: "en",
    preferredPresentation: "dub",
    preferredSubtitleDelivery: "embedded",
    intent: "play",
    allowedRuntimes: ["direct-http"],
  };

  const result: ProviderResolveResult = {
    providerId: "miruro",
    selectedStreamId: "stream-1",
    streams: [
      {
        id: "stream-1",
        providerId: "miruro",
        url: "https://cdn.example/master.m3u8",
        protocol: "hls",
        audioLanguages: ["en"],
        presentation: input.preferredPresentation,
        subtitleDelivery: input.preferredSubtitleDelivery,
        subtitleLanguages: ["en"],
        flavorArchetype: "Miruro animals",
        flavorLabel: "Bee softsub",
        confidence: 0.9,
        cachePolicy: {
          ttlClass: "stream-manifest",
          scope: "local",
          keyParts: ["provider", "miruro", "1"],
        },
      },
    ],
    variants: [
      {
        id: "variant-1",
        providerId: "miruro",
        sourceId: "source-1",
        presentation: "dub",
        subtitleDelivery: "embedded",
        flavorLabel: "Bee softsub",
        streamIds: ["stream-1"],
        confidence: 0.9,
      },
    ],
    subtitles: [],
    trace: {
      id: "trace-1",
      startedAt: "2026-05-01T00:00:00.000Z",
      title: input.title,
      selectedProviderId: "miruro",
      selectedStreamId: "stream-1",
      cacheHit: false,
      steps: [],
      failures: [],
    },
    failures: [],
  };

  expect(result.streams[0]?.presentation).toBe("dub");
  expect(result.variants?.[0]?.subtitleDelivery).toBe("embedded");
});
