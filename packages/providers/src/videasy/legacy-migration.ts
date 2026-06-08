import { VIDEOSY_PROVIDER_ID } from "./manifest";

/** Legacy provider ids that resolve to Videasy. */
export const LEGACY_VIDEASY_PROVIDER_IDS = ["vidking"] as const;

export type LegacyVideasyProviderId = (typeof LEGACY_VIDEASY_PROVIDER_IDS)[number];

export function isLegacyVideasyProviderId(
  providerId: string,
): providerId is LegacyVideasyProviderId {
  return (LEGACY_VIDEASY_PROVIDER_IDS as readonly string[]).includes(providerId);
}

export function migrateLegacyProviderId(providerId: string): string {
  return isLegacyVideasyProviderId(providerId) ? VIDEOSY_PROVIDER_ID : providerId;
}
