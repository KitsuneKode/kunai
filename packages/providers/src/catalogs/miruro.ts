import type { MiruroAudioCategory } from "../miruro/direct";
import { MIRURO_PROVIDER_ID } from "../miruro/manifest";
import {
  formatAnimeSourceArchetype,
  formatAnimeSourceDetail,
  miruroSubtitleDeliveryToMode,
  polishAnimeServerLabel,
} from "../shared/anime-source-presentation";
import type { KnownCatalogEntry } from "../shared/known-catalog";
import { normalizeProviderDisplayLabel } from "../shared/source-inventory";

/**
 * Gintama character themes — primary Tracks/source labels.
 * Never surface raw `kiwi`/`bee` as the picker title.
 */
export const MIRURO_THEME_DETAIL: Record<string, { readonly sub: string; readonly dub: string }> = {
  kiwi: { sub: "Gintoki", dub: "Kagura" },
  bee: { sub: "Shinpachi", dub: "Okita" },
  hop: { sub: "Hijikata", dub: "Hijikata" },
  ally: { sub: "Elizabeth", dub: "Katsura" },
  pewe: { sub: "Soyo", dub: "Soyo" },
  moo: { sub: "Kyubei", dub: "Kyubei" },
  bonk: { sub: "Sacchan", dub: "Sacchan" },
  // Live keys observed in pipe payloads — keep Mutsu for ZORO (One Piece conflict).
  ZORO: { sub: "Mutsu", dub: "Mutsu" },
  zoro: { sub: "Mutsu", dub: "Mutsu" },
  ANIMEKAI: { sub: "Takasugi", dub: "Takasugi" },
  animekai: { sub: "Takasugi", dub: "Takasugi" },
  ANIMEZ: { sub: "Kamui", dub: "Kamui" },
  animez: { sub: "Kamui", dub: "Kamui" },
  dune: { sub: "Katsura", dub: "Katsura" },
};

/** Servers shown as known-catalog placeholders (merge with live discovery). */
export const MIRURO_DEFAULT_SERVERS = [
  "kiwi",
  "bee",
  "hop",
  "ally",
  "pewe",
  "moo",
  "bonk",
  "dune",
  "ANIMEKAI",
  "ANIMEZ",
  "ZORO",
] as const;

/** Short technical token for diagnostics / favorites (`Kiwi`, not `kiwi`). */
export function miruroTechnicalServerLabel(serverId: string): string {
  const known: Record<string, string> = {
    kiwi: "Kiwi",
    bee: "Bee",
    hop: "Hop",
    ally: "Ally",
    pewe: "Pewe",
    moo: "Moo",
    bonk: "Bonk",
    dune: "Dune",
    ANIMEKAI: "AnimeKai",
    animekai: "AnimeKai",
    ANIMEZ: "AnimeZ",
    animez: "AnimeZ",
    ZORO: "Zoro",
    zoro: "Zoro",
  };
  const mapped = known[serverId];
  if (mapped) return mapped;
  return (
    normalizeProviderDisplayLabel(serverId) ??
    polishAnimeServerLabel(serverId.replace(/[_-]+/g, " "))
  );
}

/** Character-primary label for a Miruro server + audio lane. */
export function miruroCharacterLabel(serverId: string, audioCategory: MiruroAudioCategory): string {
  const themes = MIRURO_THEME_DETAIL[serverId] ?? MIRURO_THEME_DETAIL[serverId.toLowerCase()];
  const character = audioCategory === "dub" ? themes?.dub : themes?.sub;
  if (character?.trim()) return character.trim();
  // Unknown keys: title-case, never bare lowercase server id.
  return miruroTechnicalServerLabel(serverId);
}

export function miruroInventorySourceId(
  serverId: string,
  audioCategory: MiruroAudioCategory,
): string {
  return `source:${MIRURO_PROVIDER_ID}:pipe:${serverId}:${audioCategory}`;
}

/**
 * Catalog rows only enumerate audio categories the title actually exposes, so the
 * picker never shows phantom sub/dub rows for a category the source can't serve.
 * Hybrid labels: character primary, `Sub · hard sub` as subtitle/detail.
 */
export function getMiruroKnownCatalog(
  audioCategories: readonly MiruroAudioCategory[] = ["sub", "dub"],
): readonly KnownCatalogEntry[] {
  const enabled = new Set(audioCategories);
  const allCategories: readonly MiruroAudioCategory[] = ["sub", "dub"];
  const categories = allCategories.filter((category) => enabled.has(category));
  const entries: KnownCatalogEntry[] = [];
  for (const serverId of MIRURO_DEFAULT_SERVERS) {
    const technicalLabel = miruroTechnicalServerLabel(serverId);
    for (const audioCategory of categories) {
      const character = miruroCharacterLabel(serverId, audioCategory);
      const sourceDetail = formatAnimeSourceDetail({
        audio: audioCategory,
        subtitleMode: miruroSubtitleDeliveryToMode(
          audioCategory === "sub" ? "hardcoded" : "unknown",
        ),
      });
      const flavorArchetype = formatAnimeSourceArchetype({
        audio: audioCategory,
        detail: character,
      });
      entries.push({
        sourceId: miruroInventorySourceId(serverId, audioCategory),
        label: character,
        subtitle: sourceDetail,
        audioLanguage: audioCategory === "dub" ? "en" : "ja",
        host: "www.miruro.bz",
        metadata: {
          server: serverId,
          audioCategory,
          nativeLabel: technicalLabel,
          sourceDetail,
          flavorLabel: character,
          flavorArchetype,
        },
      });
    }
  }
  return entries;
}
