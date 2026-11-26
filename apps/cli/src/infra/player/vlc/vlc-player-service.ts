import { rm } from "node:fs/promises";

import type { PlaybackGeneration } from "@/domain/playback/playback-generation";
import { VLC_CAPABILITIES } from "@/domain/playback/player-capabilities";
import type { PlaybackResult, StreamInfo } from "@/domain/types";
import { createPrivateTempDir } from "@/infra/fs/temp-dir";
import { scrubbedChildEnv } from "@/infra/os/child-env";
import type { LocalPlaybackSource } from "@/services/offline/local-playback-source";
import { materializeDeferredMediaDocument } from "@/services/playback/deferred-media-materializer";
import {
  checkStremioPlaybackPreflight,
  isStremioPlayback,
} from "@/services/playback/stream-health-check";
import { isJsonString, type JsonValue } from "@kunai/types";

import {
  createPlaybackProgressThrottleState,
  shouldEmitPlaybackProgress,
} from "../mpv-playback-kernel";
import { isAllowedMpvUrl } from "../mpv-playback-url";
import {
  applyEndFileEvent,
  createPlayerStatsState,
  finalizePlaybackResult,
  recordPlayerExit,
} from "../mpv-stats";
import { resolveNearEofPrefetchTriggerSeconds } from "../persistent-ready-work-policy";
import { createPlaybackOutputDriver, type createPlaybackOutputGate } from "../playback-output-gate";
import { createPlaybackWatchdog } from "../playback-watchdog";
import { buildPlaybackStatsSnapshot } from "../PlaybackStatsSnapshot";
import type { ActivePlayerControl, PlayerControlService } from "../PlayerControlService";
import type {
  PlayerOptions,
  PlayerPlaybackEvent,
  PlayerPlaybackEventEnvelope,
  PlayerService,
} from "../PlayerService";
import { getSharedStreamGateway, type GatewaySession } from "../stream-gateway";
import { createVlcSkipTracker, vlcSeekTarget } from "./vlc-auto-skip";
import {
  buildVlcArgs,
  buildVlcInPlayQuery,
  discoverVlcBinary,
  userVlcConfigPath,
  writeVlcSessionConfig,
  type VlcItem,
} from "./vlc-launch";
import { applyVlcStatus, parseVlcStatus, vlcTrackList, type VlcStatus } from "./vlc-status";

/** Raised before VLC owns playback, with the remediation the user needs. */
export class VlcLaunchError extends Error {
  override readonly name = "VlcLaunchError";
  constructor(
    readonly kind: "dependency" | "unsupported-stream" | "no-control",
    message: string,
  ) {
    super(message);
  }
}

type VlcProcess = {
  readonly exited: Promise<number>;
  readonly signalCode?: NodeJS.Signals | number | null;
  kill(signal?: NodeJS.Signals | number): void;
};

/** Every outside effect, injectable so the whole lifecycle is testable without VLC. */
export type VlcRuntime = {
  readonly discover: () => string | null;
  readonly spawn: (argv: readonly string[]) => VlcProcess;
  /** GET a JSON document from VLC's control interface; null on any failure. */
  readonly getJson: (url: string, headers: Record<string, string>) => Promise<JsonValue | null>;
  readonly freePort: () => Promise<number>;
  readonly makeSessionDir: () => Promise<string>;
  readonly removeSessionDir: (dir: string) => Promise<void>;
  readonly userConfigPath: () => string;
  readonly setTimeout: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  readonly clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
  readonly now: () => number;
  /** Extra argv for headless runs (`--intf=dummy`, `--vout=dummy`); empty normally. */
  readonly extraArgs?: readonly string[];
  /** One output gate per playback; native tests inject a short decode grace. */
  readonly createPlaybackOutputGate?: typeof createPlaybackOutputGate;
};

async function freeLoopbackPort(): Promise<number> {
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const { port } = listener;
  listener.stop(true);
  return port;
}

