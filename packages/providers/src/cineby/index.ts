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
import { flavorSourceId, listVidkingFlavors, vidkingSourceIdForEndpoint } from "../vidking/flavors";

export const CINEBY_PROVIDER_ID = "cineby" as const;

export interface CinebyFlavor {
  readonly flavorId?: string;
  readonly label: string;
  readonly server: NonNullable<VidKingEngineOptions["serverEndpoint"]>;
  readonly languageQuery?: string;
  readonly qualityFilter?: string;
  readonly audioLanguage: string;
  readonly moviesOnly?: boolean;
}

const DEFAULT_CINEBY_FLAVOR: CinebyFlavor = {
  flavorId: "videasy-primary",
  label: "Neon",
  server: "mb-flix",
  audioLanguage: "en",
};

const CINEBY_FLAVORS: readonly CinebyFlavor[] = listVidkingFlavors().map((flavor) => ({
  flavorId: flavor.id,
  label: flavor.cinebyAlias ?? flavor.themeLabel,
  server: flavor.endpoint as CinebyFlavor["server"],
  languageQuery: flavor.languageQuery,
  qualityFilter: flavor.filterQuality,
  audioLanguage: flavor.audioLanguage,
  moviesOnly: flavor.moviesOnly,
}));

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
    const registryFlavor = listVidkingFlavors().find(
      (flavor) => flavor.endpoint === preferredFlavor.server,
    );
    const result = await resolveVidkingDirect(input, context, {
      flavorId: registryFlavor?.id,
      serverEndpoint: preferredFlavor.server,
      language: preferredFlavor.languageQuery,
      filterQuality: preferredFlavor.qualityFilter,
      flavorLabel: registryFlavor?.themeLabel ?? preferredFlavor.label,
      flavorArchetype: registryFlavor?.subtitle ?? "Cineby flavors",
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
  const fallbackIdentity = resolveCinebySourceIdentity({
    flavorId: flavor.flavorId,
    server: flavor.server,
  });
  const sourceIdentities = new Map<string, CinebySourceIdentity>();
  for (const source of result.sources ?? []) {
    const identity = resolveCinebySourceIdentity({
      flavorId: stringMetadata(source.metadata?.flavorId),
      server: stringMetadata(source.metadata?.server),
      fallback: fallbackIdentity,
    });
    sourceIdentities.set(source.id, identity);
  }
  const identityForSourceId = (sourceId: string | undefined): CinebySourceIdentity =>
    (sourceId ? sourceIdentities.get(sourceId) : undefined) ?? fallbackIdentity;

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
    status: result.status,
    providerId: CINEBY_PROVIDER_ID,
    sources: result.sources?.map((source) => {
      const identity = identityForSourceId(source.id);
      return {
        ...source,
        id: identity.sourceId,
        providerId: CINEBY_PROVIDER_ID,
        label: identity.label,
        metadata: {
          ...source.metadata,
          upstreamProvider: result.providerId,
          flavorId: identity.flavorId,
          flavorArchetype: identity.subtitle,
          flavorLabel: identity.label,
          server: identity.server,
        },
      };
    }),
    streams: result.streams.map((stream) => {
      const identity = identityForSourceId(stream.sourceId);
      return {
        ...stream,
        providerId: CINEBY_PROVIDER_ID,
        sourceId: identity.sourceId,
        audioLanguages: [identity.audioLanguage],
        presentation: "raw",
        subtitleDelivery: "external",
        flavorArchetype: identity.subtitle,
        flavorLabel: identity.label,
        serverName: identity.label,
        metadata: {
          ...stream.metadata,
          upstreamProvider: result.providerId,
        },
      };
    }),
    variants: result.variants?.map((variant) => {
      const identity = identityForSourceId(variant.sourceId);
      return {
        ...variant,
        providerId: CINEBY_PROVIDER_ID,
        sourceId: identity.sourceId,
        presentation: "raw",
        subtitleDelivery: "external",
        audioLanguages: [identity.audioLanguage],
        flavorArchetype: identity.subtitle,
        flavorLabel: identity.label,
      };
    }),
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

interface CinebySourceIdentity {
  readonly sourceId: string;
  readonly label: string;
  readonly subtitle: string;
  readonly server: string;
  readonly flavorId?: string;
  readonly audioLanguage: string;
}

function resolveCinebySourceIdentity({
  flavorId,
  server,
  fallback,
}: {
  readonly flavorId?: string;
  readonly server?: string;
  readonly fallback?: CinebySourceIdentity;
}): CinebySourceIdentity {
  const registryFlavor =
    (flavorId ? listVidkingFlavors().find((entry) => entry.id === flavorId) : undefined) ??
    (server ? listVidkingFlavors().find((entry) => entry.endpoint === server) : undefined);
  const cinebyFlavor =
    (registryFlavor
      ? CINEBY_FLAVORS.find((entry) => entry.flavorId === registryFlavor.id)
      : undefined) ??
    (server ? CINEBY_FLAVORS.find((entry) => entry.server === server) : undefined);

  if (!registryFlavor && !cinebyFlavor && fallback) return fallback;

  const resolvedServer = registryFlavor?.endpoint ?? cinebyFlavor?.server ?? server ?? "mb-flix";
  return {
    sourceId: registryFlavor
      ? flavorSourceId(registryFlavor.id)
      : vidkingSourceIdForEndpoint(resolvedServer),
    label:
      cinebyFlavor?.label ??
      registryFlavor?.cinebyAlias ??
      registryFlavor?.themeLabel ??
      resolvedServer,
    subtitle: registryFlavor?.subtitle ?? "Cineby flavors",
    server: resolvedServer,
    flavorId: registryFlavor?.id,
    audioLanguage: registryFlavor?.audioLanguage ?? cinebyFlavor?.audioLanguage ?? "en",
  };
}

function stringMetadata(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
