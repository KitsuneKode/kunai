import type { PlaybackFailoverNotice } from "@/domain/playback/playback-failover-notice";
import { formatTimestamp } from "@/services/continuation/history-progress";

export interface PlaybackFailoverBannerModel {
  readonly phase: "startup" | "mid-stream";
  readonly fromLabel: string;
  readonly toLabel: string | null;
  readonly preservedSeconds: number | null;
  readonly tone: "warn" | "error";
}

export function failoverBannerModel(notice: PlaybackFailoverNotice): PlaybackFailoverBannerModel {
  return {
    phase: notice.phase,
    fromLabel: notice.fromLabel,
    toLabel: notice.toLabel,
    preservedSeconds: notice.preservedSeconds,
    tone: notice.tone,
  };
}

export type FailoverBannerCopy = {
  readonly headline: string;
  readonly detail: string | null;
};

export function failoverBannerCopy(model: PlaybackFailoverBannerModel): FailoverBannerCopy {
  const headline =
    model.toLabel && model.toLabel !== model.fromLabel
      ? `Switching from ${model.fromLabel} to ${model.toLabel}`
      : `Switching from ${model.fromLabel}`;
  const detail =
    model.preservedSeconds === null
      ? null
      : `Holding position at ${formatTimestamp(model.preservedSeconds)}`;
  return { headline, detail };
}
