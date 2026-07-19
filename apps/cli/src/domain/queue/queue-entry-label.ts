// =============================================================================
// queue-entry-label.ts — single authority for how a queue entry is named in UI.
//
// The "Next: …" cue appears on the playback footer, the post-play screen, the
// auto-advance countdown and the queue overlay. Each had grown its own
// formatter, so the same entry could read "Show S01E03", "Show · S01E03" or
// just "Show" depending on where you looked.
// =============================================================================

import type { QueueEntry } from "@kunai/storage";

/**
 * Display label for a queue entry. Appends a SxxExx tag only for non-movie
 * entries that actually carry an episode. Returns undefined when there is
 * nothing worth showing, so callers can omit the cue entirely.
 */
export function formatQueueEntryLabel(
  entry: Pick<QueueEntry, "title" | "mediaKind" | "season" | "episode"> | null | undefined,
): string | undefined {
  if (!entry) return undefined;
  const title = entry.title.trim();
  if (!title) return undefined;
  if (entry.mediaKind !== "movie" && entry.episode !== undefined) {
    const tag = `S${String(entry.season ?? 1).padStart(2, "0")}E${String(entry.episode).padStart(2, "0")}`;
    return `${title} · ${tag}`;
  }
  return title;
}
