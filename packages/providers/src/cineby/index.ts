import { defineProviderManifest, type CoreProviderModule } from "@kunai/core";
import type {
  ProviderFailure,
  ProviderResolveInput,
  ProviderResolveResult,
  ProviderRuntimeContext,
  ProviderTraceEvent,
} from "@kunai/types";

import { createExhaustedResult } from "../shared/resolve-helpers";
import { resolveVidkingDirect, type VidKingEngineOptions } from "../vidking/direct";

export const CINEBY_PROVIDER_ID = "cineby" as const;

export interface CinebyFlavor {
  readonly label: string;
  readonly server: NonNullable<VidKingEngineOptions["serverEndpoint"]>;
  readonly languageQuery?: string;
  readonly qualityFilter?: string;
  readonly audioLanguage: string;
  readonly moviesOnly?: boolean;
}

const DEFAULT_CINEBY_FLAVOR: CinebyFlavor = {
  label: "Neon",
  server: "mb-flix",
  audioLanguage: "en",
};

const CINEBY_FLAVORS: readonly CinebyFlavor[] = [
  DEFAULT_CINEBY_FLAVOR,
  { label: "Yoru", server: "cdn", audioLanguage: "en" },
  { label: "Cypher", server: "downloader2", audioLanguage: "en" },
  { label: "Sage", server: "1movies", audioLanguage: "en" },
  { label: "Vyse", server: "hdmovie", qualityFilter: "English", audioLanguage: "en" },
  { label: "Killjoy", server: "meine", languageQuery: "german", audioLanguage: "de" },
  { label: "Harbor", server: "meine", languageQuery: "italian", audioLanguage: "it" },
  {
    label: "Chamber",
    server: "meine",
    languageQuery: "french",
    audioLanguage: "fr",
    moviesOnly: true,
  },
  { label: "Fade", server: "hdmovie", qualityFilter: "Hindi", audioLanguage: "hi" },
  { label: "Omen", server: "lamovie", audioLanguage: "es" },
  { label: "Raze", server: "superflix", audioLanguage: "pt" },
];

export const cinebyManifest = defineProviderManifest({
  id: CINEBY_PROVIDER_ID,
  displayName: "Cineby",
  aliases: ["Videasy flavor wrapper"],
  description: "Cineby flavor wrapper over Videasy-compatible endpoints",
  domain: "cineby.sc",
  recommended: false,
  mediaKinds: ["movie", "series"],
  capabilities: ["source-resolve", "subtitle-resolve", "multi-source", "quality-ranked"],
  runtimePorts: [
    {
      runtime: "direct-http",
      operations: ["resolve-stream", "resolve-subtitles", "health-check"],
      browserSafe: false,
      relaySafe: false,
      localOnly: true,
    },
  ],
  cachePolicy: {
    ttlClass: "stream-manifest",
    scope: "local",
    keyParts: ["provider", CINEBY_PROVIDER_ID, "media-kind", "title", "season", "episode"],
    allowStale: true,
  },
  browserSafe: false,
  relaySafe: false,
  status: "research",
  notes: [
    "Research wrapper only; production fallback order still prefers the proven vidking module.",
    "Keeps flavor labels and audio-language hints while reusing the VidKing direct engine.",
  ],
});

export const cinebyProviderModule: CoreProviderModule = {
  providerId: CINEBY_PROVIDER_ID,
  manifest: cinebyManifest,

  async resolve(
    input: ProviderResolveInput,
    context: ProviderRuntimeContext,
  ): Promise<ProviderResolveResult> {
    if (input.mediaKind !== "movie" && input.mediaKind !== "series") {
      return createExhaustedResult(input, context, CINEBY_PROVIDER_ID, {
        code: "unsupported-title",
        message: "Cineby wrapper only supports movie and series content",
        retryable: false,
      });
    }

    const preferredFlavor = selectCinebyFlavor(input);
    const result = await resolveVidkingDirect(input, context, {
      serverEndpoint: preferredFlavor.server,
      language: preferredFlavor.languageQuery,
      filterQuality: preferredFlavor.qualityFilter,
      flavorLabel: preferredFlavor.label,
      flavorArchetype: "Cineby flavors",
    });

    if (!result) {
      return createExhaustedResult(input, context, CINEBY_PROVIDER_ID, {
        code: "not-found",
        message: "Cineby wrapper did not receive a VidKing result",
        retryable: true,
      });
    }

    return remapVidkingResult(result, preferredFlavor);
  },
};

function selectCinebyFlavor(input: ProviderResolveInput): CinebyFlavor {
  const eligible =
    input.mediaKind === "series"
      ? CINEBY_FLAVORS.filter((flavor) => !flavor.moviesOnly)
      : CINEBY_FLAVORS;

  return (
    eligible.find((flavor) => flavor.audioLanguage === input.preferredAudioLanguage) ??
    eligible[0] ??
    DEFAULT_CINEBY_FLAVOR
  );
}

function remapVidkingResult(
  result: ProviderResolveResult,
  flavor: CinebyFlavor,
): ProviderResolveResult {
  const remapEvent = (event: ProviderTraceEvent): ProviderTraceEvent => ({
    ...event,
    providerId: CINEBY_PROVIDER_ID,
    attributes: {
      ...event.attributes,
      upstreamProvider: result.providerId,
      flavor: flavor.label,
    },
  });
  const remapFailure = (failure: ProviderFailure): ProviderFailure => ({
    ...failure,
    providerId: CINEBY_PROVIDER_ID,
    message: `Cineby via ${failure.message}`,
  });

  return {
    ...result,
    providerId: CINEBY_PROVIDER_ID,
    sources: result.sources?.map((source) => ({
      ...source,
      providerId: CINEBY_PROVIDER_ID,
      label: flavor.label,
      metadata: {
        ...source.metadata,
        upstreamProvider: result.providerId,
        flavorArchetype: "Cineby flavors",
        flavorLabel: flavor.label,
      },
    })),
    streams: result.streams.map((stream) => ({
      ...stream,
      providerId: CINEBY_PROVIDER_ID,
      audioLanguages: [flavor.audioLanguage],
      presentation: "raw",
      subtitleDelivery: "external",
      flavorArchetype: "Cineby flavors",
      flavorLabel: flavor.label,
      metadata: {
        ...stream.metadata,
        upstreamProvider: result.providerId,
      },
    })),
    variants: result.variants?.map((variant) => ({
      ...variant,
      providerId: CINEBY_PROVIDER_ID,
      presentation: "raw",
      subtitleDelivery: "external",
      audioLanguages: [flavor.audioLanguage],
      flavorArchetype: "Cineby flavors",
      flavorLabel: flavor.label,
    })),
    trace: {
      ...result.trace,
      selectedProviderId: CINEBY_PROVIDER_ID,
      events: result.trace.events?.map(remapEvent),
      failures: result.trace.failures.map(remapFailure),
    },
    failures: result.failures.map(remapFailure),
    healthDelta: result.healthDelta
      ? { ...result.healthDelta, providerId: CINEBY_PROVIDER_ID }
      : undefined,
  };
}
