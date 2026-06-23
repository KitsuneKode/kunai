import type { VidKingEngineOptions } from "./direct";
import { VIDEOSY_PROVIDER_ID } from "./manifest";

export type VidkingFlavorPresentation = {
  readonly flavorId?: VidkingFlavorId;
  readonly themeLabel: string;
  readonly subtitle: string;
  readonly endpoint: string;
};

export type VidkingFlavorId =
  | "videasy-primary"
  | "videasy-mirror-a"
  | "videasy-mirror-b"
  | "videasy-mirror-c"
  | "videasy-breach"
  | "videasy-english-alt"
  | "videasy-german"
  | "videasy-italian"
  | "videasy-french"
  | "videasy-hindi"
  | "videasy-spanish"
  | "videasy-portuguese";

export type VidkingFlavorDefinition = {
  readonly id: VidkingFlavorId;
  readonly themeLabel: string;
  readonly subtitle: string;
  readonly cinebyAlias?: string;
  readonly endpoint: string;
  readonly languageQuery?: string;
  readonly filterQuality?: string;
  readonly audioLanguage: string;
  readonly moviesOnly?: boolean;
  readonly phaseAOrder?: number;
  /** API route removed from api.videasy.to — skip probes and preferred-source resolve. */
  readonly deprecated?: boolean;
};

const FLAVORS: readonly VidkingFlavorDefinition[] = [
  {
    id: "videasy-primary",
    themeLabel: "Luffy",
    subtitle: "Original · primary",
    cinebyAlias: "Neon",
    endpoint: "mb-flix",
    audioLanguage: "en",
    phaseAOrder: 0,
  },
  {
    id: "videasy-mirror-a",
    themeLabel: "Zoro",
    subtitle: "Original · may have 4K",
    cinebyAlias: "Yoru",
    endpoint: "cdn",
    audioLanguage: "en",
    phaseAOrder: 1,
  },
  {
    id: "videasy-mirror-b",
    themeLabel: "Nami",
    subtitle: "Original · mirror",
    cinebyAlias: "Cypher",
    endpoint: "downloader2",
    audioLanguage: "en",
    phaseAOrder: 2,
  },
  {
    id: "videasy-mirror-c",
    themeLabel: "Sanji",
    subtitle: "Original · mirror",
    cinebyAlias: "Sage",
    endpoint: "1movies",
    audioLanguage: "en",
    deprecated: true,
  },
  {
    id: "videasy-breach",
    themeLabel: "Blackbeard",
    subtitle: "Original · mirror",
    cinebyAlias: "Breach",
    endpoint: "m4uhd",
    audioLanguage: "en",
  },
  {
    id: "videasy-english-alt",
    themeLabel: "Robin",
    subtitle: "Original · alt track",
    cinebyAlias: "Vyse",
    endpoint: "hdmovie",
    filterQuality: "English",
    audioLanguage: "en",
  },
  {
    id: "videasy-german",
    themeLabel: "Brook",
    subtitle: "German · dub",
    cinebyAlias: "Killjoy",
    endpoint: "meine",
    languageQuery: "german",
    audioLanguage: "de",
  },
  {
    id: "videasy-hindi",
    themeLabel: "Chopper",
    subtitle: "Hindi · dub",
    cinebyAlias: "Fade",
    endpoint: "hdmovie",
    filterQuality: "Hindi",
    audioLanguage: "hi",
  },
  {
    id: "videasy-spanish",
    themeLabel: "Ace",
    subtitle: "Spanish · dub",
    cinebyAlias: "Omen",
    endpoint: "lamovie",
    audioLanguage: "es",
  },
  {
    id: "videasy-portuguese",
    themeLabel: "Sabo",
    subtitle: "Portuguese · dub",
    cinebyAlias: "Raze",
    endpoint: "superflix",
    audioLanguage: "pt",
  },
  {
    id: "videasy-italian",
    themeLabel: "Shanks",
    subtitle: "Italian · dub",
    cinebyAlias: "Harbor",
    endpoint: "meine",
    languageQuery: "italian",
    audioLanguage: "it",
  },
  {
    id: "videasy-french",
    themeLabel: "Law",
    subtitle: "French · dub · movies",
    cinebyAlias: "Chamber",
    endpoint: "meine",
    languageQuery: "french",
    audioLanguage: "fr",
    moviesOnly: true,
  },
] as const;

