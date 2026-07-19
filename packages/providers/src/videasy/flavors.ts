import type { VidKingEngineOptions } from "./direct";
import { VIDEOSY_PROVIDER_ID } from "./manifest";

export type VidkingFlavorPresentation = {
  readonly flavorId?: VidkingFlavorId;
  readonly themeLabel: string;
  readonly subtitle: string;
  readonly endpoint: string;
};

/**
 * Flavor ids. Active cineby.at catalog names are first-class.
 * Legacy One Piece / Hydrogen names remain as deprecated ids for pin migration.
 */
export type VidkingFlavorId =
  /* Active Cineby UI catalog (player.videasy.to C[] order, 2026-07) */
  | "cineby-yoru"
  | "cineby-neon"
  | "cineby-sage"
  | "cineby-jett"
  | "cineby-breach"
  | "cineby-vyse"
  | "cineby-killjoy"
  | "cineby-fade"
  | "cineby-omen"
  | "cineby-raze"
  /* Kunai reliability extra — works on speedracelight, not listed in Cineby UI */
  | "cineby-cypher"
  /* Legacy Videasy flavors (api.videasy.to — route-dead) */
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
  | "videasy-portuguese"
  /* Previous wings-* internal names (deprecated; normalizeLegacy maps pins) */
  | "wingsdb-hydrogen"
  | "wingsdb-titanium"
  | "wingsdb-oxygen"
  | "wingsdb-lithium"
  | "wingsdb-helium"
  | "wingsdb-brook"
  | "wingsdb-shanks"
  | "wingsdb-law"
  | "wingsdb-ace";

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
  /**
   * Resolve probe order. English/primary servers follow catalogOrder with Yoru
   * first; Cypher stays early as a Kunai direct-mp4 escape hatch (after Yoru).
   */
  readonly phaseAOrder?: number;
  /**
   * Inventory / picker display order — matches cineby.at Servers UI.
   * When omitted, falls back to phaseAOrder.
   */
  readonly catalogOrder?: number;
  /** Skip probes / preferred-source resolve. */
  readonly deprecated?: boolean;
};

/**
 * Cineby catalog:
 *   UI (catalogOrder): Yoru → Neon → Sage → Jett → Breach → Vyse → Killjoy → Fade → Omen → Raze
 *   Resolve (phaseAOrder): Yoru → Cypher → Neon → Sage → Jett → Breach → Vyse
 * Localized Killjoy/Fade/Omen/Raze stay Phase B / lazy.
 * Cypher is Kunai-only (explicit quality ladder; not on the website).
 */
