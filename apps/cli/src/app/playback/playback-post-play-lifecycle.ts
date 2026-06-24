import type { EpisodePrefetchHandle } from "@/app/playback/episode-prefetch";
type PlaybackPostPlayContainer = {
  readonly player: {
    releasePersistentSession(): Promise<void>;
  };
  readonly playerControl: {
    consumeLastAction(): unknown;
    consumePendingStreamSelection(): unknown;
    consumePendingEpisodeSelection(): unknown;
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
  await container.player.releasePersistentSession();
}
