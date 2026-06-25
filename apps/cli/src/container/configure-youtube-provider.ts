import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import {
  configureYoutubeProvider,
  createYoutubeMetadataService,
  parseCachedYoutubeMetadata,
  YOUTUBE_METADATA_SCHEMA_VERSION,
} from "@kunai/providers/youtube";
import type { YoutubeVideoMetadata } from "@kunai/providers/youtube";
import { YoutubeMetadataCacheRepository, type KunaiDatabase } from "@kunai/storage";

export const YOUTUBE_METADATA_TTL_MS = 15 * 60 * 1000;

export function applyYoutubeProviderConfig(
  config: Pick<KitsuneConfig, "youtubeMetadata">,
  cacheDb: KunaiDatabase,
  options: { readonly purgeCache?: boolean } = {},
): void {
  const youtubeMetadataCache = new YoutubeMetadataCacheRepository(cacheDb);
  if (options.purgeCache) {
    youtubeMetadataCache.purgeAll();
  }

  const cachePort = {
    get(videoId: string): YoutubeVideoMetadata | null {
      const record = youtubeMetadataCache.get(videoId, new Date().toISOString());
      if (!record) return null;
      try {
        const parsed: unknown = JSON.parse(record.payloadJson);
        if (
          parsed &&
          typeof parsed === "object" &&
          "schemaVersion" in parsed &&
          parsed.schemaVersion === YOUTUBE_METADATA_SCHEMA_VERSION
        ) {
          return parsed as YoutubeVideoMetadata;
        }
      } catch {
        // fall through to legacy normalize
      }
      const normalized = parseCachedYoutubeMetadata(record.payloadJson, videoId);
      if (normalized) {
        cachePort.set(videoId, normalized);
      }
      return normalized;
    },
    set(videoId: string, metadata: YoutubeVideoMetadata): void {
      const now = new Date();
      youtubeMetadataCache.upsert({
        videoId,
        payloadJson: JSON.stringify(metadata),
        source: "yt-dlp",
        fetchedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + YOUTUBE_METADATA_TTL_MS).toISOString(),
      });
    },
  };

  const metadataService = createYoutubeMetadataService({
    cache: cachePort,
    extractOptions: {
      cookiesFromBrowser: config.youtubeMetadata.cookiesFromBrowser,
      cookiesFile: config.youtubeMetadata.cookiesFile,
      extractorArgs: config.youtubeMetadata.extractorArgs,
    },
  });

  configureYoutubeProvider({
    invidiousInstanceUrl: config.youtubeMetadata.instanceUrl,
    pipedApiUrl: config.youtubeMetadata.pipedApiUrl,
    cookiesFromBrowser: config.youtubeMetadata.cookiesFromBrowser,
    cookiesFile: config.youtubeMetadata.cookiesFile,
    extractorArgs: config.youtubeMetadata.extractorArgs,
    sponsorblockRemove: config.youtubeMetadata.sponsorblockRemove,
    metadataService,
  });
}