const FLAVORS: readonly VidkingFlavorDefinition[] = [
  /* ── Active Cineby catalog (api.speedracelight.com / api.wingsdatabase.com) ── */
  {
    id: "cineby-yoru",
    themeLabel: "Yoru",
    subtitle: "Original audio · may have 4K",
    cinebyAlias: "Yoru",
    endpoint: "wings-cdn",
    audioLanguage: "en",
    catalogOrder: 0,
    phaseAOrder: 0,
  },
  {
    id: "cineby-neon",
    themeLabel: "Neon",
    subtitle: "Original audio · HLS/DASH",
    cinebyAlias: "Neon",
    endpoint: "wings-neon2",
    audioLanguage: "en",
    catalogOrder: 1,
    phaseAOrder: 2,
  },
  {
    id: "cineby-sage",
    themeLabel: "Sage",
    subtitle: "Original audio",
    cinebyAlias: "Sage",
    endpoint: "wings-ym",
    audioLanguage: "en",
    catalogOrder: 2,
    phaseAOrder: 3,
  },
  {
    id: "cineby-jett",
    themeLabel: "Jett",
    subtitle: "Original audio",
    cinebyAlias: "Jett",
    endpoint: "wings-jett",
    audioLanguage: "en",
    catalogOrder: 3,
    phaseAOrder: 4,
  },
  {
    id: "cineby-breach",
    themeLabel: "Breach",
    subtitle: "Original audio",
    cinebyAlias: "Breach",
    endpoint: "wings-m4uhd",
    audioLanguage: "en",
    catalogOrder: 4,
    phaseAOrder: 5,
  },
  {
    id: "cineby-vyse",
    themeLabel: "Vyse",
    subtitle: "Original audio",
    cinebyAlias: "Vyse",
    endpoint: "wings-hdmovie",
    filterQuality: "English",
    audioLanguage: "en",
    catalogOrder: 5,
    phaseAOrder: 6,
  },
  {
    id: "cineby-killjoy",
    themeLabel: "Killjoy",
    subtitle: "German audio",
    cinebyAlias: "Killjoy",
    endpoint: "wings-meine",
    languageQuery: "german",
    audioLanguage: "de",
    catalogOrder: 6,
  },
  {
    id: "cineby-fade",
    themeLabel: "Fade",
    subtitle: "Hindi audio",
    cinebyAlias: "Fade",
    endpoint: "wings-hdmovie",
    filterQuality: "Hindi",
    audioLanguage: "hi",
    catalogOrder: 7,
  },
  {
    id: "cineby-omen",
    themeLabel: "Omen",
    subtitle: "Spanish audio",
    cinebyAlias: "Omen",
    endpoint: "wings-lamovie",
    audioLanguage: "es",
    catalogOrder: 8,
  },
  {
    id: "cineby-raze",
    themeLabel: "Raze",
    subtitle: "Portuguese audio",
    cinebyAlias: "Raze",
    endpoint: "wings-superflix",
    audioLanguage: "pt",
    catalogOrder: 9,
  },
  {
    id: "cineby-cypher",
    themeLabel: "Cypher",
    subtitle: "Quality ladder · Kunai-only (not on cineby UI)",
    cinebyAlias: "Cypher",
    endpoint: "wings-downloader2",
    audioLanguage: "en",
    catalogOrder: 10,
    phaseAOrder: 1,
  },

  /* ── Legacy api.videasy.to flavors (route-dead 404) ── */
  {
    id: "videasy-primary",
    themeLabel: "Luffy",
    subtitle: "Legacy · route-dead",
    cinebyAlias: "Neon",
    endpoint: "mb-flix",
    audioLanguage: "en",
    deprecated: true,
  },
  {
    id: "videasy-mirror-a",
    themeLabel: "Zoro",
    subtitle: "Legacy · route-dead",
    cinebyAlias: "Yoru",
    endpoint: "cdn",
    audioLanguage: "en",
    deprecated: true,
  },
  {
    id: "videasy-mirror-b",
    themeLabel: "Nami",
    subtitle: "Legacy · route-dead",
    cinebyAlias: "Cypher",
    endpoint: "downloader2",
    audioLanguage: "en",
    deprecated: true,
  },
  {
    id: "videasy-mirror-c",
    themeLabel: "Sanji",
    subtitle: "Legacy · route-dead",
    cinebyAlias: "Sage",
    endpoint: "1movies",
    audioLanguage: "en",
    deprecated: true,
  },
  {
    id: "videasy-breach",
    themeLabel: "Blackbeard",
    subtitle: "Legacy · route-dead",
    cinebyAlias: "Breach",
    endpoint: "m4uhd",
    audioLanguage: "en",
    deprecated: true,
  },
  {
    id: "videasy-english-alt",
    themeLabel: "Robin",
    subtitle: "Legacy · route-dead",
    cinebyAlias: "Vyse",
    endpoint: "hdmovie",
    filterQuality: "English",
    audioLanguage: "en",
    deprecated: true,
  },
  {
    id: "videasy-german",
    themeLabel: "Brook (Legacy)",
    subtitle: "Legacy · route-dead",
    cinebyAlias: "Killjoy",
    endpoint: "meine",
    languageQuery: "german",
    audioLanguage: "de",
    deprecated: true,
  },
  {
    id: "videasy-hindi",
    themeLabel: "Chopper",
    subtitle: "Legacy · route-dead",
    cinebyAlias: "Fade",
    endpoint: "hdmovie",
    filterQuality: "Hindi",
    audioLanguage: "hi",
    deprecated: true,
  },
  {
    id: "videasy-spanish",
    themeLabel: "Ace (Legacy)",
    subtitle: "Legacy · route-dead",
    cinebyAlias: "Omen",
    endpoint: "lamovie",
    audioLanguage: "es",
    deprecated: true,
  },
  {
    id: "videasy-portuguese",
    themeLabel: "Sabo",
    subtitle: "Legacy · route-dead",
    cinebyAlias: "Raze",
    endpoint: "superflix",
    audioLanguage: "pt",
    deprecated: true,
  },
  {
    id: "videasy-italian",
    themeLabel: "Shanks (Legacy)",
    subtitle: "Legacy · route-dead",
    cinebyAlias: "Harbor",
    endpoint: "meine",
    languageQuery: "italian",
    audioLanguage: "it",
    deprecated: true,
  },
  {
    id: "videasy-french",
    themeLabel: "Law (Legacy)",
    subtitle: "Legacy · route-dead",
    cinebyAlias: "Chamber",
    endpoint: "meine",
    languageQuery: "french",
    audioLanguage: "fr",
    moviesOnly: true,
    deprecated: true,
  },

  /* ── Previous internal wings labels (deprecated aliases for pin migration) ── */
  {
    id: "wingsdb-hydrogen",
    themeLabel: "Yoru",
    subtitle: "Alias → Yoru",
    endpoint: "wings-cdn",
    audioLanguage: "en",
    deprecated: true,
  },
  {
    id: "wingsdb-oxygen",
    themeLabel: "Neon",
    subtitle: "Alias → Neon",
    endpoint: "wings-neon2",
    audioLanguage: "en",
    deprecated: true,
  },
  {
    id: "wingsdb-lithium",
    themeLabel: "Cypher",
    subtitle: "Alias → Cypher",
    endpoint: "wings-downloader2",
    audioLanguage: "en",
    deprecated: true,
  },
  {
    id: "wingsdb-titanium",
    themeLabel: "Titanium",
    subtitle: "AES-GCM tejo · not in Cineby UI",
    endpoint: "wings-tejo",
    audioLanguage: "en",
    deprecated: true,
  },
  {
    id: "wingsdb-helium",
    themeLabel: "Helium",
    subtitle: "Removed",
    endpoint: "wings-1movies",
    audioLanguage: "en",
    deprecated: true,
  },
  {
    id: "wingsdb-brook",
    themeLabel: "Killjoy",
    subtitle: "Alias → Killjoy",
    endpoint: "wings-meine",
    languageQuery: "german",
    audioLanguage: "de",
    deprecated: true,
  },
  {
    id: "wingsdb-shanks",
    themeLabel: "Shanks",
    subtitle: "Italian · not in current Cineby list",
    endpoint: "wings-meine",
    languageQuery: "italian",
    audioLanguage: "it",
    deprecated: true,
  },
  {
    id: "wingsdb-ace",
    themeLabel: "Omen",
    subtitle: "Alias → Omen",
    endpoint: "wings-lamovie",
    languageQuery: "spanish",
    audioLanguage: "es",
    deprecated: true,
  },
  {
    id: "wingsdb-law",
    themeLabel: "Law",
    subtitle: "French · movies",
    endpoint: "wings-meine",
    languageQuery: "french",
    audioLanguage: "fr",
    moviesOnly: true,
    deprecated: true,
  },
] as const;

