import { extname } from "node:path";

const MIME_TO_EXT: Record<string, string> = {
  "text/vtt": ".vtt",
  "application/x-subtitle-vtt": ".vtt",
  "application/x-subrip": ".srt",
};

function normalizedMime(value: string | null): string | null {
  if (!value) return null;
  const base = value.split(";")[0]?.trim().toLowerCase();
  return base ?? null;
}

function extFromSubtitleUrl(subtitleUrl: string): string | null {
  try {
    const name = decodeURIComponent(new URL(subtitleUrl).pathname.split("/").pop() ?? "");
    const match = extname(name).match(/\.(srt|vtt|ssa|ass)$/i);
    if (!match?.[1]) return null;
    return `.${match[1].toLowerCase()}`;
  } catch {
    return null;
  }
}

/** Sidecar subtitle path beside the video output. */
export function resolveSubtitleArtifactPath(params: {
  readonly videoOutputPath: string;
  readonly subtitleUrl: string;
  readonly contentType?: string | null;
}): string {
  // The character class must exclude `\` as well as `/`: on Windows a download
  // directory containing a dot (`D:\Media\Anime.Shows\ep`) would otherwise let
  // the match run back across the separator and eat part of the directory name.
  const base = params.videoOutputPath.replace(/\.[^./\\]+$/, "");
  const fromUrl = extFromSubtitleUrl(params.subtitleUrl);
  if (fromUrl) return `${base}${fromUrl}`;

  const mime = normalizedMime(params.contentType ?? null);
  if (mime && mime in MIME_TO_EXT) return `${base}${MIME_TO_EXT[mime]}`;
  return `${base}.srt`;
}
