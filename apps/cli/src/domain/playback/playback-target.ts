export type PlaybackTargetCapability = "audio" | "video";

/**
 * A destination selected for one playback handoff. Protocol-specific connection
 * details stay behind the backend that owns the target kind.
 */
export type PlaybackTarget = {
  readonly kind: "local";
  readonly id: "local";
  readonly name: "This device";
  readonly capabilities: readonly ["audio", "video"];
};

export const LOCAL_PLAYBACK_TARGET: PlaybackTarget = {
  kind: "local",
  id: "local",
  name: "This device",
  capabilities: ["audio", "video"],
};