const FLAVOR_BY_ID = new Map(FLAVORS.map((flavor) => [flavor.id, flavor]));
const ACTIVE_FLAVORS = FLAVORS.filter((flavor) => flavor.deprecated !== true)
  .slice()
  .sort(
    (left, right) =>
      (left.catalogOrder ?? left.phaseAOrder ?? Number.MAX_SAFE_INTEGER) -
      (right.catalogOrder ?? right.phaseAOrder ?? Number.MAX_SAFE_INTEGER),
  );

/** Stable inventory id for a Videasy endpoint — same on every episode. */
export function videasySourceIdForEndpoint(endpoint: string): string {
  return `source:${VIDEOSY_PROVIDER_ID}:${endpoint}`;
}

/** @deprecated Use videasySourceIdForEndpoint */
export const vidkingSourceIdForEndpoint = videasySourceIdForEndpoint;

function endpointHasMultipleFlavors(endpoint: string): boolean {
  return (
    FLAVORS.filter((flavor) => flavor.endpoint === endpoint && flavor.deprecated !== true).length >
    1
  );
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
  const matches = FLAVORS.filter(
    (flavor) => flavor.endpoint === endpoint && flavor.deprecated !== true,
  );
  if (matches.length === 0) {
    // Fall back to deprecated rows so old inventory still labels.
    const deprecated = FLAVORS.filter((flavor) => flavor.endpoint === endpoint);
    if (deprecated.length === 1) return deprecated[0];
    if (deprecated.length === 0) return undefined;
    return pickFromMatches(deprecated, hints);
  }
  if (matches.length === 1) return matches[0];
  return pickFromMatches(matches, hints);
}

function pickFromMatches(
  matches: readonly VidkingFlavorDefinition[],
  hints: {
    readonly languageQuery?: string;
    readonly filterQuality?: string;
  },
): VidkingFlavorDefinition {
  if (hints.languageQuery) {
    const byLanguage = matches.find((flavor) => flavor.languageQuery === hints.languageQuery);
    if (byLanguage) return byLanguage;
  }
  if (hints.filterQuality) {
    const byQuality = matches.find((flavor) => flavor.filterQuality === hints.filterQuality);
    if (byQuality) return byQuality;
  }
  const [firstMatch] = matches;
  if (!firstMatch) throw new Error("Expected at least one Videasy flavor match");
  return firstMatch;
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
  return ACTIVE_FLAVORS;
}

export function isVidkingFlavorDeprecated(flavorId: string): boolean {
  return getVidkingFlavor(flavorId)?.deprecated === true;
}

