export interface PlayerCapabilities {
  readonly observation: "managed" | "detached";
  readonly customHeaders: boolean;
  readonly externalSubtitles: boolean;
  readonly localFiles: boolean;
  readonly progressEvents: boolean;
  readonly completion: boolean;
  readonly autoSkip: boolean;
  readonly trackControl: boolean;
  /**
   * The player reports bytes arriving while a stream starts (mpv's demuxer
   * cache, surfaced as `network-sample`). Only then can "nothing arrived in
   * 15 s" end a startup early; a player that cannot tell gets the full budget.
   */
  readonly networkEvidence: boolean;
}

export const MANAGED_MPV_CAPABILITIES: PlayerCapabilities = Object.freeze({
  observation: "managed",
  customHeaders: true,
  externalSubtitles: true,
  localFiles: true,
  progressEvents: true,
  completion: true,
  autoSkip: true,
  trackControl: true,
  networkEvidence: true,
});

export const DETACHED_HANDOFF_CAPABILITIES: PlayerCapabilities = Object.freeze({
  observation: "detached",
  customHeaders: false,
  externalSubtitles: false,
  localFiles: false,
  progressEvents: false,
  completion: false,
  autoSkip: false,
  trackControl: false,
  networkEvidence: false,
});

/**
 * Desktop VLC, observed through its loopback HTTP interface (see
 * `infra/player/vlc/`). Headers reach it through the stream gateway; skips,
 * in-player track picks and the mpv bridge are mpv-only for now.
 */
export const VLC_CAPABILITIES: PlayerCapabilities = Object.freeze({
  observation: "managed",
  customHeaders: true,
  externalSubtitles: true,
  localFiles: true,
  progressEvents: true,
  completion: true,
  autoSkip: false,
  trackControl: false,
});
