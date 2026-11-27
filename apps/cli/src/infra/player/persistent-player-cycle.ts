// =============================================================================
// persistent-player-cycle.ts — per-file playback contract inside one mpv process
// =============================================================================

import type {
  PlaybackResult,
  PlaybackTimingMetadata,
  ShellMode,
  SubtitleTrack,
  TitleInfo,
} from "@/domain/types";

import type { MpvUrlKind } from "./mpv-playback-url";
import type { PlayerStatsState } from "./mpv-stats";
import type { PlaybackOutputDriver } from "./playback-output-gate";
import type { MpvRequestedAction } from "./PlayerControlService";
import type { PlayerPlaybackEvent } from "./PlayerService";
import type { SubtitleMediaRequest } from "./subtitle-files";

export type PlayerCycleOptions = {
  displayTitle: string;
  urlKind?: MpvUrlKind;
  subtitleUrlKind?: MpvUrlKind;
  subtitleMedia?: SubtitleMediaRequest;
  audioPreference?: string;
  subtitlePreference?: string;
  primarySubtitle: string | null;
  subtitleTracks?: readonly SubtitleTrack[];
  startAt?: number;
  /** Optional resume offer shown in mpv without automatically seeking. */
  resumePromptAt?: number;
  /** When true, mpv shows resume vs start-over before a manual resume seek. */
  offerResumeStartChoice?: boolean;
  /** Human-readable offset for the prompt (e.g. "12:34"). */
  resumeChoiceTimeLabel?: string;
  timing?: PlaybackTimingMetadata | null;
  autoSkipEnabled?: boolean;
  skipRecap?: boolean;
  skipIntro?: boolean;
  skipPreview?: boolean;
  skipCredits?: boolean;
  autoNextEnabled?: boolean;
  /** When false, sustained mpv A/V drift is observed but never corrected by Kunai. */
  avsyncRecovery?: boolean;
  onPlayerReady?: () => void;
  onPlaybackEvent?: (event: PlayerPlaybackEvent) => void;
  /** Aborts addon preflight waits before the file is handed to mpv. */
  abortSignal?: AbortSignal;
  /** Called when the user presses N or P inside the mpv window. The mpv process
   *  handles the stop itself; the app only needs to record the intent. */
  onMpvActionRequest?: (action: MpvRequestedAction) => void;
  /** Called once when playback reaches the credits prefetch window or the final ~30 s fallback. */
  onNearEof?: () => void;
  shareLinkContext?: {
    readonly mode: ShellMode;
    readonly title: Pick<TitleInfo, "id" | "type" | "name" | "externalIds" | "isAnime">;
    readonly episode?: { readonly season: number; readonly episode: number };
    readonly providerId?: string;
    readonly onCopied?: (result: { readonly url: string; readonly copied: boolean } | null) => void;
  };
};

export type PlayerCycleState = {
  stats: PlayerStatsState;
  resolve: (result: PlaybackResult) => void;
  promise: Promise<PlaybackResult>;
  playerReadyNotified: boolean;
  output: PlaybackOutputDriver;
  lastPlaybackProgressEventAtMs: number;
  lastPlaybackProgressPositionSeconds: number;
  lastPlaybackProgressDurationSeconds: number;
  acceptPlaybackProperties: boolean;
  onPlayerReady?: () => void;
  onPlaybackEvent?: (event: PlayerPlaybackEvent) => void;
};
