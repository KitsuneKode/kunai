import type { PostPlayState } from "@/domain/playback/post-play-state";

import { formatChord, KEYBINDINGS, type KeyBinding } from "./keybindings";
import type { FooterAction, ShellAction } from "./types";

type PostPlayFooterOptions = {
  readonly canResume: boolean;
  readonly autoplayPaused?: boolean;
  readonly autoskipPaused?: boolean;
  readonly stopAfterCurrent?: boolean;
  readonly bindings?: readonly KeyBinding[];
};

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
  | "post-watchlist"
  | "player-autoplay"
  | "player-autoskip"
  | "player-stop-after-current";

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

export function buildPostPlayFooterActions(
  postPlayState: PostPlayState,
  options: PostPlayFooterOptions,
): readonly FooterAction[] {
  const {
    canResume,
    autoplayPaused = false,
    autoskipPaused = false,
    stopAfterCurrent = false,
    bindings = KEYBINDINGS,
  } = options;

  const command = commandAction(bindings);
  const quit = quitAction(bindings);
  const autoplay = actionFromBinding("player-autoplay", "toggle-autoplay", {
    bindings,
    label: autoplayPaused ? "autoplay on" : "autoplay off",
  });
  const autoskip = actionFromBinding("player-autoskip", "toggle-autoskip", {
    bindings,
    label: autoskipPaused ? "autoskip on" : "autoskip off",
  });
  const stopAfter = actionFromBinding("player-stop-after-current", "stop-after-current", {
    bindings,
    label: stopAfterCurrent ? "resume chain" : "stop after",
  });
  const source = actionFromBinding("post-source", "source", { bindings });

  switch (postPlayState.kind) {
    case "did-not-start":
      return [
        actionFromBinding("post-replay", "replay", { bindings, label: "try again", primary: true }),
        actionFromBinding("post-fallback", "fallback", { bindings }),
        source,
        actionFromBinding("post-diagnostics", "diagnostics", { bindings }),
        actionFromBinding("post-search", "search", { bindings }),
        quit,
        command,
      ];
    case "caught-up":
      return [
        actionFromBinding("post-watchlist", "watchlist", { bindings, primary: true }),
        quit,
        command,
      ];
    case "season-finale":
      if (postPlayState.hasNextSeason) {
        return [
          actionFromBinding("post-continue", "next-season", {
            bindings,
            label: "next season",
            primary: true,
          }),
          actionFromBinding("post-replay", "replay", { bindings }),
          quit,
          command,
        ];
      }
      return [
        actionFromBinding("post-search", "search", { bindings, primary: true }),
        actionFromBinding("post-episode", "pick-episode", { bindings }),
        quit,
        command,
      ];
    case "series-complete":
      return [
        actionFromBinding("post-replay", "replay", { bindings }),
        actionFromBinding("post-search", "search", { bindings }),
        quit,
        command,
      ];
    case "mid-series":
    default:
      return [
        actionFromBinding("post-continue", canResume ? "resume" : "next", {
          bindings,
          label: "continue",
          primary: true,
        }),
        autoplay,
        autoskip,
        stopAfter,
        source,
        actionFromBinding("post-replay", "replay", { bindings }),
        command,
      ];
  }
}
