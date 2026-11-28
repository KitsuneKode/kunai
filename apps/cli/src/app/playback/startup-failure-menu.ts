import type { PlaybackIteration } from "@/app/playback/playback-iteration";
import { presentStartupPlaybackFailure } from "@/app/playback/playback-phase-feedback";
import type { PlaybackRunState } from "@/app/playback/playback-run-state";
import type { PostPlaybackMenuDeps } from "@/app/playback/run-post-playback-menu";
import { streamSelectionFromTrackPick } from "@/app/playback/source-quality";
import type { Container } from "@/container";
import { buildPlayerFailureProblem } from "@/domain/playback/playback-problem";
import type { EpisodeInfo, PlaybackResult, StreamInfo, TitleInfo } from "@/domain/types";
import { classifyPlaybackFailureFromResult } from "@/infra/player/playback-failure-classifier";

export type StartupFailurePanelResult = "recompute" | "restart" | "exit";

/**
 * Total startup failure stays on the playback-issue panel. Tracks opens only
 * when the panel asks for it.
 */
export async function settleStartupFailurePanel(input: {
  readonly run: PlaybackRunState;
  readonly iteration: PlaybackIteration;
  readonly deps: PostPlaybackMenuDeps;
  readonly result: PlaybackResult;
  readonly preparedStream: StreamInfo;
  readonly container: Container;
  readonly signal: AbortSignal;
  readonly currentEpisode: EpisodeInfo;
  readonly resolvedProviderId: string;
  readonly resumeSeconds: number;
  readonly title: TitleInfo;
}): Promise<StartupFailurePanelResult> {
  const {
    run,
    deps,
    result,
    preparedStream,
    container,
    signal,
    currentEpisode,
    resolvedProviderId,
    resumeSeconds,
    title,
  } = input;
  if (!preparedStream.providerResolveResult?.streams.length) {
    run.pendingRecomputeSources = true;
    run.pendingSourceRefreshAction = "recover";
    return "recompute";
  }
  const failureClass = classifyPlaybackFailureFromResult(result);
  const problem = buildPlayerFailureProblem(failureClass === "none" ? "unknown" : failureClass);
  let decision = await presentStartupPlaybackFailure({ container, signal, problem });
  while (decision === "tracks") {
    const picked = await deps.openTracksPanel(
      preparedStream,
      {
        initialSection: "source",
        failedCurrentReason: result.suspectedDeadStream
          ? "Playback failed on this stream."
          : "Playback did not start on this stream.",
      },
      container,
    );
    const selection = picked ? streamSelectionFromTrackPick(picked) : null;
    if (picked && (selection || picked.section === "subtitle")) {
      const trackStart = await deps.completeSourceTrackPick(
        currentEpisode,
        picked,
        selection,
        resumeSeconds,
        "post-playback-tracks",
      );
      if (trackStart) {
        run.pendingStart = trackStart;
        run.playbackSession = deps.transitionPlaybackSession(
          run.playbackSession,
          "recovery-started",
          {
            titleId: title.id,
            season: currentEpisode.season,
            episode: currentEpisode.episode,
            provider: resolvedProviderId,
            action: "recover",
          },
        );
        container.stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "loading" });
        return "restart";
      }
    }
    decision = await presentStartupPlaybackFailure({ container, signal, problem });
  }
  if (decision === "retry") {
    run.pendingSourceRefreshAction = "recover";
    return "restart";
  }
  await deps.teardownPlaybackForPostPlayExit();
  return "exit";
}