export function listDeprecatedVidkingEndpoints(): readonly string[] {
  const endpoints = new Set<string>();
  for (const flavor of FLAVORS) {
    if (flavor.deprecated === true) {
      endpoints.add(flavor.endpoint);
    }
  }
  // Active flavors may share an endpoint with a deprecated alias — only
  // treat as deprecated when NO active flavor uses it.
  const active = new Set(FLAVORS.filter((f) => f.deprecated !== true).map((f) => f.endpoint));
  return [...endpoints].filter((endpoint) => !active.has(endpoint));
}

/** All Videasy flavor endpoints known to the registry. */
export function listVidkingEndpoints(): readonly string[] {
  const endpoints = new Set<string>();
  for (const flavor of FLAVORS) {
    endpoints.add(flavor.endpoint);
  }
  return [...endpoints];
}

export function isVidkingSourceDeprecated(sourceId: string): boolean {
  const normalized = sourceId.trim();
  if (!normalized) return false;
  for (const flavor of FLAVORS) {
    if (flavor.deprecated !== true) continue;
    // Skip aliases whose endpoint is still active under a new id.
    if (FLAVORS.some((f) => f.deprecated !== true && f.endpoint === flavor.endpoint)) {
      continue;
    }
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
  return ACTIVE_FLAVORS.filter(
    (flavor) => mediaKind !== "series" || flavor.moviesOnly !== true,
  ).map((flavor) => flavor.id);
}

export function getVidkingFlavor(flavorId: string): VidkingFlavorDefinition | undefined {
  return FLAVOR_BY_ID.get(flavorId as VidkingFlavorId);
}

export function getPhaseAVidkingFlavorIds(): readonly VidkingFlavorId[] {
  return ACTIVE_FLAVORS.filter((flavor) => flavor.phaseAOrder !== undefined)
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
  return ACTIVE_FLAVORS.filter((flavor) => {
    if (flavor.phaseAOrder !== undefined) return false;
    if (mediaKind === "series" && flavor.moviesOnly) return false;
    return true;
  }).map((flavor) => flavor.id);
}

export function flavorSourceId(flavorId: string): string {
  return vidkingSourceIdForFlavor(flavorId);
}

/** Map old internal flavor / endpoint suffixes to the active cineby catalog id. */
const LEGACY_FLAVOR_ID_ALIASES: Readonly<Record<string, VidkingFlavorId>> = {
  "wingsdb-hydrogen": "cineby-yoru",
  "wingsdb-oxygen": "cineby-neon",
  "wingsdb-lithium": "cineby-cypher",
  "wingsdb-brook": "cineby-killjoy",
  "wingsdb-ace": "cineby-omen",
  "videasy-mirror-a": "cineby-yoru",
  "videasy-primary": "cineby-neon",
  "videasy-mirror-b": "cineby-cypher",
  "videasy-breach": "cineby-breach",
  "videasy-english-alt": "cineby-vyse",
  "videasy-german": "cineby-killjoy",
  "videasy-hindi": "cineby-fade",
  "videasy-spanish": "cineby-omen",
  "videasy-portuguese": "cineby-raze",
  // Bare endpoint suffixes from older inventory rows
  "mb-flix": "cineby-neon",
  cdn: "cineby-yoru",
  downloader2: "cineby-cypher",
  m4uhd: "cineby-breach",
  meine: "cineby-killjoy",
  lamovie: "cineby-omen",
  superflix: "cineby-raze",
};

function mapLegacyVideasySourceSuffix(suffix: string): string {
  const aliased = LEGACY_FLAVOR_ID_ALIASES[suffix];
  if (aliased) {
    return vidkingSourceIdForFlavor(aliased);
  }
  const flavor = getVidkingFlavor(suffix);
  if (flavor && endpointHasMultipleFlavors(flavor.endpoint)) {
    return `source:${VIDEOSY_PROVIDER_ID}:${flavor.id}`;
  }
  return `source:${VIDEOSY_PROVIDER_ID}:${suffix}`;
}

/** Map pre-rename inventory ids (`source:vidking:…`, wingsdb-*) to current Videasy ids. */
export function normalizeLegacyVideasySourceId(sourceId: string): string {
  if (sourceId.startsWith("source:vidking:videasy:")) {
    return mapLegacyVideasySourceSuffix(sourceId.slice("source:vidking:videasy:".length));
  }
  if (sourceId.startsWith("source:vidking:")) {
    return mapLegacyVideasySourceSuffix(sourceId.slice("source:vidking:".length));
  }
  if (sourceId.startsWith("source:videasy:")) {
    const suffix = sourceId.slice("source:videasy:".length);
    const aliased = LEGACY_FLAVOR_ID_ALIASES[suffix];
    if (aliased) return vidkingSourceIdForFlavor(aliased);
  }
  return sourceId;
}
