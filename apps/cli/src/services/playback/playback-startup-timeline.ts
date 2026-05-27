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

export type StartupPhase = "resolve" | "prepare" | "launch" | "first-frame";

export type StartupPhaseBreakdown = {
  /** Provider scrape/cache: resolve-started → resolve-complete. */
  readonly resolveMs: number;
  /** Stream + timing prep: resolve-complete → player-launch. */
  readonly prepareMs: number;
  /** mpv process spawn + IPC handshake: player-launch → ipc-connected (or mpv-process-started). */
  readonly launchMs: number;
  /** mpv buffer to first visible frame: process-started → first-progress. */
  readonly firstFrameMs: number;
  readonly totalMs: number;
  /** The single phase that dominated this startup — the thing to optimize. */
  readonly dominant: StartupPhase;
};

/**
 * Bucket a startup timeline into the four phases that make autonext feel slow,
 * so logs name the dominant cost (resolve vs spawn vs buffering) instead of
 * dumping fifteen stages. Returns null until a first frame is observed.
 */
export function summarizeStartupPhases(
  snapshot: PlaybackStartupTimelineSnapshot,
): StartupPhaseBreakdown | null {
  const at = (stage: PlaybackStartupStage): number | undefined =>
    snapshot.marks.find((mark) => mark.stage === stage)?.elapsedMs;

  const resolveStart = at("resolve-started");
  const resolveDone = at("resolve-complete");
  const launch = at("player-launch");
  const processStarted = at("mpv-process-started");
  const ipc = at("ipc-connected") ?? at("player-ready") ?? processStarted;
  const firstFrame = at("first-progress");
  if (firstFrame === undefined || processStarted === undefined) return null;

  const span = (from?: number, to?: number): number =>
    from === undefined || to === undefined ? 0 : Math.max(0, to - from);

  const resolveMs = span(resolveStart, resolveDone);
  const prepareMs = span(resolveDone, launch ?? processStarted);
  const launchMs = span(launch ?? processStarted, ipc);
  const firstFrameMs = span(processStarted, firstFrame);

  const phases: ReadonlyArray<readonly [StartupPhase, number]> = [
    ["resolve", resolveMs],
    ["prepare", prepareMs],
    ["launch", launchMs],
    ["first-frame", firstFrameMs],
  ];
  const dominant = phases.reduce((a, b) => (b[1] > a[1] ? b : a))[0];

  return { resolveMs, prepareMs, launchMs, firstFrameMs, totalMs: firstFrame, dominant };
}

export function formatStartupPhaseBreakdown(breakdown: StartupPhaseBreakdown): string {
  return (
    `resolve ${formatMs(breakdown.resolveMs)} · prepare ${formatMs(breakdown.prepareMs)} · ` +
    `launch ${formatMs(breakdown.launchMs)} · first-frame ${formatMs(breakdown.firstFrameMs)} ` +
    `(total ${formatMs(breakdown.totalMs)}, dominant: ${breakdown.dominant})`
  );
}
