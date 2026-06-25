import {
  YOUTUBE_METADATA_SCHEMA_VERSION,
  type YoutubeVideoMetadata,
  type YoutubeVideoSubtitle,
} from "./youtube-metadata";
import { mapYtDlpFormatsToQualityLabels, type YtDlpVideoInfo } from "./yt-dlp-metadata";

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
