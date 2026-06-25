import { isYoutubeHistoryEntry } from "@/services/continuation/history-progress";
import { getCachedYoutubeVideoMetadata } from "@kunai/providers/youtube";
import type { YoutubeVideoMetadata } from "@kunai/providers/youtube";
import { parseYoutubeCatalogId } from "@kunai/providers/youtube";
import type { HistoryProgress } from "@kunai/storage";

export type YoutubeHistoryEnrichment = {
  readonly title?: string;
  readonly posterUrl?: string;
  readonly durationSeconds?: number;
};

export function enrichYoutubeHistoryRow(
  progress: HistoryProgress,
  metadata: YoutubeVideoMetadata | null,
): YoutubeHistoryEnrichment {
  if (!metadata) return {};
  return {
    title: progress.title.trim().length > 0 ? undefined : metadata.title,
    posterUrl: progress.posterUrl?.trim() ? undefined : metadata.thumbnail,
    durationSeconds:
      typeof progress.durationSeconds === "number" && progress.durationSeconds > 0
        ? undefined
        : metadata.durationSeconds,
  };
}

export function resolveYoutubeHistoryMetadata(
  progress: HistoryProgress,
): YoutubeVideoMetadata | null {
  if (!isYoutubeHistoryEntry(progress)) return null;
  const parsed = parseYoutubeCatalogId(progress.titleId);
  if (parsed.kind !== "video") return null;
  return getCachedYoutubeVideoMetadata(parsed.nativeId);
}

export function applyYoutubeHistoryEnrichment(progress: HistoryProgress): HistoryProgress {
  const metadata = resolveYoutubeHistoryMetadata(progress);
  if (!metadata) return progress;
  const enriched = enrichYoutubeHistoryRow(progress, metadata);
  if (!enriched.title && !enriched.posterUrl && enriched.durationSeconds === undefined) {
    return progress;
  }
  return {
    ...progress,
    title: enriched.title ?? progress.title,
    posterUrl: enriched.posterUrl ?? progress.posterUrl,
    durationSeconds: enriched.durationSeconds ?? progress.durationSeconds,
  };
}
