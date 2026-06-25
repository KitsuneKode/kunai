import type { PlaybackSessionMode } from "@/app/playback/playback-session-controller";
import { didPlaybackFailToStart } from "@/app/playback/playback-session-controller";
import type { EpisodeInfo, PlaybackResult, TitleInfo } from "@/domain/types";
import type { PlayerControlService } from "@/infra/player/PlayerControlService";
import type { PlayerService } from "@/infra/player/PlayerService";

/** One automatic re-resolve per episode before surfacing post-play recovery. */
export const MAX_AUTO_SOURCE_RECOVER_ATTEMPTS = 1;

const MPV_TERMINAL_OSD_MS = 12_000;

/**
 * Keep the persistent mpv process only while autoplay-chain will immediately
 * re-resolve and loadfile the same episode (one in-flight auto-recover).
 */
export function shouldKeepPersistentMpvForPlaybackRecovery(
  sessionMode: PlaybackSessionMode,
  autoRecoverAttempts: number,
): boolean {
  return sessionMode === "autoplay-chain" && autoRecoverAttempts < MAX_AUTO_SOURCE_RECOVER_ATTEMPTS;
}

/** Release before post-play when auto-recover is exhausted and playback never started. */
export function shouldReleasePersistentMpvBeforePostPlay(
  result: PlaybackResult,
  autoRecoverExhausted: boolean,
): boolean {
  return autoRecoverExhausted && didPlaybackFailToStart(result);
}

export async function dismissMpvTransitionOverlay(
  playerControl: PlayerControlService,
): Promise<void> {
  const active = playerControl.getActive();
  if (!active?.setEpisodeTransitionLoading) return;
  await active.setEpisodeTransitionLoading(null);
}

export async function notifyMpvTerminalFailure(
  playerControl: PlayerControlService,
  message: string,
): Promise<void> {
  await dismissMpvTransitionOverlay(playerControl);
  const active = playerControl.getActive();
  if (!active?.showOsdMessage) return;
  await active.showOsdMessage(`Kunai · ${message}`, MPV_TERMINAL_OSD_MS);
}

export async function releasePersistentMpvForTerminalFailure(input: {
  player: PlayerService;
  playerControl: PlayerControlService;
  userMessage: string;
  reason: string;
  diagnostics?: {
    record(event: { category: string; message: string; context?: Record<string, unknown> }): void;
  };
}): Promise<void> {
  await notifyMpvTerminalFailure(input.playerControl, input.userMessage);
  await input.player.releasePersistentSession();
  input.diagnostics?.record({
    category: "playback",
    message: "Released persistent mpv after terminal failure",
    context: {
      reason: input.reason,
      userMessage: input.userMessage,
    },
  });
}

/** Episode/movie title string passed to mpv and loading chrome. */
export function formatMpvEpisodeDisplayTitle(title: TitleInfo, episode: EpisodeInfo): string {
  if (title.type === "movie") return title.name;
  return `${title.name} - S${String(episode.season).padStart(2, "0")}E${String(episode.episode).padStart(2, "0")}`;
}

export function shouldAbortPlaybackBeforeLaunch(
  sessionAborted: boolean,
  iterationAborted: boolean,
): boolean {
  return sessionAborted || iterationAborted;
}
