// playback-run-state.ts — the session-spanning mutable state for a single
// PlaybackPhase.execute() run.
//
// PlaybackPhase.execute() drives two nested loops (the outer episode-iteration
// loop and the inner post-play menu loop). A handful of bindings must survive
// *across* outer-loop iterations and be mutated by both the helper closures and
// the post-play menu: the active session snapshot, the pending start intent, the
// soft provider override, queued source-refresh intent, and the local/offline
// playback bookkeeping. Historically these lived as ~10 loose `let` bindings at
// the top of execute(), which made the data flow implicit and blocked any clean
// extraction of the loop bodies.
//
// Grouping them into one named, documented object makes the run state explicit,
// gives the closures and the menu a single source of truth to mutate, and is the
// prerequisite seam for lifting the loop bodies out of the god method.
import type { PlaybackSessionState } from "@/app/playback/playback-session-controller";
import type { PlaybackStartIntent } from "@/app/playback/playback-start-intent";
import type { SourceRefreshAction } from "@/app/playback/source-refresh-policy";
import type { PlaybackTimingMetadata } from "@/domain/types";

export interface PlaybackRunState {
  /** Current session snapshot; reassigned as the session transitions phases. */
  playbackSession: PlaybackSessionState;
  /** How the next iteration should start the episode (beginning/resume/navigation). */
  pendingStart: PlaybackStartIntent;
  /** Provider override active only for this session, distinct from the configured provider. */
  sessionSoftProviderId: string | null;
  /** Source-refresh intent queued by a menu/recover action for the next resolve. */
  pendingSourceRefreshAction: SourceRefreshAction | null;
  /** Whether the next iteration must recompute the available sources. */
  pendingRecomputeSources: boolean;
  /** Automatic source-recovery attempts spent on the current episode scope. */
  autoSourceRecoverAttempts: number;
  /** Episode scope key the auto-recover attempt counter is bound to. */
  autoRecoverEpisodeKey: string | null;
  /** Source ids already tried during startup stall / fail-to-start failover this episode. */
  triedFailoverSourceIds: string[];
  /** True after an automatic provider hop was spent for this episode failover cascade. */
  startupProviderHopUsed: boolean;
  /** Forced local/online source selection for the next episode, when requested. */
  episodePlaybackSourceOverride: "local" | "online" | null;
  /** Timing metadata for a locally-resolved (offline) episode, when applicable. */
  localEpisodeTiming: PlaybackTimingMetadata | null;
  /** Download job id backing the current local playback, when applicable. */
  localPlaybackJobId: string | null;
}

/**
 * Build the initial run state. Only the two values that have a meaningful
 * starting point (the freshly-created session and the start intent) are
 * required; every other field begins in its "nothing queued" zero value.
 */
export function createPlaybackRunState(init: {
  readonly playbackSession: PlaybackSessionState;
  readonly pendingStart: PlaybackStartIntent;
}): PlaybackRunState {
  return {
    playbackSession: init.playbackSession,
    pendingStart: init.pendingStart,
    sessionSoftProviderId: null,
    pendingSourceRefreshAction: null,
    pendingRecomputeSources: false,
    autoSourceRecoverAttempts: 0,
    autoRecoverEpisodeKey: null,
    triedFailoverSourceIds: [],
    startupProviderHopUsed: false,
    episodePlaybackSourceOverride: null,
    localEpisodeTiming: null,
    localPlaybackJobId: null,
  };
}
