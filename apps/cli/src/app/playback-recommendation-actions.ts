import type { PlaybackRecommendationRailItem } from "@/app-shell/types";
import { buildPickerActionContext } from "@/app-shell/workflows";
import { mapAnimeDiscoveryResultToProviderNative } from "@/app/anime-provider-mapping";
import type { PhaseContext } from "@/app/Phase";
import { titleInfoFromSearchResult } from "@/app/title-info";
import type { SearchResult } from "@/domain/types";

/**
 * Post-play recommendation rail actions — queue, details, and confirm-then-download.
 * Extracted verbatim from PlaybackPhase (behaviour-preserving module-level cluster):
 * every entry takes `container`/`item`/`mode` explicitly and closes over no playback
 * locals, so it lives cleanly as a sibling. PlaybackPhase imports back what it calls.
 */

export type RecommendationRailPanelAction =
  | { readonly type: "queue"; readonly item: PlaybackRecommendationRailItem }
  | { readonly type: "details"; readonly item: PlaybackRecommendationRailItem }
  | { readonly type: "download"; readonly item: PlaybackRecommendationRailItem }
  | { readonly type: "back" };

export function enqueuePostPlaybackRecommendation(
  container: PhaseContext["container"],
  item: PlaybackRecommendationRailItem,
): void {
  container.queueService.enqueueMediaItem(
    {
      mediaKind: item.type,
      ...(item.sourceId ? { sourceId: item.sourceId } : {}),
      titleId: item.id,
      title: item.title,
    },
    { placement: "end", source: "post-playback-recommendation" },
  );
  container.stateManager.dispatch({
    type: "SET_PLAYBACK_FEEDBACK",
    note: `Queued ${item.title}.`,
  });
}

export async function openPostPlaybackRecommendationActionPanel({
  container,
  items,
  mode,
}: {
  readonly container: PhaseContext["container"];
  readonly items: readonly PlaybackRecommendationRailItem[];
  readonly mode: "series" | "anime";
}): Promise<void> {
  if (items.length === 0) return;
  const { openListShell } = await import("../app-shell/ink-shell");
  const actionContext = buildPickerActionContext({
    container,
    taskLabel: "Recommendation actions",
  });
  const action = await openListShell<RecommendationRailPanelAction>({
    title: "Recommendations",
    subtitle: `${items.length} pick${items.length === 1 ? "" : "s"}  ·  queue is local-only  ·  download confirms before resolving`,
    actionContext,
    options: [
      ...items.flatMap((item) => {
        const titleLabel = `${item.title}${item.year ? ` (${item.year})` : ""}${item.type ? `  ·  ${item.type}` : ""}`;
        return [
          {
            value: { type: "queue" as const, item },
            label: `Queue  ·  ${titleLabel}`,
            detail: "Add to playlist queue without resolving a stream",
          },
          {
            value: { type: "download" as const, item },
            label: `Download  ·  ${titleLabel}`,
            detail: "Confirm before provider resolution  ·  will not autoplay",
          },
          {
            value: { type: "details" as const, item },
            label: `Details  ·  ${titleLabel}`,
            detail: "Show cached metadata  ·  no provider calls",
          },
        ];
      }),
      { value: { type: "back" as const }, label: "Back" },
    ],
  });
  if (!action || action.type === "back") return;
  if (action.type === "queue") {
    enqueuePostPlaybackRecommendation(container, action.item);
    return;
  }
  if (action.type === "details") {
    await openRecommendationDetailsPanel(container, action.item);
    return;
  }
  await confirmAndDownloadPostPlaybackRecommendation(container, action.item, mode);
}

export async function openRecommendationDetailsPanel(
  container: PhaseContext["container"],
  item: PlaybackRecommendationRailItem,
): Promise<void> {
  const { openListShell } = await import("../app-shell/ink-shell");
  await openListShell<number>({
    title: item.title,
    subtitle: "Cached recommendation details · no provider calls",
    actionContext: buildPickerActionContext({
      container,
      taskLabel: `Details: ${item.title}`,
    }),
    options: [
      { value: 0, label: "Type", detail: item.type },
      ...(item.year ? [{ value: 1, label: "Year", detail: item.year }] : []),
      ...(item.sourceId ? [{ value: 2, label: "Source", detail: item.sourceId }] : []),
      ...(item.episodeCount
        ? [{ value: 3, label: "Episodes", detail: String(item.episodeCount) }]
        : []),
      ...(item.overview ? [{ value: 4, label: "Overview", detail: item.overview }] : []),
      { value: -1, label: "Back" },
    ],
  });
}

export async function confirmAndDownloadPostPlaybackRecommendation(
  container: PhaseContext["container"],
  item: PlaybackRecommendationRailItem,
  mode: "series" | "anime",
): Promise<void> {
  const eligibility = container.downloadService.getEnqueueEligibility();
  if (!eligibility.allowed) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: `Download unavailable: ${eligibility.reason}`,
    });
    return;
  }

  const { openListShell } = await import("../app-shell/ink-shell");
  const confirmed = await openListShell<boolean>({
    title: `Download ${item.title}?`,
    subtitle: "This may contact the provider to resolve playable streams. It will not autoplay.",
    actionContext: buildPickerActionContext({
      container,
      taskLabel: `Download: ${item.title}`,
    }),
    options: [
      {
        value: false,
        label: "Back",
        detail: "No provider calls, no download queued",
      },
      {
        value: true,
        label: "Queue download",
        detail: "Resolve provider stream only after this confirmation",
      },
    ],
  });
  if (!confirmed) return;

  const searchResult = recommendationRailItemToSearchResult(item);
  const mapped =
    mode === "anime"
      ? await mapAnimeDiscoveryResultToProviderNative(searchResult, {
          mode,
          providerId: container.stateManager.getState().provider,
          animeLanguageProfile: container.config.animeLanguageProfile,
          providerRegistry: container.providerRegistry,
          signal: AbortSignal.timeout(12_000),
        }).catch(() => searchResult)
      : searchResult;

  const { DownloadOnlyPhase } = await import("@/app/DownloadOnlyPhase");
  await new DownloadOnlyPhase().execute(
    {
      title: titleInfoFromSearchResult(mapped),
    },
    { container, signal: new AbortController().signal },
  );
}

export function recommendationRailItemToSearchResult(
  item: PlaybackRecommendationRailItem,
): SearchResult {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    ...(item.titleAliases ? { titleAliases: item.titleAliases } : {}),
    year: item.year ?? "",
    overview: item.overview ?? "",
    posterPath: item.posterPath ?? null,
    ...(item.sourceId ? { metadataSource: item.sourceId } : {}),
    ...(item.episodeCount ? { episodeCount: item.episodeCount } : {}),
  };
}
