export type EpisodeCursor = {
  readonly season?: number;
  readonly episode?: number;
  readonly absoluteEpisode?: number;
};

export type EpisodeCursorInput = EpisodeCursor & {
  readonly updatedAt?: string;
};

export function toEpisodeCursor(input: EpisodeCursorInput): EpisodeCursor | undefined {
  const cursor: EpisodeCursor = {
    ...(typeof input.season === "number" ? { season: input.season } : {}),
    ...(typeof input.episode === "number" ? { episode: input.episode } : {}),
    ...(typeof input.absoluteEpisode === "number"
      ? { absoluteEpisode: input.absoluteEpisode }
      : {}),
  };

  return isNormalEpisodeCursor(cursor) ? cursor : undefined;
}

export function isNormalEpisodeCursor(cursor: EpisodeCursor): boolean {
  if (typeof cursor.absoluteEpisode === "number" && cursor.absoluteEpisode <= 0) return false;
  if (typeof cursor.season === "number" && cursor.season <= 0) return false;
  if (typeof cursor.episode === "number" && cursor.episode <= 0) return false;
  return typeof cursor.absoluteEpisode === "number" || typeof cursor.episode === "number";
}

/**
 * Orders two cursors of the *same* shape.
 *
 * Absolute against absolute wins outright; otherwise it is season, then
 * episode, with a missing season read as 0 so an unseasoned cursor sorts below
 * season 1.
 *
 * Mixed shapes — one side absolute-only, the other season/episode — are not
 * comparable and return 0, because the two numbering schemes have no shared
 * scale: absolute 25 is not "greater than" S2E3 by any arithmetic available
 * here. Ordering them would fabricate an answer, and a caller picking a highest
 * cursor would act on it. The producers do not mix shapes today —
 * `toReleaseReconciliationHistoryRows` normalises every row to season+episode
 * before a cursor exists — so this is the contract, not a live hazard.
 */
export function compareEpisodeCursors(left: EpisodeCursor, right: EpisodeCursor): number {
  const leftAbsolute = left.absoluteEpisode;
  const rightAbsolute = right.absoluteEpisode;
  if (typeof leftAbsolute === "number" && typeof rightAbsolute === "number") {
    return leftAbsolute - rightAbsolute;
  }

  const leftEpisode = left.episode;
  const rightEpisode = right.episode;
  const leftIsNumbered = typeof leftEpisode === "number";
  const rightIsNumbered = typeof rightEpisode === "number";
  // One side numbers by season/episode and the other only absolutely.
  // `isNormalEpisodeCursor` guarantees each carries at least one of the two, so
  // this is the mixed case rather than an empty cursor.
  if (leftIsNumbered !== rightIsNumbered) return 0;

  const seasonDelta = (left.season ?? 0) - (right.season ?? 0);
  if (seasonDelta !== 0) return seasonDelta;

  if (typeof leftEpisode === "number" && typeof rightEpisode === "number") {
    return leftEpisode - rightEpisode;
  }

  return 0;
}

export function pickHighestEpisodeCursor(
  inputs: readonly EpisodeCursorInput[],
): EpisodeCursor | undefined {
  let highest: EpisodeCursor | undefined;

  for (const input of inputs) {
    const cursor = toEpisodeCursor(input);
    if (!cursor) continue;
    if (!highest || compareEpisodeCursors(cursor, highest) > 0) {
      highest = cursor;
    }
  }

  return highest;
}
