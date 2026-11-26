import { rm } from "node:fs/promises";

import type { PlaybackGeneration } from "@/domain/playback/playback-generation";
import { VLC_CAPABILITIES } from "@/domain/playback/player-capabilities";
import type { PlaybackResult, StreamInfo } from "@/domain/types";
import { createPrivateTempDir } from "@/infra/fs/temp-dir";
import type { LocalPlaybackSource } from "@/services/offline/local-playback-source";
import { materializeDeferredMediaDocument } from "@/services/playback/deferred-media-materializer";
import { isJsonString, type JsonValue } from "@kunai/types";

import {
  createPlaybackProgressThrottleState,
  shouldEmitPlaybackProgress,
} from "../mpv-playback-kernel";
import {
  applyEndFileEvent,
  createPlayerStatsState,
  finalizePlaybackResult,
  recordPlayerExit,
} from "../mpv-stats";
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
import {
  buildVlcArgs,
  discoverVlcBinary,
  userVlcConfigPath,
  writeVlcSessionConfig,
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
  spawn: (argv) => Bun.spawn([...argv], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }),
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
/** Within this of the end, a VLC that exits on its own finished the file. */
const NATURAL_END_SLACK_SECONDS = 3;

/**
 * Desktop VLC as an observed player. One VLC process per playback; Kunai adds
 * a loopback HTTP control interface and otherwise leaves VLC's own window,
 * hotkeys and settings alone. Streams that need provider headers or a
 * generated manifest go through the same loopback gateway Android handoff
 * uses, so the request VLC makes is the request the resolve gate probed.
 */
export class VlcPlayerService implements PlayerService {
  readonly capabilities = VLC_CAPABILITIES;
  private shuttingDown = false;
  private process = 0;
  private active: { readonly proc: VlcProcess; readonly generation: PlaybackGeneration } | null =
    null;

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

  async releasePersistentSession(): Promise<void> {}

  killActiveMpvProcessesSync(): void {
    this.active?.proc.kill("SIGKILL");
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
    if (stream.requiresYtdl) {
      throw new VlcLaunchError(
        "unsupported-stream",
        "This stream needs yt-dlp, which VLC cannot run. Play it with --player mpv.",
      );
    }
    const binary = this.runtime.discover();
    if (!binary) {
      throw new VlcLaunchError("dependency", "VLC is not installed or was not found.");
    }

    this.process += 1;
    const generation: PlaybackGeneration = { process: this.process, cycle: 1 };
    options.onGenerationActivated?.(generation);
    const emit = (event: PlayerPlaybackEvent) => options.onPlaybackEvent?.({ generation, event });

    const cleanups: Array<() => Promise<void> | void> = [];
    try {
      const target = await this.prepareTarget(stream, options, cleanups);
      const dir = await this.runtime.makeSessionDir();
      cleanups.push(async () => await this.runtime.removeSessionDir(dir));
      const password = crypto.randomUUID();
      const configPath = await writeVlcSessionConfig({
        dir,
        password,
        userConfigPath: this.runtime.userConfigPath(),
      });
      const port = await this.runtime.freePort();
      const argv = [
        binary,
        ...buildVlcArgs({
          port,
          configPath,
          url: target.url,
          title: options.displayTitle,
          startAtSeconds: options.startAt,
          subtitle: target.subtitle,
          extraArgs: this.runtime.extraArgs,
        }),
      ];

      emit({ type: "launching-player" });
      const proc = this.runtime.spawn(argv);
      this.active = { proc, generation };
      return await this.observe({
        proc,
        generation,
        emit,
        options,
        statusUrl: `http://127.0.0.1:${port}/requests/status.json`,
        authorization: `Basic ${btoa(`:${password}`)}`,
      });
    } finally {
      this.active = null;
      for (const cleanup of cleanups.reverse()) {
        await Promise.resolve(cleanup()).catch(() => {});
      }
    }
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
    const session: GatewaySession = getSharedStreamGateway().registerSession({
      ...(document ? { document } : { url: stream.url }),
      headers: stream.headers,
      subtitles: subtitle ? [subtitle] : [],
    });
    cleanups.push(() => session.stop());
    const gatewaySubtitle = session.subtitleUrls[0];
    return gatewaySubtitle
      ? { url: session.mediaUrl, subtitle: gatewaySubtitle }
      : { url: session.mediaUrl };
  }

