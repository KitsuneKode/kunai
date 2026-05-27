import type { VidKingEngineOptions } from "./direct";
import { VIDKING_PROVIDER_ID } from "./manifest";

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
};

const FLAVORS: readonly VidkingFlavorDefinition[] = [
  {
    id: "videasy-primary",
    themeLabel: "Luffy",
    subtitle: "English · primary",
    cinebyAlias: "Neon",
    endpoint: "mb-flix",
    audioLanguage: "en",
    phaseAOrder: 0,
  },
  {
    id: "videasy-mirror-a",
    themeLabel: "Zoro",
    subtitle: "English · mirror",
    cinebyAlias: "Yoru",
    endpoint: "cdn",
    audioLanguage: "en",
    phaseAOrder: 1,
  },
  {
    id: "videasy-mirror-b",
    themeLabel: "Nami",
    subtitle: "English · mirror",
    cinebyAlias: "Cypher",
    endpoint: "downloader2",
    audioLanguage: "en",
    phaseAOrder: 2,
  },
  {
    id: "videasy-mirror-c",
    themeLabel: "Sanji",
    subtitle: "English · mirror",
    cinebyAlias: "Sage",
    endpoint: "1movies",
    audioLanguage: "en",
  },
  {
    id: "videasy-english-alt",
    themeLabel: "Robin",
    subtitle: "English · alt track",
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
] as const;

const FLAVOR_BY_ID = new Map(FLAVORS.map((flavor) => [flavor.id, flavor]));

/** Stable inventory id for a Videasy endpoint — same on every episode. */
export function vidkingSourceIdForEndpoint(endpoint: string): string {
  return `source:${VIDKING_PROVIDER_ID}:videasy:${endpoint}`;
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

export function listPhaseBLazyProbeFlavorIds(preferredAudioLanguage?: string): VidkingFlavorId[] {
  const normalized = preferredAudioLanguage?.trim().toLowerCase();
  const ids = new Set<VidkingFlavorId>();
  for (const flavor of FLAVORS) {
    if (flavor.phaseAOrder !== undefined) continue;
    if (flavor.audioLanguage === "en") {
      ids.add(flavor.id);
      continue;
    }
    if (normalized && flavor.audioLanguage === normalized) {
      ids.add(flavor.id);
    }
  }
  return [...ids];
}

export function flavorSourceId(flavorId: string): string {
  const flavor = getVidkingFlavor(flavorId);
  return flavor ? vidkingSourceIdForEndpoint(flavor.endpoint) : `source:${flavorId}`;
}
