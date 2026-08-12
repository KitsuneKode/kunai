// =============================================================================
// queue-entry-label.ts — single authority for how a queue entry is named in UI.
//
// The "Next: …" cue appears on the playback footer, the post-play screen, the
// auto-advance countdown and the queue overlay. Each had grown its own
// formatter, so the same entry could read "Show S01E03", "Show · S01E03" or
// just "Show" depending on where you looked.
// =============================================================================

import { normalizeMediaKind, presentMedia } from "@/domain/media/media-presentation";
import type { QueueEntry } from "@kunai/storage";

/**
 * Display label for a queue entry. Appends the canonical position tag only when
 * the media-presentation seam says the entry has one. Returns undefined when
 * there is nothing worth showing, so callers can omit the cue entirely.
 */
export function formatQueueEntryLabel(
  entry: Pick<QueueEntry, "title" | "mediaKind" | "season" | "episode"> | null | undefined,
): string | undefined {
  if (!entry) return undefined;
  const title = entry.title.trim();
  if (!title) return undefined;
  const { positionLabel } = presentMedia({
    title,
    mediaKind: normalizeMediaKind(entry.mediaKind),
    season: entry.season,
    episode: entry.episode,
  });
  return positionLabel === null ? title : `${title} · ${positionLabel}`;
}
