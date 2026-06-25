import type { EpisodeAvailability } from "@/domain/playback/playback-policy";
import type { PostPlayState } from "@/domain/playback/post-play-state";

import { formatChord, KEYBINDINGS, type KeyBinding } from "../keybindings";
import type { FooterAction, ShellAction } from "../types";
import type { TitleControlActionId, TitleControlContext } from "./title-control-actions";
import { buildTitleControlActions } from "./title-control-actions";

/**
 * Single source of truth for what the post-play "continue" accelerator (the
 * `post-continue` binding, `n`) resolves to in each post-play state.
 */
export function resolvePostPlayContinueResult(
  kind: PostPlayState["kind"],
  options: { readonly canResume: boolean; readonly hasNextSeason: boolean },
): ShellAction | null {
  switch (kind) {
    case "mid-series":
      return options.canResume ? "resume" : "next";
    case "season-finale":
      return options.hasNextSeason ? "next-season" : null;
    default:
      return null;
  }
}

/** TC4: auto-present Title Control once on terminal / end-of-catalog post-play states. */
export function shouldAutoPresentTitleControlForPostPlay(
  postPlayState: PostPlayState,
  availability: EpisodeAvailability,
): boolean {
  switch (postPlayState.kind) {
    case "caught-up":
    case "season-finale":
    case "series-complete":
      return true;
    case "mid-series":
      return !availability.nextEpisode && !availability.nextSeasonEpisode;
    default:
      return false;
  }
}

type PostPlayBindingId =
  | "command-palette"
  | "post-continue"
  | "post-diagnostics"
  | "post-episode"
  | "post-fallback"
  | "post-quit"
  | "post-replay"
  | "post-search"
  | "post-source"
  | "post-title-control-menu"
  | "post-watchlist";

export const TITLE_CONTROL_POST_PLAY_BINDING_ID: Partial<
  Record<TitleControlActionId, PostPlayBindingId>
> = {
  resume: "post-continue",
  restart: "post-replay",
  next: "post-continue",
  "next-season": "post-continue",
  recover: "post-replay",
  fallback: "post-fallback",
  source: "post-source",
  diagnostics: "post-diagnostics",
  search: "post-search",
  "pick-episode": "post-episode",
  watchlist: "post-watchlist",
};

type PostPlayFooterSpec = {
  readonly actionId: TitleControlActionId;
  readonly label?: string;
  readonly primary?: boolean;
  readonly bindingId?: PostPlayBindingId;
};

export type PostPlayFooterBuildOptions = {
  readonly canResume: boolean;
  readonly hasNextEpisode?: boolean;
  readonly hasNextSeason?: boolean;
  readonly providerCount?: number;
  readonly bindings?: readonly KeyBinding[];
};

function actionFromBinding(
  id: PostPlayBindingId,
  action: ShellAction,
  options: {
    readonly bindings: readonly KeyBinding[];
    readonly label?: string;
    readonly primary?: boolean;
  },
): FooterAction {
  const binding = options.bindings.find((candidate) => candidate.id === id);
  return {
    key: binding ? formatChord(binding.chord).toLowerCase() : "",
    label: options.label ?? binding?.hintLabel ?? binding?.label ?? action,
    action,
    primary: options.primary,
  };
}

function commandAction(bindings: readonly KeyBinding[]): FooterAction {
  return actionFromBinding("command-palette", "command-mode", { bindings });
}

function quitAction(bindings: readonly KeyBinding[]): FooterAction {
  return actionFromBinding("post-quit", "quit", { bindings });
}

function resolvePostPlayFooterSpecs(
  postPlayState: PostPlayState,
  options: PostPlayFooterBuildOptions,
): readonly PostPlayFooterSpec[] {
  const { canResume } = options;

  switch (postPlayState.kind) {
    case "did-not-start":
      return [
        { actionId: "restart", label: "try again", primary: true },
        { actionId: "fallback" },
        { actionId: "source" },
        { actionId: "diagnostics" },
        { actionId: "search" },
      ];
    case "caught-up":
      return [{ actionId: "watchlist", primary: true }];
    case "season-finale":
      if (postPlayState.hasNextSeason) {
        return [
          {
            actionId: "next-season",
            label: "next season",
            primary: true,
          },
          { actionId: "restart" },
        ];
      }
      return [{ actionId: "search", primary: true }, { actionId: "pick-episode" }];
    case "series-complete":
      return [{ actionId: "restart" }, { actionId: "search" }];
    case "mid-series":
    default: {
      const continueAction = resolvePostPlayContinueResult("mid-series", {
        canResume,
        hasNextSeason: false,
      });
      const continueId: TitleControlActionId = continueAction === "resume" ? "resume" : "next";
      return [
        {
          actionId: continueId,
          label: canResume ? "resume" : "continue",
          primary: true,
        },
        { actionId: "source" },
        { actionId: "restart", label: "replay" },
      ];
    }
  }
}

function menuAction(bindings: readonly KeyBinding[]): FooterAction {
  return actionFromBinding("post-title-control-menu", "menu", { bindings });
}

export function buildPostPlayTitleControlContext(
  postPlayState: PostPlayState,
  options: PostPlayFooterBuildOptions,
): TitleControlContext {
  const hasNextSeason =
    postPlayState.kind === "season-finale"
      ? postPlayState.hasNextSeason
      : (options.hasNextSeason ?? false);

  return {
    surface: "post-play",
    canResume: options.canResume,
    hasNextEpisode: options.hasNextEpisode ?? false,
    hasNextSeason,
    seriesComplete: postPlayState.kind === "series-complete",
    postPlayKind: postPlayState.kind,
    hasStreamCandidates: true,
    hasResolvedStream: true,
    providerCount: options.providerCount ?? 1,
  };
}

/** Footer actions derived from the title-control selector for post-play surfaces. */
export function buildPostPlayFooterActionsFromTitleControl(
  postPlayState: PostPlayState,
  options: PostPlayFooterBuildOptions,
): readonly FooterAction[] {
  const { bindings = KEYBINDINGS } = options;
  const ctx = buildPostPlayTitleControlContext(postPlayState, options);
  const actionsById = new Map(buildTitleControlActions(ctx).map((action) => [action.id, action]));
  const specs = resolvePostPlayFooterSpecs(postPlayState, options);

  const primaryActions = specs.flatMap((spec) => {
    const titleAction = actionsById.get(spec.actionId);
    const shellAction = titleAction?.shellAction;
    if (!shellAction) return [];

    const bindingId = spec.bindingId ?? TITLE_CONTROL_POST_PLAY_BINDING_ID[spec.actionId];
    if (!bindingId) return [];

    return [
      actionFromBinding(bindingId, shellAction, {
        bindings,
        ...(spec.label ? { label: spec.label } : {}),
        primary: spec.primary,
      }),
    ];
  });

  const trailing = postPlayState.kind === "mid-series" ? [] : [quitAction(bindings)];
  return [...primaryActions, menuAction(bindings), ...trailing, commandAction(bindings)];
}
