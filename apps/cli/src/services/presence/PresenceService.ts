import type { EpisodeInfo, ShellMode, StreamInfo, TitleInfo } from "@/domain/types";

export type PresenceStatus = "disabled" | "idle" | "connecting" | "ready" | "unavailable" | "error";

export type PresencePlaybackActivity = {
  readonly mode: ShellMode;
  readonly title: TitleInfo;
  readonly episode: EpisodeInfo;
  readonly providerId: string;
  readonly stream?: StreamInfo | null;
  readonly startedAtMs: number;
};

export interface PresenceService {
  getStatus(): PresenceStatus;
  updatePlayback(activity: PresencePlaybackActivity): Promise<void>;
  clearPlayback(reason: string): Promise<void>;
  shutdown(): Promise<void>;
}
