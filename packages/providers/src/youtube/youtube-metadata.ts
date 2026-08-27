// Bumped to 3 when `publishedAt` was added. A cached schema-2 payload is accepted
// as-is and never re-normalized, so without the bump every existing entry would
// keep answering without an upload date until its TTL expired.
export const YOUTUBE_METADATA_SCHEMA_VERSION = 3 as const;

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
