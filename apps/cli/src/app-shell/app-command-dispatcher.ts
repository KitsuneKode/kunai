import {
  dispatchActivePlaybackCommand,
  type ActivePlaybackCommandDispatchInput,
  type ActivePlaybackCommandDispatchResult,
} from "./active-playback-command-dispatcher";
import type { ShellAction } from "./types";

export type AppCommandSource = "palette" | "footer" | "hotkey" | "runtime";

export type AppCommandDispatchInput = {
  readonly action: ShellAction;
  readonly source: AppCommandSource;
  readonly activePlayback: ActivePlaybackCommandDispatchInput;
};

export type AppCommandDispatchResult = {
  readonly status: ActivePlaybackCommandDispatchResult;
  readonly surface: "active-playback";
  readonly reason?: string;
};

export async function dispatchAppCommand(
  input: AppCommandDispatchInput,
): Promise<AppCommandDispatchResult> {
  const status = await dispatchActivePlaybackCommand(input.action, input.activePlayback);
  return {
    status,
    surface: "active-playback",
    reason: status === "ignored" ? ignoredActivePlaybackReason(input.action) : undefined,
  };
}

function ignoredActivePlaybackReason(action: ShellAction): string | undefined {
  switch (action) {
    case "next":
      return "No next episode available";
    case "previous":
      return "No previous episode available";
    case "toggle-autoplay":
      return "Autoplay is not available for this item";
    default:
      return undefined;
  }
}