export const defaultVlcRuntime: VlcRuntime = {
  discover: () => discoverVlcBinary(),
  // Shell secrets never reach VLC or its Lua extensions, as with mpv.
  spawn: (argv) =>
    Bun.spawn([...argv], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      env: scrubbedChildEnv(),
    }),
  getJson: async (url, headers) => {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(1_500) });
      if (!response.ok) return null;
      const body: JsonValue = JSON.parse(await response.text());
      return body;
    } catch {
      return null;
    }
  },
  freePort: freeLoopbackPort,
  makeSessionDir: async () => await createPrivateTempDir("vlc"),
  removeSessionDir: async (dir) => await rm(dir, { recursive: true, force: true }),
  userConfigPath: () => userVlcConfigPath(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle),
  now: () => Date.now(),
};

const POLL_INTERVAL_MS = 500;
/** VLC must answer its control interface within this, or Kunai cannot observe it. */
const CONTROL_READY_TIMEOUT_MS = 15_000;
/** Within this of the end, a file that stops on its own finished. */
const NATURAL_END_SLACK_SECONDS = 3;
/**
 * A file VLC was told to play but that stays "stopped" this long never opened.
 * Right after `in_play` the status can still describe the stopped previous
 * file, so one stopped poll is not yet a failure.
 */
const OPEN_GRACE_MS = 3_000;
/** A released VLC that ignores SIGTERM this long is killed. */
const RELEASE_KILL_AFTER_MS = 2_000;

/**
 * One VLC process. In autoplay-chain mode it is started with
 * `--play-and-stop`, so the window outlives a file and the next episode plays
 * in it through `in_play`; otherwise VLC exits with its file.
 */
type VlcSession = {
  readonly proc: VlcProcess;
  readonly process: number;
  cycle: number;
  readonly keepOpen: boolean;
  readonly statusUrl: string;
  readonly headers: Record<string, string>;
  connected: boolean;
  exited: boolean;
  exitCode: number | null;
  readonly dispose: () => Promise<void>;
};

/**
 * Desktop VLC as an observed player. Kunai adds a loopback HTTP control
 * interface and otherwise leaves VLC's own window, hotkeys and settings alone.
 * Streams that need provider headers or a generated manifest go through the
 * same loopback gateway Android handoff uses, so the request VLC makes is the
 * request the resolve gate probed.
 */
export class VlcPlayerService implements PlayerService {
  readonly capabilities = VLC_CAPABILITIES;
  private shuttingDown = false;
  private process = 0;
  private session: VlcSession | null = null;
  private fileInFlight = false;

  constructor(
    private readonly deps: {
      readonly playerControl: Pick<PlayerControlService, "setActive" | "getActive">;
      readonly runtime?: VlcRuntime;
    },
  ) {}

  private get runtime(): VlcRuntime {
    return this.deps.runtime ?? defaultVlcRuntime;
  }

  async isAvailable(): Promise<boolean> {
    return this.runtime.discover() !== null;
  }

  /** Close the window kept open for the next episode (post-play, exit, a new title). */
  async releasePersistentSession(): Promise<void> {
    const session = this.session;
    if (!session || this.fileInFlight) return;
    this.session = null;
    await this.endSession(session);
  }

  killActiveMpvProcessesSync(): void {
    this.session?.proc.kill("SIGKILL");
  }

  beginShutdown(): void {
    this.shuttingDown = true;
  }

  async playLocal(options: {
    source: LocalPlaybackSource;
    startAt?: number;
    onPlayerReady?: () => void;
    onGenerationActivated?: (generation: PlaybackGeneration) => void;
    onPlaybackEvent?: (input: PlayerPlaybackEventEnvelope) => void;
  }): Promise<PlaybackResult> {
    const stream: StreamInfo = {
      url: options.source.filePath,
      headers: {},
      subtitle: options.source.subtitlePath,
      timestamp: this.runtime.now(),
    };
    return await this.play(stream, {
      url: stream.url,
      displayTitle: options.source.titleName,
      localPlaybackSource: options.source,
      startAt: options.startAt,
      onPlayerReady: options.onPlayerReady,
      onGenerationActivated: options.onGenerationActivated,
      onPlaybackEvent: options.onPlaybackEvent,
    });
  }

