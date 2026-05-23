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

export function compareEpisodeCursors(left: EpisodeCursor, right: EpisodeCursor): number {
  if (typeof left.absoluteEpisode === "number" && typeof right.absoluteEpisode === "number") {
    return left.absoluteEpisode - right.absoluteEpisode;
  }

  const seasonDelta = (left.season ?? 0) - (right.season ?? 0);
  if (seasonDelta !== 0) return seasonDelta;

  if (typeof left.episode === "number" && typeof right.episode === "number") {
    return left.episode - right.episode;
  }

  if (typeof left.absoluteEpisode === "number" && typeof right.absoluteEpisode === "number") {
    return left.absoluteEpisode - right.absoluteEpisode;
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
