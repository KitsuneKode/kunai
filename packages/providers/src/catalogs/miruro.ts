import type { MiruroAudioCategory } from "../miruro/direct";
import { MIRURO_PROVIDER_ID } from "../miruro/manifest";
import {
  formatAnimeSourceArchetype,
  formatAnimeSourceLabel,
} from "../shared/anime-source-presentation";
import type { KnownCatalogEntry } from "../shared/known-catalog";
import { normalizeProviderDisplayLabel } from "../shared/source-inventory";

/** Optional character themes (Gintama) used as flavorArchetype detail only. */
const MIRURO_THEME_DETAIL: Record<string, { readonly sub: string; readonly dub: string }> = {
  kiwi: { sub: "Gintoki", dub: "Kagura" },
  bee: { sub: "Shinpachi", dub: "Okita" },
  hop: { sub: "Hijikata", dub: "Hijikata" },
  ally: { sub: "Elizabeth", dub: "Katsura" },
  pewe: { sub: "Pewe", dub: "Pewe" },
  moo: { sub: "Moo", dub: "Moo" },
  bonk: { sub: "Bonk", dub: "Bonk" },
  ZORO: { sub: "Mutsu", dub: "Mutsu" },
};

const DEFAULT_SERVERS = ["kiwi", "bee", "hop", "ally", "pewe", "moo", "bonk"] as const;

export function miruroInventorySourceId(
  serverId: string,
  audioCategory: MiruroAudioCategory,
): string {
  return `source:${MIRURO_PROVIDER_ID}:pipe:${serverId}:${audioCategory}`;
}

/**
 * Catalog rows only enumerate audio categories the title actually exposes, so the
 * picker never shows phantom sub/dub rows for a category the source can't serve.
 * `subtitleMode` mirrors the resolve-time default (sub → hard sub; dub → unknown
 * until the sources pipe returns soft/hard evidence) so placeholder wording matches
 * what a real resolve would surface.
 */
export function getMiruroKnownCatalog(
  audioCategories: readonly MiruroAudioCategory[] = ["sub", "dub"],
): readonly KnownCatalogEntry[] {
  const enabled = new Set(audioCategories);
  const allCategories: readonly MiruroAudioCategory[] = ["sub", "dub"];
  const categories = allCategories.filter((category) => enabled.has(category));
  const entries: KnownCatalogEntry[] = [];
  for (const serverId of DEFAULT_SERVERS) {
    const serverLabel =
      normalizeProviderDisplayLabel(serverId) ??
      serverId.charAt(0).toUpperCase() + serverId.slice(1).toLowerCase();
    const themes = MIRURO_THEME_DETAIL[serverId];
    for (const audioCategory of categories) {
      const themeDetail = audioCategory === "dub" ? themes?.dub : themes?.sub;
      const subtitleMode: "hard" | "unknown" = audioCategory === "sub" ? "hard" : "unknown";
      const flavorArchetype = formatAnimeSourceArchetype({
        audio: audioCategory,
        detail: themeDetail ?? serverLabel,
      });
      entries.push({
        sourceId: miruroInventorySourceId(serverId, audioCategory),
        label: formatAnimeSourceLabel({
          audio: audioCategory,
          serverLabel,
          subtitleMode,
        }),
        subtitle: flavorArchetype,
        audioLanguage: audioCategory === "dub" ? "en" : "ja",
        host: "www.miruro.bz",
        metadata: {
          server: serverId,
          audioCategory,
          flavorLabel: formatAnimeSourceLabel({
            audio: audioCategory,
            serverLabel,
            subtitleMode,
          }),
          flavorArchetype,
        },
      });
    }
  }
  return entries;
}
