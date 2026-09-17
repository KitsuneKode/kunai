import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";

import type { PlaybackTimingMetadata } from "@/domain/types";
import { getKunaiPaths } from "@kunai/storage";

export function formatOgmTimestamp(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(safeMs / 1000);
  const msec = safeMs % 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(msec).padStart(3, "0")}`;
}

export interface ChapterSegment {
  readonly startMs: number;
  readonly endMs: number;
  readonly title: string;
}

/**
 * Builds non-overlapping, continuous chapter segments from timing metadata.
 */
export function buildChapterSegmentsFromTiming(
  timing: PlaybackTimingMetadata | null | undefined,
  fallbackDurationMs = 86_400_000,
): readonly ChapterSegment[] {
  if (!timing) return [];

  const markers: Array<{ startMs: number; endMs: number; title: string }> = [];

  for (const recap of timing.recap ?? []) {
    if (typeof recap?.startMs === "number" && recap.startMs >= 0) {
      const endMs =
        typeof recap?.endMs === "number" && recap.endMs > recap.startMs
          ? recap.endMs
          : recap.startMs + 60_000;
      markers.push({
        startMs: Math.round(recap.startMs),
        endMs: Math.round(endMs),
        title: "Recap",
      });
    }
  }

  for (const intro of timing.intro ?? []) {
    if (typeof intro?.startMs === "number" && intro.startMs >= 0) {
      const endMs =
        typeof intro?.endMs === "number" && intro.endMs > intro.startMs
          ? intro.endMs
          : intro.startMs + 90_000;
      markers.push({
        startMs: Math.round(intro.startMs),
        endMs: Math.round(endMs),
        title: "Intro",
      });
    }
  }

  for (const credits of timing.credits ?? []) {
    if (typeof credits?.startMs === "number" && credits.startMs >= 0) {
      const endMs =
        typeof credits?.endMs === "number" && credits.endMs > credits.startMs
          ? credits.endMs
          : credits.startMs + 90_000;
      markers.push({
        startMs: Math.round(credits.startMs),
        endMs: Math.round(endMs),
        title: "Credits",
      });
    }
  }

  for (const preview of timing.preview ?? []) {
    if (typeof preview?.startMs === "number" && preview.startMs >= 0) {
      const endMs =
        typeof preview?.endMs === "number" && preview.endMs > preview.startMs
          ? preview.endMs
          : preview.startMs + 30_000;
      markers.push({
        startMs: Math.round(preview.startMs),
        endMs: Math.round(endMs),
        title: "Preview",
      });
    }
  }

  if (markers.length === 0) return [];

  markers.sort((a, b) => a.startMs - b.startMs);

  const chapters: ChapterSegment[] = [];
  let cursor = 0;

  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i]!;
    if (marker.startMs > cursor + 1000) {
      const prevMarker = i > 0 ? markers[i - 1] : undefined;
      const gapTitle =
        cursor === 0 ? "Prologue" : prevMarker?.title === "Credits" ? "Epilogue" : "Episode";
      chapters.push({
        startMs: cursor,
        endMs: marker.startMs,
        title: gapTitle,
      });
    }

    const nextMarker = markers[i + 1];
    const boundedEnd = nextMarker ? Math.min(marker.endMs, nextMarker.startMs) : marker.endMs;
    const finalEnd = nextMarker
      ? Math.max(
          marker.startMs,
          Math.min(Math.max(boundedEnd, marker.startMs + 100), nextMarker.startMs),
        )
      : Math.max(boundedEnd, marker.startMs + 1000);

    chapters.push({
      startMs: marker.startMs,
      endMs: finalEnd,
      title: marker.title,
    });
    cursor = finalEnd;
  }

  // After the last marker (typically credits or preview), add Epilogue or Episode tail if open-ended
  const lastMarker = markers[markers.length - 1]!;
  if (lastMarker.title === "Credits") {
    chapters.push({
      startMs: cursor,
      endMs: Math.max(cursor + 1000, fallbackDurationMs),
      title: "Epilogue",
    });
  } else if (lastMarker.title === "Intro" || lastMarker.title === "Recap") {
    chapters.push({
      startMs: cursor,
      endMs: Math.max(cursor + 1000, fallbackDurationMs),
      title: "Episode",
    });
  }

  return chapters;
}

/**
 * Builds an FFmpeg / libavformat FFMETADATA chapter string.
 * This format is parsed natively by libavformat inside mpv's demuxer.
 */
export function buildFfmetadataChaptersFromTiming(
  timing: PlaybackTimingMetadata | null | undefined,
  fallbackDurationMs = 86_400_000,
): string | null {
  const chapters = buildChapterSegmentsFromTiming(timing, fallbackDurationMs);
  if (chapters.length === 0) return null;

  const lines: string[] = [";FFMETADATA1\n"];

  for (const ch of chapters) {
    lines.push("[CHAPTER]");
    lines.push("TIMEBASE=1/1000");
    lines.push(`START=${ch.startMs}`);
    lines.push(`END=${ch.endMs}`);
    lines.push(`title=${ch.title}\n`);
  }

  return lines.join("\n");
}

export function buildOgmChaptersFromTiming(
  timing: PlaybackTimingMetadata | null | undefined,
): string | null {
  const chapters = buildChapterSegmentsFromTiming(timing);
  if (chapters.length === 0) return null;

  const lines: string[] = [];
  chapters.forEach((item, index) => {
    const num = String(index + 1).padStart(2, "0");
    lines.push(`CHAPTER${num}=${formatOgmTimestamp(item.startMs)}`);
    lines.push(`CHAPTER${num}NAME=${item.title}`);
  });
  return lines.join("\n") + "\n";
}

export async function writeMpvChaptersFile(
  timing: PlaybackTimingMetadata | null | undefined,
  id: string,
  cacheDir: string = getKunaiPaths().cacheDir,
): Promise<string | null> {
  const content = buildFfmetadataChaptersFromTiming(timing);
  if (!content) return null;

  const chaptersDir = join(cacheDir, "chapters");
  await mkdir(chaptersDir, { recursive: true });

  const sanitizedId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = join(chaptersDir, `kunai-chapters-${sanitizedId}.ffmeta`);
  await Bun.write(filePath, content);
  return filePath;
}

export async function removeMpvChaptersFile(filePath: string | null | undefined): Promise<void> {
  if (!filePath) return;
  try {
    await unlink(filePath);
  } catch {
    // Ignore cleanup error if file was already removed
  }
}
