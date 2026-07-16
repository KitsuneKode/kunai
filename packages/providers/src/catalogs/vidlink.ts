import type { KnownCatalogEntry } from "../shared/known-catalog";
import { VIDLINK_PROVIDER_ID } from "../vidlink/manifest";

export function getVidlinkKnownCatalog(): readonly KnownCatalogEntry[] {
  return [
    {
      sourceId: `source:${VIDLINK_PROVIDER_ID}:${VIDLINK_PROVIDER_ID}`,
      label: "VidLink",
      audioLanguage: "en",
      host: "vidlink.pro",
      metadata: {
        singleSource: true,
      },
    },
  ];
}