  async play(stream: StreamInfo, options: PlayerOptions): Promise<PlaybackResult> {
    if (this.shuttingDown) throw new VlcLaunchError("no-control", "The player is shutting down.");
    if (options.abortSignal?.aborted) throw new DOMException("playback aborted", "AbortError");
    if (this.fileInFlight) {
      throw new VlcLaunchError("no-control", "VLC is already playing a file for Kunai.");
    }
    if (stream.requiresYtdl) {
      throw new VlcLaunchError(
        "unsupported-stream",
        "This stream needs yt-dlp, which VLC cannot run. Play it with --player mpv.",
      );
    }
    // The same target rule as mpv: provider URLs are HTTP(S) only; files only
    // from the verified local library.
    const local = options.localPlaybackSource;
    const subtitle = stream.subtitle?.trim();
    if (
      !isAllowedMpvUrl(stream.url, local ? "local" : "remote") ||
      (subtitle &&
        !isAllowedMpvUrl(subtitle, local?.subtitlePath === subtitle ? "local" : "remote"))
    ) {
      throw new VlcLaunchError(
        "unsupported-stream",
        "Refusing to open an unsafe stream URL in VLC.",
      );
    }

    const keepOpen = options.playbackMode === "autoplay-chain";
    const previous = this.session;
    const reuse = keepOpen && previous !== null && previous.keepOpen && !previous.exited;
    const binary = reuse ? null : this.runtime.discover();
    if (!reuse && !binary) {
      throw new VlcLaunchError("dependency", "VLC is not installed or was not found.");
    }

    // Publish the generation before the first await, as mpv does: reusing the
    // window keeps the process number and takes the next cycle.
    let generation: PlaybackGeneration;
    if (reuse && previous) {
      previous.cycle += 1;
      generation = { process: previous.process, cycle: previous.cycle };
    } else {
      this.process += 1;
      generation = { process: this.process, cycle: 1 };
    }
    options.onGenerationActivated?.(generation);
    const emit = (event: PlayerPlaybackEvent) => options.onPlaybackEvent?.({ generation, event });

    this.fileInFlight = true;
    const cleanups: Array<() => Promise<void> | void> = [];
    let session: VlcSession | null = reuse ? previous : null;
    try {
      if (!reuse && previous) {
        this.session = null;
        await this.endSession(previous);
      }
      const target = await this.prepareTarget(stream, options, cleanups);
      const item: VlcItem = {
        url: target.url,
        title: options.displayTitle,
        startAtSeconds: options.startAt,
        subtitle: target.subtitle,
      };
      if (session) {
        // A window that closed between the check and this command answers
        // nothing; the file then ends as "could not open" and recovery runs.
        await this.runtime.getJson(
          `${session.statusUrl}?${buildVlcInPlayQuery(item)}`,
          session.headers,
        );
      } else {
        emit({ type: "launching-player" });
        session = await this.launch(binary ?? "", item, keepOpen, generation.process);
        this.session = session;
      }
      return await this.observe({ session, generation, emit, options });
    } finally {
      this.fileInFlight = false;
      for (const cleanup of cleanups.reverse()) {
        await Promise.resolve(cleanup()).catch(() => {});
      }
      if (session && (session.exited || !session.keepOpen)) {
        if (this.session === session) this.session = null;
        await this.endSession(session);
      }
    }
  }

