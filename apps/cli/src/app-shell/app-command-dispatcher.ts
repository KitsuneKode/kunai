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
};

export async function dispatchAppCommand(
  input: AppCommandDispatchInput,
): Promise<AppCommandDispatchResult> {
  const status = await dispatchActivePlaybackCommand(input.action, input.activePlayback);
  return { status, surface: "active-playback" };
}