const FLAVOR_BY_ID = new Map(FLAVORS.map((flavor) => [flavor.id, flavor]));

/** Stable inventory id for a Videasy endpoint — same on every episode. */
export function videasySourceIdForEndpoint(endpoint: string): string {
  return `source:${VIDEOSY_PROVIDER_ID}:${endpoint}`;
}

/** @deprecated Use videasySourceIdForEndpoint */
export const vidkingSourceIdForEndpoint = videasySourceIdForEndpoint;

function endpointHasMultipleFlavors(endpoint: string): boolean {
  return FLAVORS.filter((flavor) => flavor.endpoint === endpoint).length > 1;
}

/** Stable inventory id for a named flavor. Shared backends keep separate user-visible rows. */
export function vidkingSourceIdForFlavor(flavorId: string): string {
  const flavor = getVidkingFlavor(flavorId);
  if (!flavor) return `source:${VIDEOSY_PROVIDER_ID}:${flavorId}`;
  return endpointHasMultipleFlavors(flavor.endpoint)
    ? `source:${VIDEOSY_PROVIDER_ID}:${flavor.id}`
    : videasySourceIdForEndpoint(flavor.endpoint);
}

export function getVidkingFlavorForEndpoint(
  endpoint: string,
  hints: {
    readonly languageQuery?: string;
    readonly filterQuality?: string;
  } = {},
): VidkingFlavorDefinition | undefined {
  const matches = FLAVORS.filter((flavor) => flavor.endpoint === endpoint);
  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches[0];
  if (hints.languageQuery) {
    const byLanguage = matches.find((flavor) => flavor.languageQuery === hints.languageQuery);
    if (byLanguage) return byLanguage;
  }
  if (hints.filterQuality) {
    const byQuality = matches.find((flavor) => flavor.filterQuality === hints.filterQuality);
    if (byQuality) return byQuality;
  }
  return matches[0];
}

/** Map endpoint (+ optional engine hints) to themed labels used in UI and inventory. */
export function resolveVidkingPresentation(
  endpoint: string,
  engineOptions: Pick<
    VidKingEngineOptions,
    "flavorId" | "flavorLabel" | "flavorArchetype" | "language" | "filterQuality"
  > = {},
): VidkingFlavorPresentation {
  if (engineOptions.flavorId) {
    const byId = getVidkingFlavor(engineOptions.flavorId);
    if (byId) {
      return {
        flavorId: byId.id,
        themeLabel: byId.themeLabel,
        subtitle: byId.subtitle,
        endpoint: byId.endpoint,
      };
    }
  }

  const flavor = getVidkingFlavorForEndpoint(endpoint, {
    languageQuery: engineOptions.language,
    filterQuality: engineOptions.filterQuality,
  });
  if (flavor) {
    return {
      flavorId: flavor.id,
      themeLabel: flavor.themeLabel,
      subtitle: flavor.subtitle,
      endpoint: flavor.endpoint,
    };
  }

  return {
    themeLabel: engineOptions.flavorLabel?.trim() || endpoint,
    subtitle: engineOptions.flavorArchetype?.trim() || endpoint,
    endpoint,
  };
}

export function vidkingSourceIdForPresentation(
  endpoint: string,
  engineOptions: Pick<
    VidKingEngineOptions,
    "flavorId" | "flavorLabel" | "flavorArchetype" | "language" | "filterQuality"
  > = {},
): string {
  const presentation = resolveVidkingPresentation(endpoint, engineOptions);
  return presentation.flavorId
    ? vidkingSourceIdForFlavor(presentation.flavorId)
    : vidkingSourceIdForEndpoint(endpoint);
}

