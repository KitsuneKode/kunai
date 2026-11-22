// Bumped for short-side resolution ranking, dynamic range, and protocol metadata;
// older cache rows must refetch so HDR/DASH/Shorts ladders are ranked accurately.
export const YOUTUBE_METADATA_SCHEMA_VERSION = 5 as const;

export type YoutubeVideoQuality = {
  readonly label: string;
  readonly rank: number;
  readonly formatId: string;
  readonly hasAudio?: boolean;
  readonly dynamicRange?: string;
  readonly protocol?: string;
};

export type YoutubeVideoSubtitle = {
  readonly language: string;
  readonly ext?: string;
  readonly url: string;
  readonly source: "manual" | "auto";
};

export type YoutubeVideoMetadata = {
  readonly schemaVersion: typeof YOUTUBE_METADATA_SCHEMA_VERSION;
  readonly videoId: string;
  readonly title?: string;
  readonly durationSeconds?: number;
  readonly thumbnail?: string;
  readonly uploader?: string;
  readonly channelId?: string;
  readonly viewCount?: number;
  readonly uploadDate?: string;
  readonly publishedAt?: string;
  readonly isLive?: boolean;
  readonly liveStatus?: string;
  readonly qualities: readonly YoutubeVideoQuality[];
  readonly subtitles: readonly YoutubeVideoSubtitle[];
};

export type YoutubeMetadataCachePort = {
  readonly get: (videoId: string) => YoutubeVideoMetadata | null | undefined;
  readonly set: (videoId: string, metadata: YoutubeVideoMetadata) => void;
};

export type YoutubeMetadataService = {
  readonly get: (videoId: string) => YoutubeVideoMetadata | null;
  readonly getOrFetch: (
    videoId: string,
    watchUrl: string,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<YoutubeVideoMetadata | null>;
};
