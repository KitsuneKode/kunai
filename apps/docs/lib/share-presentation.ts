/**
 * How a decoded share ref is described to a human.
 *
 * Shared by the `/w/[code]` landing page and its social card so a link's
 * unfurl and its page cannot disagree about what was shared. Keep this pure —
 * the social card renders inside `ImageResponse`, which has no DOM and no
 * network.
 */

import type { PlaybackTargetRef } from "@kunai/types";

/** The title to show, falling back through the anchor when the ref carries no title. */
export function titleFor(ref: PlaybackTargetRef): string {
  if (ref.title) return ref.title;
  if (ref.anchor.by === "catalog") return `${ref.anchor.ns.toUpperCase()} ${ref.anchor.id}`;
  return ref.anchor.query;
}

/** Which catalog anchored this share, or that it will fall back to search. */
export function catalogFor(ref: PlaybackTargetRef): string {
  return ref.anchor.by === "catalog"
    ? `${ref.anchor.ns.toUpperCase()} · ${ref.anchor.id}`
    : "Search fallback";
}

/** Where in the work the share points — season/episode, absolute episode, or the kind. */
export function positionFor(ref: PlaybackTargetRef): string {
  if (ref.season !== undefined && ref.episode !== undefined) {
    return `Season ${ref.season} · Episode ${ref.episode}`;
  }
  if (ref.absoluteEpisode !== undefined) return `Episode ${ref.absoluteEpisode}`;
  return ref.kind === "movie" ? "Movie" : ref.kind === "video" ? "Video" : "Series";
}

/** First character of the title, for the artwork placeholder. */
export function initialFor(title: string): string {
  return Array.from(title.trim())[0]?.toUpperCase() ?? "K";
}
