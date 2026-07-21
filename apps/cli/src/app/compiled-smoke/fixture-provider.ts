import {
  createProviderCachePolicy,
  createResolveTrace,
  createTraceStep,
  defineProviderManifest,
  type CoreProviderModule,
} from "@kunai/core";
import type { StreamCandidate } from "@kunai/types";

import { COMPILED_SMOKE_FIXTURES } from "./scenarios";

function resolvedResult(providerId: "videasy" | "allanime", url: string, titleId: string) {
  const startedAt = new Date().toISOString();
  const cachePolicy = createProviderCachePolicy({
    providerId,
    title: { id: titleId, kind: "movie" },
  });
  const sourceId = `source:${providerId}:smoke`;
  const streamId = `stream:${providerId}:${Bun.hash(url).toString(36)}`;
  const variantId = `variant:${providerId}:smoke:1080p`;
  const stream: StreamCandidate = {
    id: streamId,
    providerId,
    sourceId,
    variantId,
    url,
    protocol: "mp4",
    container: "mp4",
    qualityLabel: "1080p",
    qualityRank: 1080,
    headers: { Referer: "https://smoke.kunai.test/" },
    confidence: 1,
    cachePolicy,
  };
  const endedAt = new Date().toISOString();
  return {
    status: "resolved" as const,
    providerId,
    selectedStreamId: streamId,
    sources: [
      {
        id: sourceId,
        providerId,
        kind: "provider-api" as const,
        label: "SmokeServer",
        host: "smoke.kunai.test",
        status: "selected" as const,
        confidence: 1,
        requiresRuntime: "direct-http" as const,
        cachePolicy,
      },
    ],
    streams: [stream],
    variants: [
      {
        id: variantId,
        providerId,
        sourceId,
        qualityLabel: "1080p",
        qualityRank: 1080,
        protocol: "mp4" as const,
        container: "mp4" as const,
        streamIds: [streamId],
        confidence: 1,
      },
    ],
    subtitles: [],
    cachePolicy,
    trace: createResolveTrace({
      title: { id: titleId, kind: "movie", title: titleId },
      providerId,
      streamId,
      cacheHit: false,
      runtime: "direct-http",
      startedAt,
      endedAt,
      steps: [
        createTraceStep("provider", "Resolved via compiled smoke fixture", {
          providerId,
          attributes: { urlHost: "smoke.kunai.test" },
        }),
      ],
      events: [],
      failures: [],
    }),
    failures: [],
    healthDelta: {
      providerId,
      outcome: "success" as const,
      at: endedAt,
    },
  };
}

function pickUrl(input: {
  title: { id: string };
  episode?: { season?: number; episode?: number; absoluteEpisode?: number };
}): string {
  const id = input.title.id;
  if (id === COMPILED_SMOKE_FIXTURES.movie.titleId) return COMPILED_SMOKE_FIXTURES.movie.streamUrl;
  if (id === COMPILED_SMOKE_FIXTURES.series.titleId)
    return COMPILED_SMOKE_FIXTURES.series.streamUrl;
  if (id === COMPILED_SMOKE_FIXTURES.anime.titleId) return COMPILED_SMOKE_FIXTURES.anime.streamUrl;
  if (id === COMPILED_SMOKE_FIXTURES.queueManual.claimedTitleId) {
    return COMPILED_SMOKE_FIXTURES.queueManual.streamUrl;
  }
  if (id === COMPILED_SMOKE_FIXTURES.autoNext.titleId) {
    return input.episode?.absoluteEpisode === 2
      ? COMPILED_SMOKE_FIXTURES.autoNext.secondStreamUrl
      : COMPILED_SMOKE_FIXTURES.autoNext.firstStreamUrl;
  }
  if (id === COMPILED_SMOKE_FIXTURES.failedHandoff.titleId) {
    return COMPILED_SMOKE_FIXTURES.failedHandoff.streamUrl;
  }
  if (id === COMPILED_SMOKE_FIXTURES.shutdownRestore.titleId) {
    return COMPILED_SMOKE_FIXTURES.shutdownRestore.streamUrl;
  }
  if (id === COMPILED_SMOKE_FIXTURES.returnToShell.titleId) {
    return COMPILED_SMOKE_FIXTURES.returnToShell.streamUrl;
  }
  return `https://smoke.kunai.test/${encodeURIComponent(id)}.mp4`;
}

