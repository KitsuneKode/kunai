import type { EpisodePrefetchHandle } from "@/app/playback/episode-prefetch";
import type { PlaybackTitleSelection } from "@/infra/player/PlayerControlService";
type PlaybackPostPlayContainer = {
  readonly player: {
    releasePersistentSession(): Promise<void>;
  };
  readonly playerControl: {
    consumeLastAction(): unknown;
    consumePendingStreamSelection(): unknown;
    consumePendingEpisodeSelection(): unknown;
    consumePendingTitleSelection(): PlaybackTitleSelection | null;
  };
  readonly stateManager: {
    dispatch(action: { readonly type: "SET_PLAYBACK_STATUS"; readonly status: "idle" }): void;
  };
};

/** Stop background playback work before/after the post-play menu without starting a new mpv. */
export function preparePostPlaybackSurface(
  container: PlaybackPostPlayContainer,
  episodePrefetch: EpisodePrefetchHandle,
  playbackIterationAbort: AbortController,
): void {
  playbackIterationAbort.abort();
  episodePrefetch.suspend("post-playback-menu");
  container.playerControl.consumeLastAction();
  container.playerControl.consumePendingStreamSelection();
  container.playerControl.consumePendingEpisodeSelection();
  container.stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
}

export async function teardownPlaybackForPostPlayExit(
  container: PlaybackPostPlayContainer,
  episodePrefetch: EpisodePrefetchHandle,
  playbackIterationAbort: AbortController,
): Promise<void> {
  preparePostPlaybackSurface(container, episodePrefetch, playbackIterationAbort);
  // The title-switch payload is deliberately not drained by
  // preparePostPlaybackSurface: one armed during the file-stop window has to
  // survive until the post-play menu entry can honour it. Drain whatever is
  // left on the way out instead so it cannot replay against a later session.
  container.playerControl.consumePendingTitleSelection();
  await container.player.releasePersistentSession();
}
