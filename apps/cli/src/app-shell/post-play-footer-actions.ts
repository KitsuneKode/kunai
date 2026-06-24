import type { PostPlayState } from "@/domain/playback/post-play-state";

import { formatChord, KEYBINDINGS, type KeyBinding } from "./keybindings";
import type { FooterAction, ShellAction } from "./types";

/**
 * Single source of truth for what the post-play "continue" accelerator (the
 * `post-continue` binding, `n`) resolves to in each post-play state.
 *
 * Both the footer label (`buildPostPlayFooterActions`) and the live key handler
 * (`resolvePostPlayUnhandledInput`) must agree, otherwise the footer advertises
 * "continue"/"next season" while the key silently fires a different action. It
 * returns `null` for states that do not offer a continue action so the key is a
 * deliberate no-op rather than a misleading `next` that dead-ends.
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
  const { canResume, bindings = KEYBINDINGS } = options;

  const command = commandAction(bindings);
  const quit = quitAction(bindings);
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
          actionFromBinding(
            "post-continue",
            resolvePostPlayContinueResult("season-finale", { canResume, hasNextSeason: true }) ??
              "next-season",
            {
              bindings,
              label: "next season",
              primary: true,
            },
          ),
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
      // Autoplay/autoskip/stop-after toggles are demoted to the command palette
      // (still reachable via their direct keybindings) so the persistent footer
      // stays glanceable instead of a wall of session toggles.
      return [
        actionFromBinding(
          "post-continue",
          resolvePostPlayContinueResult("mid-series", { canResume, hasNextSeason: false }) ??
            "next",
          {
            bindings,
            label: "continue",
            primary: true,
          },
        ),
        source,
        actionFromBinding("post-replay", "replay", { bindings }),
        command,
      ];
  }
}
