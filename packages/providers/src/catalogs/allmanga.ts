import { ALLANIME_PROVIDER_ID } from "../allmanga/manifest";
import {
  formatAnimeSourceArchetype,
  formatAnimeSourceLabel,
} from "../shared/anime-source-presentation";
import type { KnownCatalogEntry } from "../shared/known-catalog";
import { normalizeProviderDisplayLabel } from "../shared/source-inventory";

/** Optional character themes (Bocchi) used as flavorArchetype detail only. */
const ALLMANGA_THEME_DETAIL: Record<
  string,
  { readonly label: string; readonly dubLabel?: string }
> = {
  default: { label: "Bocchi", dubLabel: "Nijika" },
  "yt-mp4": { label: "Kita" },
  "s-mp4": { label: "Ryo" },
  "fm-mp4": { label: "Kikuri" },
  // Runtime may also emit fm-hls / vid-mp4 heuristics — keep aliases in catalog.
  "fm-hls": { label: "Kikuri" },
  "vid-mp4": { label: "Nijika" },
  ak: { label: "Hitori" },
};

const KNOWN_SOURCE_KEYS = [
  "default",
  "yt-mp4",
  "s-mp4",
  "fm-mp4",
  "fm-hls",
  "vid-mp4",
  "ak",
] as const;

export function getAllmangaKnownCatalog(mode: "sub" | "dub" = "sub"): readonly KnownCatalogEntry[] {
  return KNOWN_SOURCE_KEYS.map((key) => {
    const theme = ALLMANGA_THEME_DETAIL[key] ?? { label: key };
    const serverLabel = normalizeProviderDisplayLabel(key) ?? key;
    const themeDetail = mode === "dub" && theme.dubLabel ? theme.dubLabel : theme.label;
    // Catalog defaults: sub rows are usually hard-sub; dub rows soft when exteriors appear later.
    const subtitleMode = mode === "sub" ? ("hard" as const) : ("unknown" as const);
    return {
      sourceId: `source:${ALLANIME_PROVIDER_ID}:${key}`,
      // Align with resolve-time labels: Sub/Dub · family · subtitle mode.
      label: formatAnimeSourceLabel({
        audio: mode,
        serverLabel,
        subtitleMode,
      }),
      subtitle: formatAnimeSourceArchetype({ audio: mode, detail: themeDetail }),
      audioLanguage: mode === "dub" ? "en" : "ja",
      host: "api.allanime.day",
      metadata: {
        sourceFamily: key,
        translationType: mode,
        audioCategory: mode,
        server: serverLabel,
        flavorLabel: formatAnimeSourceLabel({
          audio: mode,
          serverLabel,
          subtitleMode,
        }),
        flavorArchetype: formatAnimeSourceArchetype({ audio: mode, detail: themeDetail }),
      },
    };
  });
}
