import { ALLANIME_PROVIDER_ID } from "../allmanga/manifest";
import type { KnownCatalogEntry } from "../shared/known-catalog";

const ALLMANGA_SOURCE_THEMES: Record<
  string,
  { readonly label: string; readonly subtitle: string }
> = {
  default: { label: "Bocchi", subtitle: "Sub · primary" },
  "yt-mp4": { label: "Kita", subtitle: "Sub · alternate" },
  "s-mp4": { label: "Ryo", subtitle: "Sub · alternate" },
  "fm-mp4": { label: "Kikuri", subtitle: "Filemoon lane" },
  ak: { label: "Hitori", subtitle: "Ak · fallback lane" },
};

const KNOWN_SOURCE_KEYS = ["default", "yt-mp4", "s-mp4", "fm-mp4", "ak"] as const;

export function getAllmangaKnownCatalog(mode: "sub" | "dub" = "sub"): readonly KnownCatalogEntry[] {
  return KNOWN_SOURCE_KEYS.map((key) => {
    const theme = ALLMANGA_SOURCE_THEMES[key] ?? { label: "Kikuri", subtitle: key };
    const sourceName =
      key === "default"
        ? "Default"
        : key === "yt-mp4"
          ? "Yt-mp4"
          : key === "s-mp4"
            ? "S-mp4"
            : key === "fm-mp4"
              ? "Fm-mp4"
              : "Ak";
    return {
      sourceId: `source:${ALLANIME_PROVIDER_ID}:${sourceName.toLowerCase()}`,
      label: mode === "dub" && key === "default" ? "Nijika" : theme.label,
      subtitle:
        mode === "dub"
          ? key === "default"
            ? "Dub · primary"
            : `${theme.subtitle} · dub`
          : theme.subtitle,
      audioLanguage: mode === "dub" ? "en" : "ja",
      host: "api.allanime.day",
      metadata: {
        sourceFamily: sourceName.toLowerCase(),
        translationType: mode,
      },
    };
  });
}
