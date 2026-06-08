import { RIVESTREAM_PROVIDER_ID } from "../rivestream/manifest";
import type { KnownCatalogEntry } from "../shared/known-catalog";
import { providerInventorySourceId } from "../shared/source-inventory";

export const RIVESTREAM_FALLBACK_SERVICES = [
  "flowcast",
  "asiacloud",
  "primevids",
  "hindicast",
  "guru",
  "ophim",
] as const;

const NARUTO_ROSTER = [
  "Naruto",
  "Sasuke",
  "Sakura",
  "Kakashi",
  "Hinata",
  "Shikamaru",
  "Gaara",
  "Rock Lee",
  "Neji",
  "Guy",
  "Jiraiya",
  "Itachi",
  "Pain",
] as const;

export function displayRivestreamCatalogLabel(serviceId: string, index: number): string {
  return NARUTO_ROSTER[index % NARUTO_ROSTER.length] ?? serviceId;
}

export function getRivestreamKnownCatalog(
  services: readonly string[],
): readonly KnownCatalogEntry[] {
  return services.map((serviceId, index) => {
    const label = displayRivestreamCatalogLabel(serviceId, index);
    return {
      sourceId: providerInventorySourceId(RIVESTREAM_PROVIDER_ID, serviceId),
      label,
      subtitle: `English · ${serviceId}`,
      audioLanguage: "en",
      host: "rivestream.app",
      metadata: {
        provider: serviceId,
        nativeLabel: serviceId,
        flavorLabel: label,
        flavorArchetype: `English · ${serviceId}`,
      },
    };
  });
}
