import { expect, test } from "bun:test";

import {
  availableAudioModesFromTrace,
  buildPlaybackSourceInventoryDiagnosticsSummary,
  projectPlaybackSourceInventory,
} from "@/services/playback/PlaybackSourceInventoryProjection";
import { flavorSourceId, listVidkingFlavors } from "@kunai/providers";
import type { ProviderResolveResult, ProviderSourceCandidate, StreamCandidate } from "@kunai/types";

const cachePolicy = {
  ttlClass: "stream-manifest",
  scope: "local",
  keyParts: [],
} as const;

function trace(
  overrides: Partial<ProviderResolveResult["trace"]> = {},
): ProviderResolveResult["trace"] {
  return {
    id: "trace-1",
    startedAt: "2026-05-19T00:00:00.000Z",
    cacheHit: false,
    title: { id: "demo", kind: "anime", title: "Demo" },
    steps: [],
    failures: [],
    ...overrides,
  };
}

function stream(overrides: Partial<StreamCandidate>): StreamCandidate {
  return {
    id: "stream-1",
    providerId: "allanime",
    sourceId: "source-sub",
    protocol: "hls",
    container: "m3u8",
    url: "https://cdn.example/stream.m3u8",
    confidence: 0.9,
    cachePolicy,
    ...overrides,
  };
}

function source(overrides: Partial<ProviderSourceCandidate>): ProviderSourceCandidate {
  return {
    id: "source-sub",
    providerId: "allanime",
    kind: "mirror",
    label: "Default",
    status: "available",
    confidence: 0.9,
    ...overrides,
  };
}

test("projects anime sub dub and hardsub evidence without merging native labels into languages", () => {
  const view = projectPlaybackSourceInventory({
    status: "resolved",
    providerId: "allanime",
    selectedStreamId: "sub-1080",
    artwork: { posterUrl: "https://image.example/poster.jpg" },
    streams: [
      stream({
        id: "sub-1080",
        sourceId: "source-sub",
        presentation: "sub",
        qualityLabel: "1080p",
        qualityRank: 1080,
        audioLanguages: ["ja"],
        hardSubLanguage: "en",
        subtitleDelivery: "hardcoded",
        artwork: { seekBarVttUrl: "https://cdn.example/seek.vtt" },
        sourceEvidence: [{ nativeLabel: "Sak", serverId: "sak" }],
        languageEvidence: [
          { role: "audio", normalizedLanguage: "ja", nativeLabel: "Japanese" },
          { role: "hardsub", normalizedLanguage: "en", nativeLabel: "English hard subtitles" },
        ],
      }),
      stream({
        id: "dub-720",
        sourceId: "source-dub",
        presentation: "dub",
        qualityLabel: "720p",
        qualityRank: 720,
        audioLanguages: ["en"],
        sourceEvidence: [{ nativeLabel: "Luf", serverId: "luf" }],
        languageEvidence: [{ role: "audio", normalizedLanguage: "en", nativeLabel: "English dub" }],
      }),
    ],
    sources: [
      source({
        id: "source-sub",
        label: "Sub server",
        status: "selected",
        sourceEvidence: [{ nativeLabel: "Sak" }],
      }),
      source({
        id: "source-dub",
        label: "Dub server",
        sourceEvidence: [{ nativeLabel: "Luf" }],
      }),
    ],
    subtitles: [],
    trace: trace(),
    failures: [],
  });

  expect(view.selected).toMatchObject({
    streamId: "sub-1080",
    presentation: "sub",
    artwork: {
      posterUrl: "https://image.example/poster.jpg",
      seekBarVttUrl: "https://cdn.example/seek.vtt",
    },
    audioLanguages: ["ja"],
    subtitleLanguages: ["en"],
    subtitleDelivery: "hardcoded",
  });
  expect(view.sourceGroups.find((group) => group.id === "source-sub")).toMatchObject({
    label: "Sub server",
    state: "selected",
  });
  expect(view.sourceGroups.find((group) => group.id === "source-dub")).toMatchObject({
    label: "Dub server",
    state: "available",
  });
  expect(view.sourceGroups).toHaveLength(2);
  const subServer = view.sourceGroups.find((group) => group.id === "source-sub");
  expect(subServer?.nativeLabels).toContain("Sak");
  expect(subServer?.artwork?.seekBarVttUrl).toContain("seek.vtt");
  expect(view.languageOptions.find((option) => option.id === "audio:en")).toMatchObject({
    label: "Audio English",
    state: "available",
    nativeLabels: ["English dub"],
  });
  expect(view.subtitleOptions.find((option) => option.delivery === "hardcoded")).toMatchObject({
    language: "en",
    state: "selected",
  });
});

