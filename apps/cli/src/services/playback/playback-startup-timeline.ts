export type PlaybackStartupStage =
  | "episode-bootstrap-started"
  | "timing-fetch-started"
  | "episode-context-ready"
  | "resolve-started"
  | "resolve-complete"
  | "timing-wait-started"
  | "timing-ready"
  | "stream-prepared"
  | "media-materialized"
  | "player-launch"
  | "mpv-process-started"
  | "ipc-connected"
  | "player-ready"
  | "subtitle-attached"
  | "first-progress";

export type PlaybackStartupSource = {
  readonly providerId?: string;
  readonly sourceId?: string;
  readonly streamId?: string;
  readonly host?: string;
};

export type PlaybackStartupTimelineMark = {
  readonly stage: PlaybackStartupStage;
  readonly atMs: number;
  readonly elapsedMs: number;
  readonly deltaMs: number;
};

export type PlaybackStartupTimelineSnapshot = {
  readonly startedAtMs: number;
  readonly source?: PlaybackStartupSource;
  readonly marks: readonly PlaybackStartupTimelineMark[];
};

export type PlaybackStartupTimeline = {
  mark(stage: PlaybackStartupStage, atMs?: number): boolean;
  snapshot(): PlaybackStartupTimelineSnapshot;
};

export function createPlaybackStartupTimeline(input: {
  readonly startedAtMs?: number;
  readonly source?: PlaybackStartupSource;
  readonly now?: () => number;
}): PlaybackStartupTimeline {
  const now = input.now ?? Date.now;
  const startedAtMs = input.startedAtMs ?? now();
  const marks: PlaybackStartupTimelineMark[] = [];
  const seen = new Set<PlaybackStartupStage>();

  return {
    mark(stage, atMs = now()) {
      if (seen.has(stage)) return false;
      seen.add(stage);
      const previousAtMs = marks.at(-1)?.atMs ?? startedAtMs;
      marks.push({
        stage,
        atMs,
        elapsedMs: Math.max(0, atMs - startedAtMs),
        deltaMs: Math.max(0, atMs - previousAtMs),
      });
      return true;
    },
    snapshot() {
      return {
        startedAtMs,
        source: input.source,
        marks: [...marks],
      };
    },
  };
}

export function formatPlaybackStartupTimeline(snapshot: PlaybackStartupTimelineSnapshot): string {
  if (snapshot.marks.length === 0) return "no startup marks";
  return snapshot.marks
    .map((mark) => `${mark.stage} ${formatMs(mark.elapsedMs)} (+${formatMs(mark.deltaMs)})`)
    .join(" -> ");
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(Math.round(ms / 100) / 10).toFixed(1)}s`;
}
