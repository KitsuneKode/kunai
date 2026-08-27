export interface PlayerCapabilities {
  readonly observation: "managed" | "detached";
  readonly customHeaders: boolean;
  readonly externalSubtitles: boolean;
  readonly localFiles: boolean;
  readonly progressEvents: boolean;
}

export const MANAGED_MPV_CAPABILITIES: PlayerCapabilities = Object.freeze({
  observation: "managed",
  customHeaders: true,
  externalSubtitles: true,
  localFiles: true,
  progressEvents: true,
});

export const DETACHED_HANDOFF_CAPABILITIES: PlayerCapabilities = Object.freeze({
  observation: "detached",
  customHeaders: false,
  externalSubtitles: false,
  localFiles: false,
  progressEvents: false,
});