test("projects series provider servers as source evidence and normalized audio separately", () => {
  const view = projectPlaybackSourceInventory({
    status: "resolved",
    providerId: "vidking",
    selectedStreamId: "hindicast-1080",
    streams: [
      stream({
        id: "hindicast-1080",
        providerId: "vidking",
        sourceId: "hindicast",
        qualityLabel: "1080p",
        qualityRank: 1080,
        audioLanguages: ["hi"],
        sourceEvidence: [{ nativeLabel: "HindiCast (1080)", serverId: "hindicast" }],
        languageEvidence: [{ role: "audio", normalizedLanguage: "hi", nativeLabel: "HindiCast" }],
      }),
      stream({
        id: "flowcast-720",
        providerId: "vidking",
        sourceId: "flowcast",
        qualityLabel: "720p",
        qualityRank: 720,
        audioLanguages: ["en"],
        sourceEvidence: [{ nativeLabel: "FlowCast (720)", serverId: "flowcast" }],
        languageEvidence: [{ role: "audio", normalizedLanguage: "en", nativeLabel: "FlowCast" }],
      }),
    ],
    sources: [
      source({
        id: "hindicast",
        providerId: "vidking",
        label: "HindiCast",
        status: "selected",
        sourceEvidence: [{ nativeLabel: "HindiCast (1080)" }],
      }),
      source({
        id: "flowcast",
        providerId: "vidking",
        label: "FlowCast",
        sourceEvidence: [{ nativeLabel: "FlowCast (720)" }],
      }),
    ],
    subtitles: [],
    trace: trace({ title: { id: "demo", kind: "series", title: "Demo" } }),
    failures: [],
  });

  const hindiCast = view.sourceGroups.find((group) => group.id === "hindicast");
  expect(hindiCast).toMatchObject({
    id: "hindicast",
    label: "HindiCast",
    audioLanguages: ["hi"],
  });
  expect(hindiCast?.nativeLabels).toContain("HindiCast (1080)");
  expect(view.languageOptions.find((option) => option.id === "audio:hi")).toMatchObject({
    label: "Audio Hindi",
    nativeLabels: ["HindiCast"],
    sourceIds: ["hindicast"],
  });
  expect(view.qualityOptions.map((option) => option.label)).toEqual(["1080p", "720p"]);
});

test("adds known VidKing flavor sources to the source picker model", () => {
  const view = projectPlaybackSourceInventory({
    status: "resolved",
    providerId: "vidking",
    selectedStreamId: "neon-1080",
    streams: [
      stream({
        id: "neon-1080",
        providerId: "vidking",
        sourceId: flavorSourceId("cineby-neon"),
        qualityLabel: "1080p",
      }),
    ],
    sources: [
      source({
        id: flavorSourceId("cineby-neon"),
        providerId: "vidking",
        label: "Neon",
        status: "selected",
      }),
    ],
    subtitles: [],
    trace: trace({ title: { id: "61700", kind: "series", title: "The Last of Us" } }),
    failures: [],
  });

  const sourceIds = view.sourceGroups.map((group) => group.id);
  const expectedSeriesFlavorIds = listVidkingFlavors()
    .filter((flavor) => !flavor.moviesOnly)
    .map((flavor) => flavorSourceId(flavor.id));

  expect(sourceIds).toEqual(expect.arrayContaining(expectedSeriesFlavorIds));
  expect(sourceIds).not.toContain(flavorSourceId("videasy-french"));
  expect(
    view.sourceGroups.find((group) => group.id === flavorSourceId("cineby-sage")),
  ).toMatchObject({
    label: "Sage",
    state: "skipped",
    audioLanguages: ["en"],
    disabledReason: "Fresh resolve required to try this source.",
    hints: expect.arrayContaining(["Original audio"]),
  });
});

test("marks provider-failed alternate sources non-selectable even when streams exist", () => {
  const view = projectPlaybackSourceInventory({
    status: "resolved",
    providerId: "vidking",
    selectedStreamId: "sanji-1080",
    streams: [
      stream({
        id: "sanji-1080",
        providerId: "vidking",
        sourceId: "sanji",
        qualityLabel: "1080p",
      }),
      stream({
        id: "robin-720",
        providerId: "vidking",
        sourceId: "robin",
        qualityLabel: "720p",
      }),
    ],
    sources: [
      source({
        id: "sanji",
        providerId: "vidking",
        label: "Sanji",
        status: "failed",
      }),
      source({
        id: "robin",
        providerId: "vidking",
        label: "Robin",
        status: "failed",
      }),
    ],
    subtitles: [],
    trace: trace({ title: { id: "demo", kind: "series", title: "Demo" } }),
    failures: [],
  });

  expect(view.sourceGroups.map((group) => [group.id, group.state])).toEqual(
    expect.arrayContaining([
      ["sanji", "selected"],
      ["robin", "failed"],
    ]),
  );
  expect(view.sourceGroups.find((group) => group.id === "robin")?.disabledReason).toBeDefined();
});

