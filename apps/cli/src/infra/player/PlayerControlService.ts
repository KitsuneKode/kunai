export type PlaybackControlAction =
  | "stop"
  | "refresh"
  | "fallback"
  | "reload-subtitles"
  | "next"
  | "previous";

export interface ActivePlayerControl {
  readonly id: string;
  stop(reason?: string): Promise<void>;
  stopCurrentFile?(reason?: string): Promise<void>;
  reloadSubtitles?(): Promise<void>;
}

export interface PlayerControlService {
  setActive(control: ActivePlayerControl | null): void;
  getActive(): ActivePlayerControl | null;
  consumeLastAction(): PlaybackControlAction | null;
  stopCurrentPlayback(reason?: string): Promise<boolean>;
  refreshCurrentPlayback(reason?: string): Promise<boolean>;
  fallbackCurrentPlayback(reason?: string): Promise<boolean>;
  reloadCurrentSubtitles(reason?: string): Promise<boolean>;
  nextCurrentPlayback(reason?: string): Promise<boolean>;
  previousCurrentPlayback(reason?: string): Promise<boolean>;
}
