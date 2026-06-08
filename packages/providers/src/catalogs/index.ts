import { ALLANIME_PROVIDER_ID } from "../allmanga/manifest";
import { MIRURO_PROVIDER_ID } from "../miruro/manifest";
import { RIVESTREAM_PROVIDER_ID } from "../rivestream/manifest";
import type { KnownCatalogEntry } from "../shared/known-catalog";
import { migrateLegacyProviderId } from "../videasy/legacy-migration";
import { VIDEOSY_PROVIDER_ID } from "../videasy/manifest";
import { VIDLINK_PROVIDER_ID } from "../vidlink/manifest";
import { getAllmangaKnownCatalog } from "./allmanga";
import { getMiruroKnownCatalog } from "./miruro";
import { getRivestreamKnownCatalog, RIVESTREAM_FALLBACK_SERVICES } from "./rivestream";
import { getVideasyKnownCatalog } from "./videasy";
import { getVidlinkKnownCatalog } from "./vidlink";

export * from "./allmanga";
export * from "./miruro";
export * from "./rivestream";
export * from "./videasy";
export * from "./vidlink";

export type KnownCatalogContext = {
  readonly mediaKind?: string;
  readonly audioMode?: "sub" | "dub";
  readonly rivestreamServices?: readonly string[];
};

export function getKnownCatalogForProvider(
  providerId: string,
  context: KnownCatalogContext = {},
): readonly KnownCatalogEntry[] {
  switch (migrateLegacyProviderId(providerId)) {
    case VIDEOSY_PROVIDER_ID:
      return getVideasyKnownCatalog(context.mediaKind);
    case MIRURO_PROVIDER_ID:
      return getMiruroKnownCatalog();
    case ALLANIME_PROVIDER_ID:
      return getAllmangaKnownCatalog(context.audioMode ?? "sub");
    case RIVESTREAM_PROVIDER_ID:
      return getRivestreamKnownCatalog(
        context.rivestreamServices && context.rivestreamServices.length > 0
          ? context.rivestreamServices
          : [...RIVESTREAM_FALLBACK_SERVICES],
      );
    case VIDLINK_PROVIDER_ID:
      return getVidlinkKnownCatalog();
    default:
      return [];
  }
}