test("falls back to stream source ids when provider source inventory is missing", () => {
  const view = projectPlaybackSourceInventory({
    status: "resolved",
    providerId: "rivestream",
    selectedStreamId: "stream-b",
    streams: [
      stream({
        id: "stream-a",
        providerId: "rivestream",
        sourceId: "source-a",
        qualityLabel: "360p",
      }),
      stream({
        id: "stream-b",
        providerId: "rivestream",
        sourceId: "source-b",
        qualityLabel: "720p",
      }),
    ],
    subtitles: [
      {
        id: "sub-en",
        providerId: "rivestream",
        sourceId: "source-b",
        url: "https://subs.example/en.vtt",
        language: "en",
        label: "English",
        source: "provider",
        confidence: 0.9,
        cachePolicy: { ...cachePolicy, ttlClass: "subtitle-list" },
      },
    ],
    trace: trace(),
    failures: [],
  });

  const resolvedGroups = view.sourceGroups.filter((group) =>
    ["source-a", "source-b"].includes(group.id),
  );
  expect(resolvedGroups.map((group) => [group.id, group.state])).toEqual([
    ["source-a", "available"],
    ["source-b", "selected"],
  ]);
  expect(view.sourceGroups).toHaveLength(2);
  expect(view.subtitleOptions.find((option) => option.id === "subtitle:sub-en")).toMatchObject({
    delivery: "external",
    sourceIds: ["source-b"],
    restartRequired: false,
  });
});

test("projects deterministic source health hints from provider metadata", () => {
  const summary = buildPlaybackSourceInventoryDiagnosticsSummary({
    status: "resolved",
    providerId: "rivestream",
    selectedStreamId: "stream-a",
    streams: [
      stream({
        id: "stream-a",
        providerId: "rivestream",
        sourceId: "source-a",
        qualityLabel: "1080p",
        qualityRank: 1080,
        url: "https://media.example/watch/master.m3u8",
        artwork: { seekBarVttUrl: "https://media.example/timing.vtt" },
        metadata: { intro: { start: 90, end: 180 } },
      }),
      stream({
        id: "stream-b",
        providerId: "rivestream",
        sourceId: "source-b",
        qualityLabel: "720p",
        qualityRank: 720,
        url: "https://backup.example/watch/master.m3u8",
      }),
    ],
    sources: [
      source({
        id: "source-a",
        providerId: "rivestream",
        label: "Primary",
        status: "selected",
        host: "primary.example",
      }),
      source({
        id: "source-b",
        providerId: "rivestream",
        label: "Backup",
        status: "failed",
        host: "backup.example",
      }),
    ],
    subtitles: [
      {
        id: "sub-en",
        providerId: "rivestream",
        sourceId: "source-a",
        url: "https://subs.example/en.vtt",
        language: "en",
        label: "English",
        source: "provider",
        confidence: 0.9,
        cachePolicy: { ...cachePolicy, ttlClass: "subtitle-list" },
      },
    ],
    trace: trace(),
    failures: [],
  });

  expect(summary.sourceGroups.find((group) => group.id === "source-a")?.hints).toEqual([
    "selected",
    "host primary.example",
    "has timing",
    "seek thumbnails",
    "1 subtitle",
  ]);
  expect(summary.sourceGroups.find((group) => group.id === "source-b")?.hints).toEqual([
    "failed",
    "host backup.example",
  ]);
  expect(summary.qualityOptions.find((option) => option.label === "1080p")?.hints).toEqual([
    "selected",
    "host media.example",
    "has timing",
    "seek thumbnails",
    "1 subtitle",
  ]);
});

test("does not describe seek thumbnails as provider timing evidence", () => {
  const summary = buildPlaybackSourceInventoryDiagnosticsSummary({
    status: "resolved",
    providerId: "vidking",
    selectedStreamId: "stream-a",
    streams: [
      stream({
        id: "stream-a",
        providerId: "vidking",
        sourceId: "source-a",
        artwork: { seekBarVttUrl: "https://media.example/seek.vtt" },
      }),
    ],
    subtitles: [],
    trace: trace(),
    failures: [],
  });

  const hints = summary.qualityOptions[0]?.hints ?? [];
  expect(hints).toContain("seek thumbnails");
  expect(hints).not.toContain("has timing");
});

