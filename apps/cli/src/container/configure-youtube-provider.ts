import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { configureYoutubeProvider } from "@kunai/providers/youtube";
import type { YtDlpVideoInfo } from "@kunai/providers/youtube";
import { YoutubeMetadataCacheRepository, type KunaiDatabase } from "@kunai/storage";

const YOUTUBE_METADATA_TTL_MS = 15 * 60 * 1000;

export function applyYoutubeProviderConfig(
  config: Pick<KitsuneConfig, "youtubeMetadata">,
  cacheDb: KunaiDatabase,
  options: { readonly purgeCache?: boolean } = {},
): void {
  const youtubeMetadataCache = new YoutubeMetadataCacheRepository(cacheDb);
  if (options.purgeCache) {
    youtubeMetadataCache.purgeAll();
  }
  configureYoutubeProvider({
    invidiousInstanceUrl: config.youtubeMetadata.instanceUrl,
    pipedApiUrl: config.youtubeMetadata.pipedApiUrl,
    cookiesFromBrowser: config.youtubeMetadata.cookiesFromBrowser,
    cookiesFile: config.youtubeMetadata.cookiesFile,
    extractorArgs: config.youtubeMetadata.extractorArgs,
    sponsorblockRemove: config.youtubeMetadata.sponsorblockRemove,
    metadataCache: {
      get(videoId: string): YtDlpVideoInfo | null {
        const record = youtubeMetadataCache.get(videoId, new Date().toISOString());
        if (!record) return null;
        try {
          return JSON.parse(record.payloadJson) as YtDlpVideoInfo;
        } catch {
          return null;
        }
      },
      set(videoId: string, info: YtDlpVideoInfo): void {
        const now = new Date();
        youtubeMetadataCache.upsert({
          videoId,
          payloadJson: JSON.stringify(info),
          source: "yt-dlp",
          fetchedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + YOUTUBE_METADATA_TTL_MS).toISOString(),
        });
      },
    },
  });
}
