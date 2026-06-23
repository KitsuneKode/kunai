import type { PlaybackRecommendationRailItem } from "@/app-shell/types";
import { buildPickerActionContext } from "@/app-shell/workflows";
import { mapAnimeDiscoveryResultToProviderNative } from "@/app/anime-provider-mapping";
import type { PhaseContext } from "@/app/Phase";
import { titleInfoFromSearchResult } from "@/app/title-info";
import type { MediaItemIdentity } from "@/domain/media/media-item-identity";
import type { SearchResult } from "@/domain/types";
import { createContainerMediaActionRouter } from "@/services/media-actions/create-container-media-action-router";

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
): Promise<void> {
  return enqueuePostPlaybackRecommendationViaRouter(container, item);
}

async function enqueuePostPlaybackRecommendationViaRouter(
  container: PhaseContext["container"],
  item: PlaybackRecommendationRailItem,
): Promise<void> {
  const router = createContainerMediaActionRouter(container);
  await router.run({
    actionId: "queue-end",
    item: recommendationRailItemToMediaItem(item),
    source: "post-playback-recommendation",
  });
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
  const [item] = items;
  if (!item) return;
  const { openListShell } = await import("../app-shell/ink-shell");
  const actionContext = buildPickerActionContext({
    container,
    taskLabel: `Recommendation: ${item.title}`,
  });
  const titleLabel = `${item.title}${item.year ? ` (${item.year})` : ""}${item.type ? `  ·  ${item.type}` : ""}`;
  const action = await openListShell<RecommendationRailPanelAction>({
    title: item.title,
    subtitle:
      "Recommendation actions  ·  queue is local-only  ·  download confirms before resolving",
    actionContext,
    options: [
      {
        value: { type: "queue" as const, item },
        label: `Queue  ·  ${titleLabel}`,
        detail: "Add to queue without resolving a stream",
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
      { value: { type: "back" as const }, label: "Back" },
    ],
  });
  if (!action || action.type === "back") return;
  if (action.type === "queue") {
    await enqueuePostPlaybackRecommendation(container, action.item);
    return;
  }
  if (action.type === "details") {
    const router = createContainerMediaActionRouter(container, {
      details: {
        open: async () => {
          await openRecommendationDetailsPanel(container, action.item);
        },
      },
    });
    await router.run({
      actionId: "open-details",
      item: recommendationRailItemToMediaItem(action.item),
      source: "post-playback-recommendation",
    });
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

  const router = createContainerMediaActionRouter(container, {
    downloads: {
      queueDownload: async () => {
        await downloadPostPlaybackRecommendation(container, item, mode);
      },
    },
  });
  await router.run({
    actionId: "download",
    item: recommendationRailItemToMediaItem(item),
    source: "post-playback-recommendation",
    confirmedProviderResolution: true,
  });
}

async function downloadPostPlaybackRecommendation(
  container: PhaseContext["container"],
  item: PlaybackRecommendationRailItem,
  mode: "series" | "anime",
): Promise<void> {
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

export function recommendationRailItemToMediaItem(
  item: PlaybackRecommendationRailItem,
): MediaItemIdentity {
  return {
    mediaKind: item.type,
    ...(item.sourceId ? { sourceId: item.sourceId } : {}),
    titleId: item.id,
    title: item.title,
  };
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
