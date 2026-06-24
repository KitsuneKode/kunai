import { expect, test } from "bun:test";

import type {
  ProviderResolveInput,
  ProviderModule,
  ProviderCycleAttempt,
  ProviderCycleCandidate,
  ProviderCycleFailure,
  ProviderCycleIntent,
  ProviderArtworkInfo,
  ProviderExternalIds,
  ProviderLanguageEvidence,
  ProviderReleaseInfo,
  ProviderResolveResult,
  ProviderRuntimeContext,
  ProviderSourceInventory,
  ProviderTraceEvent,
  ResolveTrace,
} from "../src/index";
import { getProviderResolveStatus, getProviderSourceInventory } from "../src/index";

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
    status: "exhausted",
    providerId: "vidking",
    streams: [],
    subtitles: [],
    trace,
    failures: [],
  };

  expect(result.trace.id).toBe("trace-1");
  expect(result.streams.length).toBe(0);
  expect(getProviderResolveStatus(result)).toBe("exhausted");
});

test("provider resolve result status is the source of truth for playable output", () => {
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

  const resolved: ProviderResolveResult = {
    status: "resolved",
    providerId: "vidking",
    selectedStreamId: "stream-1",
    streams: [
      {
        id: "stream-1",
        providerId: "vidking",
        url: "https://cdn.example/master.m3u8",
        protocol: "hls",
        confidence: 0.9,
        cachePolicy: {
          ttlClass: "stream-manifest",
          scope: "local",
          keyParts: ["provider", "vidking", "1"],
        },
      },
    ],
    subtitles: [],
    trace,
    failures: [],
  };

  const exhausted: ProviderResolveResult = {
    status: "exhausted",
    providerId: "vidking",
    streams: [],
    subtitles: [],
    trace,
    failures: [],
  };

  expect(getProviderResolveStatus(resolved)).toBe("resolved");
  expect(getProviderResolveStatus(exhausted)).toBe("exhausted");
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
        status: "resolved",
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
    status: "resolved",
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

test("provider cycle contract separates normalized logic fields from provider labels", () => {
  const intent: ProviderCycleIntent = "manual-source";
  const candidate: ProviderCycleCandidate = {
    id: "allmanga:sub:kiwi:1080p",
    providerId: "allanime",
    sourceId: "sub",
    serverId: "kiwi",
    variantId: "1080p",
    streamId: "stream-kiwi-1080p",
    groupId: "sub",
    label: "Sub · Kiwi · 1080p",
    nativeLabel: "kiwi",
    normalizedAudioLanguage: "ja",
    normalizedSubtitleLanguage: "en",
    presentation: "sub",
    qualityRank: 1080,
    priority: 10,
    metadata: {
      translationType: "sub",
      providerServerName: "kiwi",
    },
  };

  const failure: ProviderCycleFailure = {
    providerId: candidate.providerId,
    candidateId: candidate.id,
    failureClass: "candidate-timeout",
    message: "Timed out while resolving Kiwi",
    retryable: true,
    at: "2026-05-19T00:00:00.000Z",
  };

  const attempt: ProviderCycleAttempt = {
    candidate,
    attempt: 1,
    startedAt: "2026-05-19T00:00:00.000Z",
    endedAt: "2026-05-19T00:00:01.000Z",
    failure,
  };

  expect(intent).toBe("manual-source");
  expect(attempt.candidate.nativeLabel).toBe("kiwi");
  expect(attempt.candidate.normalizedAudioLanguage).toBe("ja");
  expect(attempt.failure?.failureClass).toBe("candidate-timeout");
});

test("provider metadata v2 contract carries native ids release artwork and language evidence", () => {
  const externalIds: ProviderExternalIds = {
    anilistId: "123",
    malId: "456",
    tmdbId: "789",
  };
  const release: ProviderReleaseInfo = {
    airDate: "2026-05-19",
    availableAt: "2026-05-19T12:30:00.000Z",
    status: "released",
    providerConfirmed: true,
  };
  const artwork: ProviderArtworkInfo = {
    posterUrl: "https://image.example/poster.jpg",
    backdropUrl: "https://image.example/backdrop.jpg",
    seekBarVttUrl: "https://cdn.example/thumbs.vtt",
  };
  const languageEvidence: ProviderLanguageEvidence = {
    role: "audio",
    normalizedLanguage: "ja",
    nativeLabel: "Sub",
    confidence: 0.95,
  };

  const result: ProviderResolveResult = {
    status: "resolved",
    providerId: "allanime",
    selectedStreamId: "stream-1",
    externalIds,
    release,
    artwork,
    streams: [
      {
        id: "stream-1",
        providerId: "allanime",
        sourceId: "kiwi",
        url: "https://cdn.example/master.m3u8",
        protocol: "hls",
        presentation: "sub",
        languageEvidence: [languageEvidence],
        artwork,
        confidence: 0.9,
        cachePolicy: {
          ttlClass: "stream-manifest",
          scope: "local",
          keyParts: ["provider", "allanime", "1", "sub"],
        },
      },
    ],
    subtitles: [],
    trace: {
      id: "trace-1",
      startedAt: "2026-05-19T00:00:00.000Z",
      title: {
        id: "allanime:1",
        kind: "anime",
        title: "Example",
        externalIds,
      },
      cacheHit: false,
      steps: [],
      failures: [],
    },
    failures: [],
  };

  expect(result.externalIds?.malId).toBe("456");
  expect(result.release?.providerConfirmed).toBe(true);
  expect(result.streams[0]?.languageEvidence?.[0]?.nativeLabel).toBe("Sub");
  expect(result.artwork?.seekBarVttUrl).toContain("thumbs.vtt");
});

test("provider source inventory facade preserves playable facts without resolve bookkeeping", () => {
  const result: ProviderResolveResult = {
    status: "resolved",
    providerId: "miruro",
    selectedStreamId: "stream-1",
    artwork: { seekBarVttUrl: "https://cdn.example/seek.vtt" },
    streams: [
      {
        id: "stream-1",
        providerId: "miruro",
        sourceId: "kiwi",
        url: "https://cdn.example/master.m3u8",
        protocol: "hls",
        qualityLabel: "1080p",
        audioLanguages: ["ja"],
        subtitleLanguages: ["en"],
        artwork: { seekBarVttUrl: "https://cdn.example/seek.vtt" },
        confidence: 0.9,
        cachePolicy: {
          ttlClass: "stream-manifest",
          scope: "local",
          keyParts: ["provider", "miruro", "1", "sub"],
        },
      },
    ],
    subtitles: [],
    trace: {
      id: "trace-1",
      startedAt: "2026-05-19T00:00:00.000Z",
      title: { id: "anilist:1", kind: "anime", title: "Example" },
      cacheHit: false,
      steps: [],
      failures: [],
    },
    failures: [
      {
        providerId: "miruro",
        code: "timeout",
        message: "A fallback source timed out",
        retryable: true,
        at: "2026-05-19T00:00:01.000Z",
      },
    ],
  };

  const inventory: ProviderSourceInventory = getProviderSourceInventory(result);

  expect(inventory.providerId).toBe("miruro");
  expect(inventory.selectedStreamId).toBe("stream-1");
  expect(inventory.streams[0]?.qualityLabel).toBe("1080p");
  expect(inventory.artwork?.seekBarVttUrl).toContain("seek.vtt");
  expect("failures" in inventory).toBe(false);
  expect("trace" in inventory).toBe(false);
});
