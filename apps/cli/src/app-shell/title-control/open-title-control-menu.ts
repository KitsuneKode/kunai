import type { ShellAction } from "@/app-shell/types";
import type { Container } from "@/container";
import type { PostPlayState } from "@/domain/playback/post-play-state";
import { providerLaneMatchesMode } from "@/domain/provider-lane";
import type { SessionState } from "@/domain/session/SessionState";
import { isFinished } from "@/services/continuation/history-progress";
import type { MediaKind } from "@kunai/types";

import type { TitleControlContext, TitleControlSurface } from "./title-control-actions";
import { buildTitleControlActions } from "./title-control-actions";
import {
  applyTitleControlMenuExpand,
  buildTitleControlMenuModel,
  isTitleControlMenuExpandToken,
  titleControlMenuOptions,
  type TitleControlMenuExpandToken,
  type TitleControlMenuGroupId,
} from "./title-control-menu";

export function buildTitleControlContext(
  state: SessionState,
  surface: TitleControlSurface,
  options: {
    readonly postPlayState?: PostPlayState;
    readonly providerCount?: number;
    readonly failedProvider?: boolean;
    readonly cancellable?: boolean;
    readonly titleName?: string;
    readonly hasTitle?: boolean;
    readonly hasSavedPosition?: boolean;
    readonly hasHistory?: boolean;
    readonly historyFinished?: boolean;
    readonly canResume?: boolean;
  } = {},
): TitleControlContext {
  const title = state.currentTitle;

  return {
    surface,
    titleName: options.titleName ?? title?.name,
    titleType: title?.type,
    isAnime: state.mode === "anime" || title?.isAnime === true,
    hasTitle: options.hasTitle ?? Boolean(title),
    hasHistory: options.hasHistory ?? false,
    hasSavedPosition: options.hasSavedPosition ?? false,
    historyFinished: options.historyFinished ?? false,
    hasNextEpisode: state.episodeNavigation.hasNext,
    hasPreviousEpisode: state.episodeNavigation.hasPrevious,
    hasNextSeason: state.episodeNavigation.hasNextSeason,
    seriesComplete: options.postPlayState?.kind === "series-complete",
    seasonCount: undefined,
    isFirstWatch: !(options.hasHistory ?? false),
    providerCount: options.providerCount,
    providerName: state.provider,
    failedProvider: options.failedProvider,
    isLoading:
      state.playbackStatus === "loading" ||
      state.playbackStatus === "ready" ||
      state.playbackStatus === "buffering",
    isPlaying: state.playbackStatus === "playing",
    cancellable: options.cancellable,
    hasStreamCandidates: Boolean(state.stream?.providerResolveResult?.streams.length),
    hasResolvedStream: Boolean(state.stream?.url),
    postPlayKind: options.postPlayState?.kind,
    canResume:
      options.canResume ??
      (options.postPlayState
        ? options.postPlayState.kind === "mid-series"
        : Boolean(options.hasSavedPosition)),
  };
}

export function buildTitleControlContextFromContainer(
  container: Container,
  surface: TitleControlSurface,
  options: {
    readonly postPlayState?: PostPlayState;
    readonly cancellable?: boolean;
    readonly titleName?: string;
    readonly hasTitle?: boolean;
    readonly canResume?: boolean;
  } = {},
): TitleControlContext {
  const state = container.stateManager.getState();
  const title = state.currentTitle;
  const episode = state.currentEpisode;
  const providers = container.providerRegistry
    .getAll()
    .filter((provider) => providerLaneMatchesMode(provider.metadata.providerLane, state.mode));
  const providerHealth = container.providerHealth.get(state.provider);
  const failedProvider = providerHealth?.status === "degraded" || providerHealth?.status === "down";

  let hasHistory = false;
  let hasSavedPosition = false;
  let historyFinished = false;

  if (title) {
    const kind: MediaKind =
      state.mode === "anime" || title.isAnime
        ? "anime"
        : title.type === "movie"
          ? "movie"
          : "series";
    const latest = container.historyRepository.getLatestForTitleIdentity({
      id: title.id,
      kind,
      externalIds: title.externalIds,
    });
    if (latest) {
      hasHistory = true;
      historyFinished = isFinished(latest);
      hasSavedPosition = latest.positionSeconds > 0 && !historyFinished;
    } else if (episode) {
      const scoped = container.historyRepository.getProgress(
        {
          id: title.id,
          kind,
          title: title.name,
          externalIds: title.externalIds,
        },
        { season: episode.season, episode: episode.episode },
      );
      if (scoped) {
        hasHistory = true;
        historyFinished = isFinished(scoped);
        hasSavedPosition = scoped.positionSeconds > 0 && !historyFinished;
      }
    }
  }

  return buildTitleControlContext(state, surface, {
    ...options,
    providerCount: providers.length,
    failedProvider,
    hasHistory,
    hasSavedPosition,
    historyFinished,
  });
}

type TitleControlMenuOptions = {
  readonly postPlayState?: PostPlayState;
  readonly cancellable?: boolean;
  readonly titleName?: string;
  readonly hasTitle?: boolean;
  readonly canResume?: boolean;
};

/** Present title control and return the picked shell action without executing it. */
export async function pickTitleControlShellAction(
  container: Container,
  surface: TitleControlSurface,
  options: TitleControlMenuOptions = {},
): Promise<ShellAction | null> {
  const ctx = buildTitleControlContextFromContainer(container, surface, options);
  if (!ctx.hasTitle && (surface === "browse" || surface === "library")) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: "Select a title before opening the menu.",
    });
    return null;
  }

  const { openListShell } = await import("@/app-shell/ink-shell");
  const { buildPickerActionContext } = await import("@/app-shell/workflows");

  let expanded = new Set<TitleControlMenuGroupId>();
  while (true) {
    const model = buildTitleControlMenuModel(ctx);
    const menuOptions = titleControlMenuOptions(model, expanded);
    if (menuOptions.length === 0) {
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note: "No title actions are available right now.",
      });
      return null;
    }

    const picked = await openListShell<TitleControlActionPick | TitleControlMenuExpandToken>({
      title: model.title,
      subtitle: model.subtitle,
      options: menuOptions.map((option) => ({
        value: option.value,
        label: option.label,
        detail: option.detail,
        disabled: option.disabled,
      })),
      actionContext: buildPickerActionContext({
        container,
        taskLabel: "Title control",
      }),
    });

    if (!picked) return null;
    if (isTitleControlMenuExpandToken(picked)) {
      expanded = applyTitleControlMenuExpand(picked, expanded) as Set<TitleControlMenuGroupId>;
      continue;
    }

    const action = buildTitleControlActions(ctx).find((candidate) => candidate.id === picked);
    if (!action?.enabled || !action.shellAction) {
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note: action?.reason ?? "That action is not available right now.",
      });
      return null;
    }

    return action.shellAction;
  }
}

export async function openTitleControlMenu(
  container: Container,
  surface: TitleControlSurface,
  options: TitleControlMenuOptions = {},
): Promise<"handled" | "unhandled" | "quit"> {
  const shellAction = await pickTitleControlShellAction(container, surface, options);
  if (!shellAction) return "handled";

  const { handleShellAction } = await import("@/app-shell/workflows");
  const result = await handleShellAction({ action: shellAction, container });
  return typeof result === "string" ? result : "handled";
}

type TitleControlActionPick = import("./title-control-actions").TitleControlActionId;
