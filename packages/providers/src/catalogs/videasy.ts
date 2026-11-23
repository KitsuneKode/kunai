import type { KnownCatalogEntry } from "../shared/known-catalog";
import { flavorSourceId, listVidkingFlavors, resolveFlavorEngineOptions } from "../videasy/flavors";

/** "en" → "English", "de" → "German"; falls back to the raw code uppercased. */
function languageDisplayName(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const base = code.toLowerCase().split("-")[0] ?? code.toLowerCase();
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(base) ?? base.toUpperCase();
  } catch {
    return base.toUpperCase();
  }
}

/**
 * Normalize the per-flavor audio hint into one consistent vocabulary for the
 * picker: English sources read "Original audio"; non-English read
 * "Original · <Language>". Drops the ad-hoc "may have 4K" / "Kunai-only" notes
 * that lived in the raw flavor `subtitle` field so the UI hint stays uniform.
 */
function normalizeVideasyAudioHint(audioLanguage: string | undefined): string {
  if (!audioLanguage || audioLanguage.toLowerCase().startsWith("en")) {
    return "Original audio";
  }
  const name = languageDisplayName(audioLanguage);
  return name ? `Original · ${name}` : "Original audio";
}

export function getVideasyKnownCatalog(mediaKind?: string): readonly KnownCatalogEntry[] {
  return listVidkingFlavors()
    .filter((flavor) => mediaKind !== "series" || !flavor.moviesOnly)
    .map((flavor) => {
      const engineOptions = resolveFlavorEngineOptions(flavor.id);
      return {
        sourceId: flavorSourceId(flavor.id),
        label: flavor.themeLabel,
        subtitle: normalizeVideasyAudioHint(flavor.audioLanguage),
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