  private async observe(input: {
    readonly proc: VlcProcess;
    readonly generation: PlaybackGeneration;
    readonly emit: (event: PlayerPlaybackEvent) => void;
    readonly options: PlayerOptions;
    readonly statusUrl: string;
    readonly authorization: string;
  }): Promise<PlaybackResult> {
    const { proc, emit, options } = input;
    const runtime = this.runtime;
    const stats = createPlayerStatsState();
    const watchdog = createPlaybackWatchdog(emit);
    const throttle = createPlaybackProgressThrottleState();
    let exited = false;
    let stopRequested: string | null = null;
    let connected = false;
    let lastStatus: VlcStatus | null = null;
    // A function, so the exit path reads what the poll loop last stored.
    const latestStatus = (): VlcStatus | null => lastStatus;
    let lastDisplayed = 0;
    let lastPaused: boolean | null = null;
    let nearEofFired = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = runtime.now();

    const headers = { authorization: input.authorization };
    const readStatus = async (): Promise<VlcStatus | null> =>
      parseVlcStatus(await runtime.getJson(input.statusUrl, headers));
    // VLC may already be gone; the exit path settles the result either way.
    const command = async (query: string): Promise<void> => {
      await runtime.getJson(`${input.statusUrl}?${query}`, headers);
    };

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
      isCurrent: () => !exited,
      emit,
    });

    const control: ActivePlayerControl = {
      id: `vlc-${input.generation.process}`,
      stop: async (reason) => {
        stopRequested = reason ?? "stop";
        await command("command=pl_stop");
        proc.kill("SIGTERM");
      },
      getStatsSnapshot: () => buildPlaybackStatsSnapshot(stats),
    };
    this.deps.playerControl.setActive(control);
    const onAbort = () => void control.stop("abort");
    options.abortSignal?.addEventListener("abort", onAbort, { once: true });

    const poll = async (): Promise<void> => {
      timer = null;
      if (exited) return;
      const status = await readStatus();
      if (exited) return;
      const observedAt = runtime.now();
      if (status) {
        if (!connected) {
          connected = true;
          emit({ type: "ipc-connected" });
          emit({ type: "player-ready" });
          options.onPlayerReady?.();
        }
        applyVlcStatus(stats, status, lastDisplayed, observedAt);
        lastDisplayed = status.displayedPictures;
        lastStatus = status;
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
          }
        }
        const paused = status.state === "paused";
        if (lastPaused !== null && paused !== lastPaused) {
          emit({ type: paused ? "playback-paused" : "playback-resumed" });
        }
        lastPaused = paused;
        if (
          !nearEofFired &&
          options.playbackMode === "autoplay-chain" &&
          status.durationSeconds > 0 &&
          status.durationSeconds - status.positionSeconds <= 30 &&
          status.positionSeconds > 0
        ) {
          nearEofFired = true;
          options.onNearEof?.();
        }
      } else if (!connected && observedAt - startedAt > CONTROL_READY_TIMEOUT_MS) {
        // VLC is running but its control interface never answered (another
        // process took the port, or the Lua HTTP module is missing).
        emit({
          type: "ipc-command-failed",
          command: "vlc-http",
          error: "VLC's control interface did not answer",
        });
        stopRequested = "no-control";
        proc.kill("SIGTERM");
        return;
      }
      timer = runtime.setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };
    timer = runtime.setTimeout(() => void poll(), POLL_INTERVAL_MS);

    const code = await proc.exited;
    exited = true;
    if (timer !== null) runtime.clearTimeout(timer);
    watchdog.stop();
    options.abortSignal?.removeEventListener("abort", onAbort);
    if (this.deps.playerControl.getActive() === control) this.deps.playerControl.setActive(null);
    emit({ type: "player-closed" });

    const final = latestStatus();
    const endedNaturally =
      stopRequested === null &&
      final !== null &&
      final.durationSeconds > 0 &&
      final.positionSeconds >= final.durationSeconds - NATURAL_END_SLACK_SECONDS;
    if (endedNaturally) {
      applyEndFileEvent(stats, "eof", runtime.now());
    } else if (stopRequested === null && (final === null || final.durationSeconds <= 0)) {
      // VLC exited without ever opening the input: it could not play it.
      applyEndFileEvent(stats, "error", runtime.now(), {
        fileError: connected
          ? "VLC could not open the stream"
          : "VLC exited before it could be controlled",
      });
    } else {
      // The user closed VLC, or Kunai stopped it.
      applyEndFileEvent(stats, "stop", runtime.now());
    }
    const signal = isJsonString(proc.signalCode) ? proc.signalCode : null;
    recordPlayerExit(stats, { code, signal });
    return finalizePlaybackResult(stats, { socketPathCleanedUp: true });
  }
}

type GatewaySessionFactory = ReturnType<typeof getSharedStreamGateway>["registerSession"];