const videasyManifest = defineProviderManifest({
  id: "videasy",
  displayName: "Smoke Videasy",
  description: "Compiled-smoke movie/series fixture",
  domain: "smoke.kunai.test",
  recommended: true,
  mediaKinds: ["movie", "series"],
  capabilities: ["search", "source-resolve"],
  runtimePorts: [
    {
      runtime: "direct-http",
      operations: ["resolve-stream"],
      browserSafe: true,
      relaySafe: true,
      localOnly: false,
    },
  ],
  cachePolicy: {
    ttlClass: "stream-manifest",
    scope: "local",
    keyParts: ["provider", "videasy", "title"],
  },
  browserSafe: true,
  relaySafe: true,
  status: "candidate",
});

const allanimeManifest = defineProviderManifest({
  id: "allanime",
  displayName: "Smoke AllAnime",
  description: "Compiled-smoke anime fixture",
  domain: "smoke.kunai.test",
  recommended: true,
  mediaKinds: ["anime"],
  capabilities: ["search", "episode-list", "source-resolve"],
  runtimePorts: [
    {
      runtime: "direct-http",
      operations: ["resolve-stream"],
      browserSafe: true,
      relaySafe: true,
      localOnly: false,
    },
  ],
  cachePolicy: {
    ttlClass: "stream-manifest",
    scope: "local",
    keyParts: ["provider", "allanime", "title", "episode"],
  },
  browserSafe: true,
  relaySafe: true,
  status: "candidate",
});

export const videasySmokeProviderModule: CoreProviderModule = {
  providerId: "videasy",
  manifest: videasyManifest,
  async search(input) {
    const q = input.query.toLowerCase();
    const out = [];
    if (COMPILED_SMOKE_FIXTURES.movie.title.toLowerCase().includes(q) || q.includes("movie")) {
      out.push({
        id: COMPILED_SMOKE_FIXTURES.movie.titleId,
        type: "movie" as const,
        title: COMPILED_SMOKE_FIXTURES.movie.title,
        year: "2026",
        overview: "Compiled smoke movie",
        posterPath: null,
        metadataSource: "Smoke",
      });
    }
    if (COMPILED_SMOKE_FIXTURES.series.title.toLowerCase().includes(q) || q.includes("series")) {
      out.push({
        id: COMPILED_SMOKE_FIXTURES.series.titleId,
        type: "series" as const,
        title: COMPILED_SMOKE_FIXTURES.series.title,
        year: "2026",
        overview: "Compiled smoke series",
        posterPath: null,
        metadataSource: "Smoke",
      });
    }
    if (
      COMPILED_SMOKE_FIXTURES.returnToShell.title.toLowerCase().includes(q) ||
      q.includes("shell")
    ) {
      out.push({
        id: COMPILED_SMOKE_FIXTURES.returnToShell.titleId,
        type: "movie" as const,
        title: COMPILED_SMOKE_FIXTURES.returnToShell.title,
        year: "2026",
        overview: "Compiled smoke shell return",
        posterPath: null,
        metadataSource: "Smoke",
      });
    }
    return out;
  },
  async resolve(input) {
    return resolvedResult("videasy", pickUrl(input), input.title.id);
  },
};

export const allanimeSmokeProviderModule: CoreProviderModule = {
  providerId: "allanime",
  manifest: allanimeManifest,
  async search(input) {
    const q = input.query.toLowerCase();
    if (!(COMPILED_SMOKE_FIXTURES.anime.title.toLowerCase().includes(q) || q.includes("anime"))) {
      return [];
    }
    return [
      {
        id: COMPILED_SMOKE_FIXTURES.anime.titleId,
        type: "series" as const,
        title: COMPILED_SMOKE_FIXTURES.anime.title,
        year: "2026",
        overview: "Compiled smoke anime",
        posterPath: null,
        metadataSource: "Smoke",
        availableAudioModes: ["sub" as const],
      },
    ];
  },
  async listEpisodes() {
    return [{ index: 7, label: "Episode 7", totalEpisodeCount: 12 }];
  },
  async resolve(input) {
    return resolvedResult("allanime", pickUrl(input), input.title.id);
  },
};

/** Bundled smoke providers — activated only when both smoke env gates pass. */
export const providerModules: readonly CoreProviderModule[] = [
  videasySmokeProviderModule,
  allanimeSmokeProviderModule,
];
