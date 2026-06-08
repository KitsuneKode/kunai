import type { MiruroAudioCategory } from "../miruro/direct";
import { MIRURO_PROVIDER_ID } from "../miruro/manifest";
import type { KnownCatalogEntry } from "../shared/known-catalog";

const MIRURO_GINTAMA_LABELS: Record<string, { readonly sub: string; readonly dub: string }> = {
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

export function getMiruroKnownCatalog(
  audioCategories: readonly MiruroAudioCategory[] = ["sub", "dub"],
): readonly KnownCatalogEntry[] {
  const entries: KnownCatalogEntry[] = [];
  for (const serverId of DEFAULT_SERVERS) {
    const labels = MIRURO_GINTAMA_LABELS[serverId] ?? {
      sub: serverId,
      dub: serverId,
    };
    for (const audioCategory of audioCategories) {
      const themeLabel = audioCategory === "dub" ? labels.dub : labels.sub;
      entries.push({
        sourceId: miruroInventorySourceId(serverId, audioCategory),
        label: themeLabel,
        subtitle: `${audioCategory === "dub" ? "Dub" : "Sub"} · ${serverId}`,
        audioLanguage: audioCategory === "dub" ? "en" : "ja",
        host: "www.miruro.tv",
        metadata: {
          server: serverId,
          audioCategory,
          flavorLabel: themeLabel,
          flavorArchetype: `${audioCategory === "dub" ? "Dub" : "Sub"} · Miruro`,
        },
      });
    }
  }
  return entries;
}
