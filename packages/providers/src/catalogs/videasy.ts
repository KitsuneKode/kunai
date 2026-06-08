import type { KnownCatalogEntry } from "../shared/known-catalog";
import { flavorSourceId, listVidkingFlavors, resolveFlavorEngineOptions } from "../videasy/flavors";

export function getVideasyKnownCatalog(mediaKind?: string): readonly KnownCatalogEntry[] {
  return listVidkingFlavors()
    .filter((flavor) => mediaKind !== "series" || !flavor.moviesOnly)
    .map((flavor) => {
      const engineOptions = resolveFlavorEngineOptions(flavor.id);
      return {
        sourceId: flavorSourceId(flavor.id),
        label: flavor.themeLabel,
        subtitle: flavor.subtitle,
        audioLanguage: flavor.audioLanguage,
        host: "api.videasy.to",
        kind: "provider-api" as const,
        confidence: 0.4,
        moviesOnly: flavor.moviesOnly,
        metadata: {
          server: flavor.endpoint,
          flavorId: flavor.id,
          language: engineOptions?.language,
          filterQuality: engineOptions?.filterQuality,
        },
      };
    });
}

/** @deprecated Use getVideasyKnownCatalog */
export const getVidkingKnownCatalog = getVideasyKnownCatalog;
