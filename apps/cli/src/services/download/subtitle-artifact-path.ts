import type { RemoteSubtitleFile } from "@/services/playback/remote-subtitle-download";

/** Sidecar subtitle path beside the video output, with the verified format's extension. */
export function resolveSubtitleArtifactPath(
  videoOutputPath: string,
  extension: RemoteSubtitleFile["extension"],
): string {
  const base = videoOutputPath.replace(/\.[^./\\]+$/, "");
  return `${base}.${extension}`;
}
