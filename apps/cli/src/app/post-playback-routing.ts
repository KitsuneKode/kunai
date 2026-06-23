import type { EpisodeAvailability } from "@/domain/playback/playback-policy";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";

type HistoryEntryRoute = {
  readonly type: "history-entry";
  readonly title: TitleInfo;
  readonly episode?: EpisodeInfo;
};

export type PostPlaybackExitOutcome =
  | { readonly status: "quit" }
  | {
      readonly status: "success";
      readonly value:
        | "back_to_search"
        | "back_to_results"
        | { readonly type: "browse_route"; readonly route: "calendar" | "random" }
        | {
            readonly type: "history_entry";
            readonly title: TitleInfo;
            readonly episode?: EpisodeInfo;
          };
    };

export function resolvePostPlaybackExitOutcome(
  routedAction:
    | string
    | HistoryEntryRoute
    | { readonly type: string; readonly [key: string]: unknown },
): PostPlaybackExitOutcome | null {
  if (routedAction === "quit") return { status: "quit" };
  if (typeof routedAction === "object" && routedAction.type === "history-entry") {
    const route = routedAction as HistoryEntryRoute;
    return {
      status: "success",
      value: {
        type: "history_entry",
        title: route.title,
        episode: route.episode,
      },
    };
  }
  if (routedAction === "mode-switch" || routedAction === "back-to-search") {
    return { status: "success", value: "back_to_search" };
  }
  if (routedAction === "back-to-results") {
    return { status: "success", value: "back_to_results" };
  }
  if (routedAction === "calendar" || routedAction === "random") {
    return { status: "success", value: { type: "browse_route", route: routedAction } };
  }
  return null;
}

export type PostPlaybackEpisodeNavigationRoute = {
  readonly episode: EpisodeInfo;
  readonly source: "next" | "previous" | "next-season";
};

export function resolvePostPlaybackEpisodeNavigationRoute(input: {
  readonly action: unknown;
  readonly titleType: TitleInfo["type"];
  readonly availability: EpisodeAvailability;
}): PostPlaybackEpisodeNavigationRoute | null {
  if (input.titleType !== "series") return null;
  if (input.action === "next" && input.availability.nextEpisode) {
    return { episode: input.availability.nextEpisode, source: "next" };
  }
  if (input.action === "previous" && input.availability.previousEpisode) {
    return { episode: input.availability.previousEpisode, source: "previous" };
  }
  if (input.action === "next-season" && input.availability.nextSeasonEpisode) {
    return { episode: input.availability.nextSeasonEpisode, source: "next-season" };
  }
  return null;
}

export type PostPlaybackTrackPanelSection =
  | "provider"
  | "source"
  | "quality"
  | "audio"
  | "subtitle";

export function resolvePostPlaybackTrackPanelSection(
  routedAction: unknown,
): PostPlaybackTrackPanelSection | null {
  switch (routedAction) {
    case "provider":
    case "source":
    case "quality":
    case "audio":
    case "subtitle":
      return routedAction;
    default:
      return null;
  }
}
