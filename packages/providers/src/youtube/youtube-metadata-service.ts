import { normalizeYtDlpVideoInfo } from "./metadata-normalize";
import type {
  YoutubeMetadataCachePort,
  YoutubeMetadataService,
  YoutubeVideoMetadata,
} from "./youtube-metadata";
import { extractYtDlpVideoInfo, type YtDlpExtractOptions } from "./yt-dlp-metadata";

export type CreateYoutubeMetadataServiceOptions = {
  readonly cache?: YoutubeMetadataCachePort;
  readonly extractOptions?: Omit<YtDlpExtractOptions, "signal">;
  readonly extract?: typeof extractYtDlpVideoInfo;
};

export function createYoutubeMetadataService(
  options: CreateYoutubeMetadataServiceOptions,
): YoutubeMetadataService {
  const extract = options.extract ?? extractYtDlpVideoInfo;

  return {
    get(videoId: string): YoutubeVideoMetadata | null {
      return options.cache?.get(videoId) ?? null;
    },

    async getOrFetch(
      videoId: string,
      watchUrl: string,
      fetchOptions: { readonly signal?: AbortSignal } = {},
    ): Promise<YoutubeVideoMetadata | null> {
      const cached = options.cache?.get(videoId);
      if (cached) return cached;

      const raw = await extract(watchUrl, {
        ...options.extractOptions,
        signal: fetchOptions.signal,
      });
      const normalized = normalizeYtDlpVideoInfo(raw, videoId);
      options.cache?.set(videoId, normalized);
      return normalized;
    },
  };
}
