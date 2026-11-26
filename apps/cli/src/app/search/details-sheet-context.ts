import type { Container } from "@/container";

/** The details sheet's local inputs (structurally its history and availability). */
export type DetailsSheetContext = {
  readonly history: {
    readonly season?: number;
    readonly episode?: number;
    readonly positionSeconds: number;
    readonly durationSeconds?: number;
    readonly completed: boolean;
  } | null;
  readonly availability: {
    readonly providers: readonly string[];
    readonly offline: boolean;
    readonly subs: readonly string[];
  } | null;
};

/**
 * The parts of the details sheet only local state knows: your latest progress
 * on the title, where you last watched it, and whether a ready download
 * exists. The sheet rendered `history: null, availability: null` always, so
 * "Your progress" and "Where" never appeared (Neon features review #4).
 */
export function detailsSheetContextFor(
  container: Pick<Container, "historyRepository" | "downloadService">,
  titleId: string,
): DetailsSheetContext {
  const latest = container.historyRepository
    .listByTitle(titleId)
    .toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  const offline = container.downloadService
    .listCompleted(500)
    .some((job) => job.titleId === titleId);
  const history: DetailsSheetContext["history"] = latest
    ? {
        season: latest.season,
        episode: latest.episode ?? latest.absoluteEpisode,
        positionSeconds: latest.positionSeconds,
        durationSeconds: latest.durationSeconds,
        completed: latest.completed,
      }
    : null;
  const providers = latest?.providerId ? [latest.providerId] : [];
  return {
    history,
    availability: providers.length > 0 || offline ? { providers, offline, subs: [] } : null,
  };
}