test("surfaces exhausted provider failures as warnings and disabled retry controls", () => {
  const view = projectPlaybackSourceInventory({
    status: "exhausted",
    providerId: "vidking",
    streams: [],
    sources: [
      source({
        id: "blocked-source",
        providerId: "vidking",
        status: "failed",
      }),
    ],
    subtitles: [],
    trace: trace({ failures: [] }),
    failures: [
      {
        providerId: "vidking",
        code: "blocked",
        message: "Provider returned 403",
        retryable: false,
        at: "2026-05-19T00:00:01.000Z",
      },
    ],
  });

  expect(view.warnings.map((warning) => warning.id)).toEqual([
    "resolve-exhausted",
    "no-playable-streams",
  ]);
  expect(view.warnings[0]?.developerDetail).toBe("blocked: Provider returned 403");
  expect(view.recoveryActions.find((action) => action.id === "retry-current")).toMatchObject({
    disabled: true,
    preservesTimestamp: true,
  });
  expect(view.sourceGroups.find((group) => group.id === "blocked-source")).toMatchObject({
    state: "failed",
    disabledReason: "Source failed during resolve — try another mirror.",
  });
});

test("builds a diagnostics-safe source inventory summary without stream or subtitle URLs", () => {
  const summary = buildPlaybackSourceInventoryDiagnosticsSummary(
    {
      status: "resolved",
      providerId: "rivestream",
      selectedStreamId: "stream-b",
      streams: [
        stream({
          id: "stream-b",
          providerId: "rivestream",
          sourceId: "source-b",
          qualityLabel: "720p",
          audioLanguages: ["en"],
          artwork: { seekBarVttUrl: "https://image.example/seek.vtt" },
          url: "https://cdn.example/private-stream.m3u8",
        }),
      ],
      subtitles: [
        {
          id: "sub-en",
          providerId: "rivestream",
          sourceId: "source-b",
          url: "https://subs.example/private-en.vtt",
          language: "en",
          label: "English",
          source: "provider",
          confidence: 0.9,
          cachePolicy: { ...cachePolicy, ttlClass: "subtitle-list" },
        },
      ],
      trace: trace(),
      failures: [],
    },
    { selectedSubtitleUrl: "https://subs.example/private-en.vtt" },
  );

  expect(summary.selected).toMatchObject({
    sourceId: "source-b",
    streamId: "stream-b",
    qualityLabel: "720p",
    audioLanguageCount: 1,
    subtitleLanguageCount: 1,
    hasArtwork: true,
    hasSeekBarThumbnails: true,
  });
  expect(summary.sourceGroups.find((group) => group.id === "source-b")).toMatchObject({
    id: "source-b",
    label: "source-b",
    state: "selected",
    nativeLabelCount: 1,
    hasArtwork: true,
    hasSeekBarThumbnails: true,
    audioLanguageCount: 1,
    subtitleLanguageCount: 1,
    candidateCount: 1,
  });
  expect(summary.sourceGroups).toHaveLength(1);
  expect(summary.subtitleOptions.find((option) => option.id === "subtitle:sub-en")).toEqual({
    id: "subtitle:sub-en",
    label: "English",
    state: "selected",
    delivery: "external",
    language: "en",
    candidateCount: 1,
  });
  expect(summary.subtitleOptions.find((option) => option.id === "subtitle:off")).toMatchObject({
    delivery: "off",
    state: "available",
  });
  expect(JSON.stringify(summary)).not.toContain("private-stream");
  expect(JSON.stringify(summary)).not.toContain("private-en.vtt");
});

test("availableAudioModesFromTrace exposes dual sub/dub rows only when trace confirms both modes", () => {
  const dual = availableAudioModesFromTrace({
    status: "resolved",
    providerId: "allanime",
    selectedStreamId: "sub-1080",
    streams: [],
    failures: [],
    subtitles: [],
    trace: trace({
      events: [
        {
          type: "inventory:audio-modes",
          providerId: "allanime",
          at: "2026-05-19T00:00:00.000Z",
          message: "Dual audio catalog available",
          attributes: { modes: "sub,dub" },
        },
      ],
    }),
  });
  expect(dual).toEqual(["sub", "dub"]);

  const single = availableAudioModesFromTrace({
    status: "resolved",
    providerId: "allanime",
    selectedStreamId: "sub-1080",
    streams: [],
    failures: [],
    subtitles: [],
    trace: trace(),
  });
  expect(single).toEqual([]);
});
