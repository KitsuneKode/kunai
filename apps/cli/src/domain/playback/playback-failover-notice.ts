/**
 * Structured provider/source switch the shell renders as a failover banner.
 * Labels are display names resolved in app code. `preservedSeconds` is null
 * before the first frame and the last trusted position once playback had started.
 */
export interface PlaybackFailoverNotice {
  readonly phase: "startup" | "mid-stream";
  readonly fromLabel: string;
  readonly toLabel: string | null;
  readonly preservedSeconds: number | null;
  readonly tone: "warn" | "error";
}