  private async launch(
    binary: string,
    item: VlcItem,
    keepOpen: boolean,
    processNumber: number,
  ): Promise<VlcSession> {
    const dir = await this.runtime.makeSessionDir();
    let disposed = false;
    const dispose = async () => {
      if (disposed) return;
      disposed = true;
      await this.runtime.removeSessionDir(dir).catch(() => {});
    };
    try {
      const password = crypto.randomUUID();
      const configPath = await writeVlcSessionConfig({
        dir,
        password,
        userConfigPath: this.runtime.userConfigPath(),
      });
      const port = await this.runtime.freePort();
      const proc = this.runtime.spawn([
        binary,
        ...buildVlcArgs({
          ...item,
          port,
          configPath,
          keepOpen,
          extraArgs: this.runtime.extraArgs,
        }),
      ]);
      const session: VlcSession = {
        proc,
        process: processNumber,
        cycle: 1,
        keepOpen,
        statusUrl: `http://127.0.0.1:${port}/requests/status.json`,
        headers: { authorization: `Basic ${btoa(`:${password}`)}` },
        connected: false,
        exited: false,
        exitCode: null,
        dispose,
      };
      // The user may close a window kept open between episodes; the next file
      // then launches a fresh VLC instead of talking to a dead one.
      void this.watchExit(session);
      return session;
    } catch (error) {
      await dispose();
      throw error;
    }
  }

  /** Mark the session gone when VLC exits; an idle one is cleaned up here. */
  private async watchExit(session: VlcSession): Promise<void> {
    session.exitCode = await session.proc.exited.catch(() => 0);
    session.exited = true;
    if (this.session === session && !this.fileInFlight) {
      this.session = null;
      await session.dispose();
    }
  }

  private async endSession(session: VlcSession): Promise<void> {
    if (!session.exited) {
      session.proc.kill("SIGTERM");
      const runtime = this.runtime;
      const fallback = runtime.setTimeout(() => {
        if (!session.exited) session.proc.kill("SIGKILL");
      }, RELEASE_KILL_AFTER_MS);
      await session.proc.exited.catch(() => 0);
      runtime.clearTimeout(fallback);
    }
    await session.dispose();
  }

  /** The URL and subtitle VLC opens: direct, or through the loopback gateway. */
  private async prepareTarget(
    stream: StreamInfo,
    options: PlayerOptions,
    cleanups: Array<() => Promise<void> | void>,
  ): Promise<{ readonly url: string; readonly subtitle?: string }> {
    const subtitle = stream.subtitle?.trim() || undefined;
    if (options.localPlaybackSource) {
      return subtitle ? { url: stream.url, subtitle } : { url: stream.url };
    }
    // Addon streams get mpv's strict direct-media check before VLC sees them.
    if (isStremioPlayback(stream)) {
      const preflight = await checkStremioPlaybackPreflight(stream, options.abortSignal);
      if (preflight.status !== "reachable") {
        throw new VlcLaunchError("unsupported-stream", "Addon stream failed playback preflight.");
      }
    }
    let document: Parameters<GatewaySessionFactory>[0]["document"];
    if (stream.deferredLocator?.trim()) {
      const materialized = await materializeDeferredMediaDocument(stream);
      cleanups.push(async () => await materialized.cleanup());
      document = {
        text: materialized.text,
        contentType: materialized.contentType,
        remoteUrls: materialized.remoteUrls,
      };
    }
    const needsHeaders = Object.values(stream.headers).some((value) => value.trim().length > 0);
    if (!document && !needsHeaders) {
      return subtitle ? { url: stream.url, subtitle } : { url: stream.url };
    }
    // Exactly the candidate's headers, injected by the gateway: VLC itself can
    // send only Referer and User-Agent, and the probed request had them all.
    const gateway: GatewaySession = getSharedStreamGateway().registerSession({
      ...(document ? { document } : { url: stream.url }),
      headers: stream.headers,
      subtitles: subtitle ? [subtitle] : [],
    });
    cleanups.push(() => gateway.stop());
    const gatewaySubtitle = gateway.subtitleUrls[0];
    return gatewaySubtitle
      ? { url: gateway.mediaUrl, subtitle: gatewaySubtitle }
      : { url: gateway.mediaUrl };
  }

