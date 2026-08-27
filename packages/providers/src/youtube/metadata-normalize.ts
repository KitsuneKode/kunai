import {
  YOUTUBE_METADATA_SCHEMA_VERSION,
  type YoutubeVideoMetadata,
  type YoutubeVideoSubtitle,
} from "./youtube-metadata";
import { mapYtDlpFormatsToQualityLabels, type YtDlpVideoInfo } from "./yt-dlp-metadata";

export function parseUploadDate(info: YtDlpVideoInfo): string | undefined {
  if (typeof info.release_timestamp === "number" && Number.isFinite(info.release_timestamp)) {
    return new Date(info.release_timestamp * 1000).toISOString();
  }
  if (typeof info.timestamp === "number" && Number.isFinite(info.timestamp)) {
    return new Date(info.timestamp * 1000).toISOString();
  }
  if (typeof info.upload_date === "string") {
    const match = info.upload_date.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`;
    }
  }
  return undefined;
}

export function normalizeYtDlpVideoInfo(
  info: YtDlpVideoInfo,
  videoId: string,
): YoutubeVideoMetadata {
  const qualities = mapYtDlpFormatsToQualityLabels(info.formats);
  return {
    schemaVersion: YOUTUBE_METADATA_SCHEMA_VERSION,
    videoId: info.id ?? videoId,
    title: info.title,
    durationSeconds: typeof info.duration === "number" ? info.duration : undefined,
    thumbnail: info.thumbnail,
    uploader: info.uploader,
    channelId: info.channel_id,
    viewCount: typeof info.view_count === "number" ? info.view_count : undefined,
    uploadDate: info.upload_date,
    publishedAt: parseUploadDate(info),
    isLive: info.is_live === true,
    liveStatus: info.live_status,
    qualities,
    subtitles: mapSubtitleTracks(info),
  };
}

export function parseCachedYoutubeMetadata(
  payloadJson: string,
  videoId: string,
): YoutubeVideoMetadata | null {
  try {
    const parsed: unknown = JSON.parse(payloadJson);
    if (!parsed || typeof parsed !== "object") return null;
    if (
      "schemaVersion" in parsed &&
      parsed.schemaVersion === YOUTUBE_METADATA_SCHEMA_VERSION &&
      "videoId" in parsed &&
      typeof parsed.videoId === "string"
    ) {
      return parsed as YoutubeVideoMetadata;
    }
    return normalizeYtDlpVideoInfo(parsed as YtDlpVideoInfo, videoId);
  } catch {
    return null;
  }
}

function mapSubtitleTracks(info: YtDlpVideoInfo): readonly YoutubeVideoSubtitle[] {
  const manual = info.subtitles ?? {};
  const automatic = info.automatic_captions ?? {};
  const subtitles: YoutubeVideoSubtitle[] = [];
  const seen = new Set<string>();

  for (const [language, tracks] of Object.entries(manual)) {
    const track = tracks[tracks.length - 1];
    if (!track?.url || seen.has(language)) continue;
    seen.add(language);
    subtitles.push({
      language,
      ext: track.ext,
      url: track.url,
      source: "manual",
    });
  }

  for (const [language, tracks] of Object.entries(automatic)) {
    if (seen.has(language)) continue;
    const track = tracks[tracks.length - 1];
    if (!track?.url) continue;
    seen.add(language);
    subtitles.push({
      language,
      ext: track.ext,
      url: track.url,
      source: "auto",
    });
  }

  return subtitles;
}
