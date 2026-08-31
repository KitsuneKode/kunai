export type PlaybackTargetCapability = "audio" | "video";

/**
 * A destination selected for one playback handoff. Protocol-specific connection
 * details stay behind the backend that owns the target kind.
 */
export type LocalPlaybackTarget = {
  readonly kind: "local";
  readonly id: "local";
  readonly name: "This device";
  readonly capabilities: readonly ["audio", "video"];
};

export type GoogleCastPlaybackTarget = {
  readonly kind: "google-cast";
  readonly id: string;
  readonly name: string;
  readonly host?: string;
  readonly port?: number;
  readonly modelName?: string;
  readonly capabilities: readonly PlaybackTargetCapability[];
};

export type PlaybackTarget = LocalPlaybackTarget | GoogleCastPlaybackTarget;

export const LOCAL_PLAYBACK_TARGET: LocalPlaybackTarget = {
  kind: "local",
  id: "local",
  name: "This device",
  capabilities: ["audio", "video"],
};
