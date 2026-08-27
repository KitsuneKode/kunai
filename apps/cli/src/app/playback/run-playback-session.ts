import {
  formatMpvEpisodeDisplayTitle,
  shouldAbortPlaybackBeforeLaunch,
} from "@/app/playback/mpv-session-lifecycle";
import {
  runMpvPlaybackSession,
  type RunMpvPlaybackSessionInput,
} from "@/app/playback/run-mpv-playback-session";
import { isDetachedHandoffResult, type PlaybackResult } from "@/domain/types";
import { PlaybackAbortedError } from "@/infra/player/playback-aborted";

export type RunPlaybackSessionInput = RunMpvPlaybackSessionInput;

/** Routes a playback request without projecting managed-mpv hooks onto a detached player. */
export async function runPlaybackSession(input: RunPlaybackSessionInput): Promise<PlaybackResult> {
  if (input.player.capabilities.observation === "managed") {
    return runMpvPlaybackSession(input);
  }

  if (shouldAbortPlaybackBeforeLaunch(input.sessionAborted, input.iterationAborted)) {
    throw new PlaybackAbortedError("playback aborted before external handoff");
  }

  const result = await input.player.play(input.stream, {
    url: input.stream.url,
    headers: input.stream.headers,
    subtitle: input.stream.subtitle,
    subtitleStatus: input.subtitleStatus,
    displayTitle: formatMpvEpisodeDisplayTitle(input.title, input.episode),
    startAt: input.startAt,
    timing: input.timing,
    correlation: input.correlation,
    localPlaybackSource: input.localPlaybackSource,
    abortSignal: input.playOptions.abortSignal,
  });
  if (!isDetachedHandoffResult(result)) {
    throw new Error("Detached player returned an observed playback result");
  }

  input.hooks.onFeedback({
    detail: "Opened externally",
    note: `${result.handoff.player} via ${result.handoff.launcher} · progress is not tracked`,
  });
  return result;
}
