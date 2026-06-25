export const YOUTUBE_METADATA_SCHEMA_VERSION = 2 as const;

export type YoutubeVideoQuality = {
  readonly label: string;
  readonly rank: number;
  readonly formatId: string;
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
