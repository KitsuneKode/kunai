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

function computeYoutubeConfigFingerprint(meta: KitsuneConfig["youtubeMetadata"]): string {
  return JSON.stringify({
    instanceUrl: meta?.instanceUrl ?? "",
    pipedApiUrl: meta?.pipedApiUrl ?? "",
    cookiesFromBrowser: meta?.cookiesFromBrowser ?? "",
    cookiesFile: meta?.cookiesFile ?? "",
    extractorArgs: meta?.extractorArgs ?? "",
    poToken: meta?.poToken ?? "",
    sponsorblockRemove: meta?.sponsorblockRemove ?? "",
  });
}

export function applyYoutubeProviderConfig(
  config: Pick<KitsuneConfig, "youtubeMetadata">,
  cacheDb: KunaiDatabase,
  options: { readonly purgeCache?: boolean } = {},
): void {
  const youtubeMetadataCache = new YoutubeMetadataCacheRepository(cacheDb);
  const currentFingerprint = computeYoutubeConfigFingerprint(config.youtubeMetadata);

  let drifted = false;
  try {
    const row = cacheDb
      .query<{ payload_json: string }, [string, string]>(
        "SELECT payload_json FROM provider_cache WHERE namespace = ? AND cache_key = ?",
      )
      .get("youtube_config", "fingerprint");
    if (row && row.payload_json !== currentFingerprint) {
      drifted = true;
    }
  } catch {
    // Best-effort in unmigrated or mock databases
  }

  if (options.purgeCache || drifted) {
    youtubeMetadataCache.purgeAll();
  }

  try {
    const nowIso = new Date().toISOString();
    const farFuture = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    cacheDb
      .query(
        `INSERT INTO provider_cache (namespace, cache_key, payload_json, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(namespace, cache_key) DO UPDATE SET
           payload_json = excluded.payload_json,
           created_at = excluded.created_at`,
      )
      .run("youtube_config", "fingerprint", currentFingerprint, farFuture, nowIso);
  } catch {
    // Best-effort tracking
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
      poToken: config.youtubeMetadata.poToken,
    },
  });

  configureYoutubeProvider({
    invidiousInstanceUrl: config.youtubeMetadata.instanceUrl,
    pipedApiUrl: config.youtubeMetadata.pipedApiUrl,
    cookiesFromBrowser: config.youtubeMetadata.cookiesFromBrowser,
    cookiesFile: config.youtubeMetadata.cookiesFile,
    extractorArgs: config.youtubeMetadata.extractorArgs,
    poToken: config.youtubeMetadata.poToken,
    sponsorblockRemove: config.youtubeMetadata.sponsorblockRemove,
    metadataService,
  });
}