  /** Watch one file until it ends, VLC exits, or Kunai stops it. */
  private async observe(input: {
    readonly session: VlcSession;
    readonly generation: PlaybackGeneration;
    readonly emit: (event: PlayerPlaybackEvent) => void;
    readonly options: PlayerOptions;
  }): Promise<PlaybackResult> {
    const { session, emit, options } = input;
    const runtime = this.runtime;
    const stats = createPlayerStatsState();
    const watchdog = createPlaybackWatchdog(emit);
    const throttle = createPlaybackProgressThrottleState();
    const skips = createVlcSkipTracker({
      timing: options.timing,
      autoSkipEnabled: options.autoSkipEnabled,
      skipRecap: options.skipRecap,
      skipIntro: options.skipIntro,
      skipCredits: options.skipCredits,
      // As mpv's player: credits skip whenever auto-skip is on.
      autoNextEnabled: true,
    });
    let ended = false;
    let stopRequested: string | null = null;
    let ready = false;
    // The last status that still described this file; VLC's "stopped" status
    // after the end has no length or position left.
    let lastOpen: VlcStatus | null = null;
    const opened = (): VlcStatus | null => lastOpen;
    let stoppedSince: number | null = null;
    let lastDisplayed = 0;
    let lastPaused: boolean | null = null;
    let nearEofFired = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = runtime.now();
    const fileEnded = Promise.withResolvers<void>();
    const endFile = () => {
      ended = true;
      fileEnded.resolve();
    };

    const readStatus = async (): Promise<VlcStatus | null> =>
      parseVlcStatus(await runtime.getJson(session.statusUrl, session.headers));
    // VLC may already be gone; the end path settles the result either way.
    const command = async (query: string): Promise<void> => {
      await runtime.getJson(`${session.statusUrl}?${query}`, session.headers);
    };
    const seekTo = async (seconds: number) =>
      await command(`command=seek&val=${vlcSeekTarget(seconds)}`);

    const output = createPlaybackOutputDriver({
      gate: runtime.createPlaybackOutputGate?.(),
      stats,
      readVideoOutput: async () => {
        const status = await readStatus();
        if (!status) return null;
        const tracks = vlcTrackList(status);
        return {
          videoOutParams: undefined,
          voConfigured: status.displayedPictures > 0,
          trackList: tracks ? [...tracks] : undefined,
        };
      },
      isCurrent: () => !ended && !session.exited,
      emit,
    });

    const baseControl: ActivePlayerControl = {
      id: `vlc-${input.generation.process}.${input.generation.cycle}`,
      stop: async (reason) => {
        stopRequested = reason ?? "stop";
        await command("command=pl_stop");
        session.proc.kill("SIGTERM");
      },
      getStatsSnapshot: () => buildPlaybackStatsSnapshot(stats),
      skipCurrentSegment: async () => {
        const segment = skips.manual();
        if (!segment) return false;
        await seekTo(segment.endSeconds);
        emit({ type: "segment-skipped", kind: segment.kind, automatic: false });
        return true;
      },
      updateTiming: (timing) => skips.setTiming(timing),
      updateAutoSkipEnabled: (enabled) => skips.setAutoSkipEnabled(enabled),
      getTimingSnapshot: () => skips.timing(),
    };
    // Next/previous/recover stop the file and keep the window for what follows.
    const control: ActivePlayerControl = session.keepOpen
      ? {
          ...baseControl,
          stopCurrentFile: async (reason) => {
            stopRequested = reason ?? "stop";
            await command("command=pl_stop");
            endFile();
          },
        }
      : baseControl;
    this.deps.playerControl.setActive(control);
    const onAbort = () => void control.stop("abort");
    options.abortSignal?.addEventListener("abort", onAbort, { once: true });

    const onStatus = async (status: VlcStatus, observedAt: number): Promise<void> => {
      if (!session.connected) {
        session.connected = true;
        emit({ type: "ipc-connected" });
      }
      if (!ready) {
        ready = true;
        emit({ type: "player-ready" });
        options.onPlayerReady?.();
      }
      if (status.state === "stopped") {
        stoppedSince ??= observedAt;
        // Without a window to keep, VLC exits with its file and the exit ends
        // it. A kept window stays: opened and now stopped means the file
        // ended; never opened gets `in_play` and a slow start their grace.
        if (!session.keepOpen) return;
        if (opened() !== null || observedAt - stoppedSince >= OPEN_GRACE_MS) endFile();
        return;
      }
      stoppedSince = null;
      if (vlcTrackList(status) !== undefined) lastOpen = status;
      applyVlcStatus(stats, status, lastDisplayed, observedAt);
      lastDisplayed = status.displayedPictures;
      const sample = stats.latestIpcSample;
      if (sample) {
        watchdog.observe(sample);
        output.observe(sample);
        if (output.started) {
          if (shouldEmitPlaybackProgress(throttle, sample, observedAt)) {
            emit({
              type: "playback-progress",
              positionSeconds: sample.positionSeconds,
              durationSeconds: sample.durationSeconds,
            });
          }
          options.onProgress?.(sample.positionSeconds);
          const skip = skips.observe(sample.positionSeconds);
          if (skip) {
            await seekTo(skip.endSeconds);
            emit({ type: "segment-skipped", kind: skip.kind, automatic: true });
          }
          const trigger = resolveNearEofPrefetchTriggerSeconds(
            sample.durationSeconds,
            skips.timing(),
          );
          if (!nearEofFired && trigger !== null && sample.positionSeconds >= trigger) {
            nearEofFired = true;
            options.onNearEof?.();
          }
        }
      }
      const paused = status.state === "paused";
      if (lastPaused !== null && paused !== lastPaused) {
        emit({ type: paused ? "playback-paused" : "playback-resumed" });
      }
      lastPaused = paused;
    };

    const poll = async (): Promise<void> => {
      timer = null;
      if (ended || session.exited) return;
      const status = await readStatus();
      if (ended || session.exited) return;
      const observedAt = runtime.now();
      if (status) {
        await onStatus(status, observedAt);
      } else if (!session.connected && observedAt - startedAt > CONTROL_READY_TIMEOUT_MS) {
        // VLC is running but its control interface never answered (another
        // process took the port, or the Lua HTTP module is missing).
        emit({
          type: "ipc-command-failed",
          command: "vlc-http",
          error: "VLC's control interface did not answer",
        });
        stopRequested = "no-control";
        session.proc.kill("SIGTERM");
        return;
      }
      if (!ended) timer = runtime.setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };
    timer = runtime.setTimeout(() => void poll(), POLL_INTERVAL_MS);

    const outcome = await Promise.race([
      session.proc.exited.then(
        (code) => ({ exited: true, code }),
        () => ({ exited: true, code: 0 }),
      ),
      fileEnded.promise.then(() => ({ exited: false, code: 0 })),
    ]);
    if (outcome.exited) {
      session.exited = true;
      session.exitCode = outcome.code;
    }
    ended = true;
    if (timer !== null) runtime.clearTimeout(timer);
    watchdog.stop();
    options.abortSignal?.removeEventListener("abort", onAbort);
    if (this.deps.playerControl.getActive() === control) this.deps.playerControl.setActive(null);
    if (session.exited) emit({ type: "player-closed" });

    const final = opened();
    const endedNaturally =
      stopRequested === null &&
      final !== null &&
      final.durationSeconds > 0 &&
      final.positionSeconds >= final.durationSeconds - NATURAL_END_SLACK_SECONDS;
    if (endedNaturally) {
      applyEndFileEvent(stats, "eof", runtime.now());
    } else if (stopRequested === null && final === null) {
      // VLC never opened the input: it could not play it.
      applyEndFileEvent(stats, "error", runtime.now(), {
        fileError: session.connected
          ? "VLC could not open the stream"
          : "VLC exited before it could be controlled",
      });
    } else {
      // The user closed or stopped VLC, or Kunai stopped the file.
      applyEndFileEvent(stats, "stop", runtime.now());
    }
    if (session.exited) {
      const signal = isJsonString(session.proc.signalCode) ? session.proc.signalCode : null;
      recordPlayerExit(stats, { code: session.exitCode ?? 0, signal });
    }
    return finalizePlaybackResult(stats, { socketPathCleanedUp: true });
  }
}

type GatewaySessionFactory = ReturnType<typeof getSharedStreamGateway>["registerSession"];