export function vidkingEngineOptionsForEndpoint(
  endpoint: string,
  base: VidKingEngineOptions = {},
): VidKingEngineOptions {
  const presentation = resolveVidkingPresentation(endpoint, base);
  const flavorDef = presentation.flavorId ? getVidkingFlavor(presentation.flavorId) : undefined;
  return {
    ...base,
    flavorId: presentation.flavorId ?? base.flavorId,
    serverEndpoint: presentation.endpoint,
    language: base.language ?? flavorDef?.languageQuery,
    filterQuality: base.filterQuality ?? flavorDef?.filterQuality,
    flavorLabel: presentation.themeLabel,
    flavorArchetype: presentation.subtitle,
  };
}

export function listVidkingFlavors(): readonly VidkingFlavorDefinition[] {
  return FLAVORS;
}

export function isVidkingFlavorDeprecated(flavorId: string): boolean {
  return getVidkingFlavor(flavorId)?.deprecated === true;
}

export function isVidkingSourceDeprecated(sourceId: string): boolean {
  const normalized = sourceId.trim();
  if (!normalized) return false;
  for (const flavor of FLAVORS) {
    if (flavor.deprecated !== true) continue;
    if (
      flavorSourceId(flavor.id) === normalized ||
      vidkingSourceIdForEndpoint(flavor.endpoint) === normalized
    ) {
      return true;
    }
  }
  return false;
}

export function listEligibleVidkingFlavorIds(
  mediaKind?: "movie" | "series",
): readonly VidkingFlavorId[] {
  return FLAVORS.filter((flavor) => mediaKind !== "series" || flavor.moviesOnly !== true).map(
    (flavor) => flavor.id,
  );
}

export function getVidkingFlavor(flavorId: string): VidkingFlavorDefinition | undefined {
  return FLAVOR_BY_ID.get(flavorId as VidkingFlavorId);
}

export function getPhaseAVidkingFlavorIds(): readonly VidkingFlavorId[] {
  return FLAVORS.filter((flavor) => flavor.phaseAOrder !== undefined)
    .sort((a, b) => (a.phaseAOrder ?? 0) - (b.phaseAOrder ?? 0))
    .map((flavor) => flavor.id);
}

export function getPhaseAVidkingServers(): readonly string[] {
  return getPhaseAVidkingFlavorIds()
    .map((id) => getVidkingFlavor(id)?.endpoint)
    .filter((endpoint): endpoint is string => Boolean(endpoint));
}

export function resolveFlavorEngineOptions(flavorId: string): VidKingEngineOptions | null {
  const flavor = getVidkingFlavor(flavorId);
  if (!flavor) return null;
  return {
    flavorId: flavor.id,
    serverEndpoint: flavor.endpoint,
    language: flavor.languageQuery,
    filterQuality: flavor.filterQuality,
    flavorLabel: flavor.themeLabel,
    flavorArchetype: flavor.subtitle,
  };
}

export function listPhaseBLazyProbeFlavorIds(mediaKind?: "movie" | "series"): VidkingFlavorId[] {
  return FLAVORS.filter((flavor) => {
    if (flavor.phaseAOrder !== undefined) return false;
    if (flavor.deprecated === true) return false;
    if (mediaKind === "series" && flavor.moviesOnly) return false;
    return true;
  }).map((flavor) => flavor.id);
}

export function flavorSourceId(flavorId: string): string {
  return vidkingSourceIdForFlavor(flavorId);
}

function mapLegacyVideasySourceSuffix(suffix: string): string {
  const flavor = getVidkingFlavor(suffix);
  if (flavor && endpointHasMultipleFlavors(flavor.endpoint)) {
    return `source:${VIDEOSY_PROVIDER_ID}:${flavor.id}`;
  }
  return `source:${VIDEOSY_PROVIDER_ID}:${suffix}`;
}

/** Map pre-rename inventory ids (`source:vidking:…`) to current Videasy ids. */
export function normalizeLegacyVideasySourceId(sourceId: string): string {
  if (sourceId.startsWith("source:vidking:videasy:")) {
    return mapLegacyVideasySourceSuffix(sourceId.slice("source:vidking:videasy:".length));
  }
  if (sourceId.startsWith("source:vidking:")) {
    return mapLegacyVideasySourceSuffix(sourceId.slice("source:vidking:".length));
  }
  return sourceId;
}
