import type { MpvIpcCommandResult } from "./mpv-ipc";
import type { PlayerPlaybackEvent } from "./PlayerService";

export type MpvIpcFailureEvent = Extract<
  PlayerPlaybackEvent,
  { type: "ipc-command-failed" } | { type: "ipc-stalled" }
>;

/**
 * `sub-add` fetches the subtitle over the network before it answers, so a slow
 * subtitle host times the command out while mpv itself is responsive.
 */
export function isSubtitleIpcCommand(command: string): boolean {
  return command === "sub-add" || command === "sub-remove" || command === "sub-reload";
}

/**
 * The playback events a settled mpv command becomes: nothing on success,
 * `ipc-command-failed` on failure, plus `ipc-stalled` on a timeout unless
 * `stallExempt` says that command's timeout says nothing about mpv's health.
 * Shared by the one-shot and persistent mpv emitters.
 */
export function mpvIpcFailureEvents(
  result: MpvIpcCommandResult,
  stallExempt: (command: string) => boolean = () => false,
): readonly MpvIpcFailureEvent[] {
  if (result.ok) return [];
  const command = String(result.command[0] ?? "unknown");
  const failed: MpvIpcFailureEvent = { type: "ipc-command-failed", command, error: result.error };
  if (result.error !== "timeout" || stallExempt(command)) return [failed];
  return [failed, { type: "ipc-stalled", command, error: result.error }];
}
