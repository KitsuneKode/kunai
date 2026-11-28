export const OFFLINE_CONNECTION_REASON = "needs a connection";

const ONLINE_ONLY_COMMANDS = new Set([
  "trending",
  "recommendation",
  "random",
  "surprise",
  "update",
  "sync",
  "sync-connect-anilist",
  "sync-connect-tmdb",
  "sync-disconnect",
  "watch-online",
]);

type OfflineCommandRow = {
  readonly id: string;
  readonly enabled: boolean;
  readonly reason?: string;
};

/** Offline policy is presentation-independent: disable, never hide, so the
 * palette teaches why an online command is unavailable. */
export function applyOfflineCommandAvailability<T extends OfflineCommandRow>(
  command: T,
  offline: boolean,
): T {
  if (!offline || !ONLINE_ONLY_COMMANDS.has(command.id)) return command;
  return {
    ...command,
    enabled: false,
    reason: command.enabled ? OFFLINE_CONNECTION_REASON : command.reason,
  };
}
