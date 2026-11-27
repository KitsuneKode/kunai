import { existsSync } from "node:fs";
import { rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { PlaybackResult } from "@/domain/types";
import type { SubtitleTrack } from "@/domain/types";
import { createPrivateTempDir } from "@/infra/fs/temp-dir";
import { scrubbedChildEnv } from "@/infra/os/child-env";
import { discoverMpvInvocation } from "@/infra/player/mpv-discovery";
import { probeMpvHdrCapability, resolveMpvHdrArgs } from "@/infra/player/mpv-hdr";
import type { MpvIpcSession } from "@/infra/player/mpv-ipc";
import { openMpvIpcSession, waitForMpvIpcEndpoint } from "@/infra/player/mpv-ipc";
import {
  createMpvIpcEndpoint,
  ipcServerCliArg,
  mpvIpcBootstrapDiagnosticsHintSuffix,
  mpvIpcTransportTag,
  newMpvIpcSessionId,
  shouldUnlinkUnixSocket,
} from "@/infra/player/mpv-ipc-endpoint";
import { mpvIpcFailureEvents } from "@/infra/player/mpv-ipc-failure-events";
import {
  createPlaybackProgressThrottleState,
  shouldEmitPlaybackProgress,
} from "@/infra/player/mpv-playback-kernel";
import { isLocalHlsManifestPlaybackUrl } from "@/infra/player/mpv-playback-url";
import {
  isAllowedMpvUrl,
  isLocalSubtitlePath,
  type MpvUrlKind,
} from "@/infra/player/mpv-playback-url";
import {
  registerMpvProcess,
  terminateMpvProcess,
  type MpvChildProcess,
  type MpvTerminationResult,
} from "@/infra/player/mpv-process-registry";
import type { MpvRuntimeOptions } from "@/infra/player/mpv-runtime-options";
import { shouldApplyStartAtSeek } from "@/infra/player/mpv-start-seek";
import {
  DEFAULT_MPV_YTDL_FORMAT,
  composeDemuxerLavfOptions,
  guardedYtdlRawOptions,
  LIVE_DEMUXER_LAVF_OPTIONS,
  LIVE_DEMUXER_OPTIONS,
  LOCAL_HLS_DEMUXER_LAVF_OPTIONS,
  normalizeStreamHttpHeaders,
  shouldDisableMpvTlsVerify,
  toMpvLanguageToken,
} from "@/infra/player/mpv-stream-http-headers";
import {
  buildYoutubeMpvScriptOpts,
  isYoutubeWatchUrl,
  joinMpvScriptOpts,
  toYoutubeSubtitlePreferenceTokens,
} from "@kunai/providers/youtube";

export { shouldApplyStartAtSeek };
export { isLocalHlsManifestPlaybackUrl } from "@/infra/player/mpv-playback-url";
export { isAllowedMpvUrl, type MpvUrlKind } from "@/infra/player/mpv-playback-url";
import { unrecoverableStallEvent } from "@/infra/player/mpv-in-process-reconnect";
import { MpvLaunchError } from "@/infra/player/mpv-launch-error";
import { launchPreflight, type ResolveGateStream } from "@/infra/player/mpv-launch-preflight";
import {
  applyEndFileEvent,
  applyObservedPropertySample,
  createPlayerStatsState,
  finalizePlaybackResult,
  noteStreamStall,
  noteTrustedSeek,
  recordPlayerExit,
} from "@/infra/player/mpv-stats";
import {
  allowedLaunchSubtitleFiles,
  collectAdditionalSubtitleTracks,
  describeSubtitleTrackForMpv,
} from "@/infra/player/mpv-subtitle-tracks";
import { PlaybackAbortedError } from "@/infra/player/playback-aborted";
import {
  createPlaybackOutputDriver,
  readMpvVideoOutput,
} from "@/infra/player/playback-output-gate";
import { findActivePlaybackSkip, type PlaybackSkipConfig } from "@/infra/player/playback-skip";
import { createPlaybackWatchdog } from "@/infra/player/playback-watchdog";
import type { ActivePlayerControl } from "@/infra/player/PlayerControlService";
import type { PlayerPlaybackEvent } from "@/infra/player/PlayerService";
import type { LateSubtitleAttachment } from "@/infra/player/PlayerService";
import {
  SubtitleFiles,
  prepareLaunchSubtitles,
  type SubtitleMediaRequest,
  resolvePlayerSubtitle,
} from "@/infra/player/subtitle-files";
import { removeMpvChaptersFile, writeMpvChaptersFile } from "@/infra/timing";
import { dbg } from "@/logger";
import {
  checkStremioPlaybackPreflight,
  shouldAbortPlaybackForPreflight,
} from "@/services/playback/stream-health-check";
import type { StreamPreflightResult } from "@/services/playback/stream-health-check";

export {
  collectAdditionalSubtitleTracks,
  collectLaunchSubtitleFiles,
  describeSubtitleTrackForMpv,
} from "@/infra/player/mpv-subtitle-tracks";

export async function launchMpv(opts: {
  url: string;
  urlKind?: MpvUrlKind;
  headers: Record<string, string>;
  subtitle: string | null;
  subtitleUrlKind?: MpvUrlKind;
  subtitleMedia?: SubtitleMediaRequest;
  audioPreference?: string;
  subtitlePreference?: string;
  subtitleTracks?: readonly SubtitleTrack[];
  displayTitle: string;
  startAt?: number;
  requiresYtdl?: boolean;
  /** The resolved stream: what its gate proved, and when. A fresh pass skips the launch probe. */
  resolveGate?: ResolveGateStream;
  ytdlFormat?: string;
  ytdlRawOptions?: string;
  isLive?: boolean;
  /** Stremio addon file: strict preflight before spawn + file-local confinement args. */
  stremioAddon?: boolean;
  /** Cancelled before spawn refuses the launch; during playback it is ignored. */
  abortSignal?: AbortSignal;
  attach?: boolean;
  timing?: import("@/domain/types").PlaybackTimingMetadata | null;
  autoSkipEnabled?: boolean;
  skipRecap?: boolean;
  skipIntro?: boolean;
  skipPreview?: boolean;
  skipCredits?: boolean;
  onControlReady?: (control: ActivePlayerControl | null) => void;
  onPlayerReady?: () => void;
  onPlaybackEvent?: (event: PlayerPlaybackEvent) => void;
  mpv?: MpvRuntimeOptions;
}): Promise<PlaybackResult> {
  const sessionId = newMpvIpcSessionId();
  const ipcEndpoint = createMpvIpcEndpoint(sessionId);

  if (shouldUnlinkUnixSocket(ipcEndpoint)) await unlinkIfExists(ipcEndpoint.path);

  let chaptersFile: string | null = null;
  if (opts.timing) {
    try {
      chaptersFile = await writeMpvChaptersFile(opts.timing, sessionId);
    } catch {
      // Best effort chapters file
    }
  }

  const subtitleFiles = new SubtitleFiles(
    undefined,
    opts.stremioAddon ? undefined : (opts.subtitleMedia ?? opts),
  );
  try {
    const mpvInvocation = discoverMpvInvocation();
    if (!mpvInvocation) {
      throw new MpvLaunchError("dependency", "mpv is not installed or not found on PATH");
    }
    // Only an explicit HDR mode emits gpu-next options; `auto` leaves mpv alone.
    const needsHdrProbe =
      opts.mpv?.supportsGpuNext === undefined &&
      opts.mpv?.hdrMode !== undefined &&
      opts.mpv.hdrMode !== "auto";
    const hdrCapability = needsHdrProbe ? await probeMpvHdrCapability(mpvInvocation) : null;
    const effectiveMpv: MpvRuntimeOptions | undefined =
      hdrCapability !== null
        ? { ...opts.mpv, supportsGpuNext: hdrCapability.supportsGpuNext }
        : opts.mpv;
    const launchSubs = await prepareLaunchSubtitles(opts, subtitleFiles);
    if (opts.abortSignal?.aborted)
      throw new PlaybackAbortedError("playback aborted before mpv launch");
    const launchOpts = { ...opts, ...launchSubs };
    const sensitiveConf = await writeMpvSensitiveConf(launchOpts, ipcEndpoint);
    const args = buildMpvArgs({ ...launchOpts, chaptersFile }, ipcServerCliArg(ipcEndpoint), {
      mpv: effectiveMpv,
      sensitiveOptionsPath: sensitiveConf?.path,
    });
    const stats = createPlayerStatsState(ipcEndpoint.path);
    noteTrustedSeek(stats, opts.startAt ?? 0);
    const baseEmit = opts.onPlaybackEvent ?? (() => {});
    const emitPlaybackEvent = (event: PlayerPlaybackEvent) => {
      if (event.type === "stream-stalled" || event.type === "ipc-stalled") {
        noteStreamStall(stats, Date.now());
      }
      baseEmit(event);
      // One-shot mpv has no in-place reload, so a post-start dead stream escalates at once.
      const escalation = unrecoverableStallEvent(event);
      if (escalation) baseEmit(escalation);
    };

    // Addon files get one last strict check after every argument and file is
    // prepared, so refusal happens before the process exists at all.
    if (opts.stremioAddon) {
      if (opts.abortSignal?.aborted) {
        await sensitiveConf?.cleanup();
        throw new PlaybackAbortedError("playback aborted before mpv launch");
      }
      const preflight = await checkStremioPlaybackPreflight(
        { url: opts.url, headers: opts.headers },
        opts.abortSignal,
      );
      if (preflight.status !== "reachable" || opts.abortSignal?.aborted) {
        await sensitiveConf?.cleanup();
        if (opts.abortSignal?.aborted) {
          throw new PlaybackAbortedError("playback aborted before mpv launch");
        }
        throw new MpvLaunchError("unsafe-target", "Addon stream failed playback preflight");
      }
    }

    const stdio = opts.attach ? ("inherit" as const) : ("ignore" as const);
    let mpv: ReturnType<typeof Bun.spawn>;
    try {
      mpv = Bun.spawn([...mpvInvocation.argv, ...args], {
        stdin: stdio,
        stdout: stdio,
        stderr: stdio,
        env: scrubbedChildEnv(),
      });
    } catch (error) {
      await sensitiveConf?.cleanup();
      throw error;
    }
    const unregisterMpv = registerMpvProcess(mpv);
    try {
      const result = await launchMpvInner(
        mpv,
        unregisterMpv,
        launchOpts,
        sessionId,
        ipcEndpoint,
        stats,
        emitPlaybackEvent,
        subtitleFiles,
      );
      // The conf file's only reader finished with it during startup — by the
      // time the IPC endpoint is live, `--include` is long parsed.
      await sensitiveConf?.cleanup();
      return result;
    } catch (error) {
      // A failed launch still wrote the conf — mpv either died before parsing
      // it or is gone; neither keeps the file alive.
      await sensitiveConf?.cleanup();
      throw error;
    } finally {
      unregisterMpv();
    }
  } finally {
    await subtitleFiles.close().catch(() => {});
    if (chaptersFile) {
      await removeMpvChaptersFile(chaptersFile).catch(() => {});
    }
  }
}

async function launchMpvInner(
  mpv: ReturnType<typeof Bun.spawn>,
  _unregisterMpv: () => void,
  opts: Parameters<typeof launchMpv>[0],
  sessionId: string,
  ipcEndpoint: ReturnType<typeof createMpvIpcEndpoint>,
  stats: ReturnType<typeof createPlayerStatsState>,
  emitPlaybackEvent: (event: PlayerPlaybackEvent) => void,
  subtitleFiles: SubtitleFiles,
): Promise<PlaybackResult> {
  const resolveSubtitle = (url: string) =>
    resolvePlayerSubtitle(url, "remote", subtitleFiles, opts.abortSignal);
  let ipcSession: MpvIpcSession | null = null;
  let endFileResolve: ((reason: string | undefined) => void) | null = null;
  const endFileReceived = new Promise<string | undefined>((resolve) => {
    endFileResolve = resolve;
  });
  let stopRequested = false;
  let playerReadyNotified = false;
  let currentPositionSeconds = 0;
  const playbackProgressThrottle = createPlaybackProgressThrottleState();
  let mutableTiming = opts.timing ?? null;
  const watchdog = createPlaybackWatchdog(emitPlaybackEvent);
  const skippedSegments = new Set<string>();
  const buildSkipConfig = (enabled: boolean): PlaybackSkipConfig => ({
    skipRecap: enabled && (opts.skipRecap ?? true),
    skipIntro: enabled && (opts.skipIntro ?? true),
    skipPreview: false,
    skipCredits: enabled && (opts.skipCredits ?? true),
    autoNextEnabled: false, // launchMpv is only used for one-shot/manual playback
  });
  let autoSkipEnabled = opts.autoSkipEnabled !== false;
  let skipConfig = buildSkipConfig(autoSkipEnabled);
  const notifyPlayerReady = () => {
    if (playerReadyNotified) return;
    playerReadyNotified = true;
    emitPlaybackEvent({ type: "player-ready" });
    opts.onPlayerReady?.();
  };
  let outputEnded = false;
  const output = createPlaybackOutputDriver({
    stats,
    readVideoOutput: async () => readMpvVideoOutput(ipcSession),
    isCurrent: () => !outputEnded,
    emit: emitPlaybackEvent,
  });
  const maybeEmitPlaybackProgress = (observedAt: number) => {
    const sample = stats.latestIpcSample;
    if (
      !shouldEmitPlaybackProgress(
        playbackProgressThrottle,
        sample
          ? {
              positionSeconds: sample.positionSeconds,
              durationSeconds: sample.durationSeconds,
            }
          : null,
        observedAt,
      ) ||
      !sample
    ) {
      return;
    }
    emitPlaybackEvent({
      type: "playback-progress",
      positionSeconds: sample.positionSeconds,
      durationSeconds: sample.durationSeconds,
    });
  };
  const trySkipSegment = (automatic: boolean) => {
    const activeSkip = findActivePlaybackSkip(mutableTiming, currentPositionSeconds, skipConfig);
    if (!activeSkip || !ipcSession || skippedSegments.has(activeSkip.key)) return false;
    void ipcSession
      .send(["seek", activeSkip.endSeconds, "absolute"])
      .then((result) => {
        if (result.ok) {
          skippedSegments.add(activeSkip.key);
          emitPlaybackEvent({
            type: "segment-skipped",
            kind: activeSkip.kind,
            automatic,
          });
        }
        return undefined;
      })
      .catch(() => {});
    return true;
  };
  const control: ActivePlayerControl = {
    id: sessionId,
    async stop() {
      if (stopRequested) return;
      stopRequested = true;
      if (ipcSession) {
        const result = await ipcSession.send(["quit"], 1_000);
        if (result.ok) return;
      }
      mpv.kill("SIGTERM");
    },
    async reloadSubtitles() {
      void ipcSession?.send(["sub-reload"]);
    },
    async selectSubtitle(selection) {
      if (!ipcSession) return false;
      if (!selection.subtitleUrl) {
        const result = await ipcSession.send(["set_property", "sid", "no"], 1_000);
        return result.ok;
      }
      const attached = await attachLateSubtitles(
        ipcSession,
        {
          primarySubtitle: selection.subtitleUrl,
          subtitleTracks: selection.subtitleTracks,
        },
        (trackCount) => {
          emitPlaybackEvent({ type: "late-subtitles-attached", trackCount });
        },
        resolveSubtitle,
      );
      return attached > 0;
    },
    async attachSubtitles(attachment: LateSubtitleAttachment) {
      return await attachLateSubtitles(
        ipcSession,
        attachment,
        (trackCount) => {
          emitPlaybackEvent({ type: "late-subtitles-attached", trackCount });
        },
        resolveSubtitle,
      );
    },
    async skipCurrentSegment() {
      return trySkipSegment(false);
    },
    updateTiming(timing) {
      mutableTiming = timing;
      trySkipSegment(true);
    },
    updateAutoSkipEnabled(enabled) {
      autoSkipEnabled = enabled;
      skipConfig = buildSkipConfig(autoSkipEnabled);
      trySkipSegment(true);
    },
    getTimingSnapshot() {
      return mutableTiming;
    },
  };
  opts.onControlReady?.(control);
  emitPlaybackEvent({ type: "mpv-process-started" });

  // `killed` survives into recordPlayerExit as the exit signal, so a process we
  // terminated can never be promoted to a natural eof downstream.
  const exitPromise = mpv.exited.then((code) => ({
    code,
    signal: mpv.killed ? ("SIGTERM" as NodeJS.Signals) : null,
  }));

  const preflight = launchPreflight(opts).then((result) => {
    if (shouldAbortLaunchForDefinitivePreflight(result, ipcSession !== null)) {
      dbg("mpv", "preflight-definitive-failure", {
        reason: result.reason,
        phase: "launch",
        ipcConnected: ipcSession !== null,
      });
      mpv.kill("SIGTERM");
    }
    return result;
  });

  const ipcBootstrap = (async () => {
    const ipcBootstrapStarted = Date.now();
    const ready = await waitForMpvIpcEndpoint(ipcEndpoint, 5_000);
    assertOneShotMpvIpcEndpointReady(
      ready,
      `IPC endpoint was not ready after ${Date.now() - ipcBootstrapStarted}ms at ${ipcServerCliArg(ipcEndpoint)}.${mpvIpcBootstrapDiagnosticsHintSuffix()}`,
    );

    ipcSession = await openMpvIpcSession({
      endpoint: ipcEndpoint,
      onPropertyUpdate: ({ name, value, observedAt }) => {
        applyObservedPropertySample(stats, { name, value, observedAt });
        if (stats.latestIpcSample) {
          watchdog.observe(stats.latestIpcSample);
          output.observe(stats.latestIpcSample);
        }
        if ((name === "time-pos" || name === "playback-time") && typeof value === "number") {
          currentPositionSeconds = value;
          // Progress waits for confirmed output; see playback-output-gate.
          if (output.started) maybeEmitPlaybackProgress(observedAt);
          trySkipSegment(true);
        }
      },
      onEndFile: ({ reason, fileError, observedAt }) => {
        outputEnded = true;
        applyEndFileEvent(stats, reason, observedAt, { fileError });
        endFileResolve?.(reason);
      },
      onCommandResult: (result) => {
        for (const event of mpvIpcFailureEvents(result)) emitPlaybackEvent(event);
      },
    });

    dbg("mpv-ipc", "ipc-bootstrap-complete", {
      ipcTransport: mpvIpcTransportTag(ipcEndpoint),
      endpoint: ipcServerCliArg(ipcEndpoint),
      bootstrapMs: Date.now() - ipcBootstrapStarted,
      mode: "launchMpv",
    });

    emitPlaybackEvent({ type: "ipc-connected" });
    emitPlaybackEvent({ type: "opening-stream" });
    notifyPlayerReady();
    const trackCount = allowedLaunchSubtitleFiles(opts).length;
    if (trackCount > 0) {
      emitPlaybackEvent({ type: "subtitle-inventory-ready", trackCount });
      emitPlaybackEvent({ type: "subtitle-attached", trackCount });
    }
  })().catch(async (err) => {
    dbg("mpv-ipc", "ipc-bootstrap-failed", {
      endpoint: ipcServerCliArg(ipcEndpoint),
      error: String(err),
      mode: "launchMpv",
    });
    emitPlaybackEvent({
      type: "ipc-command-failed",
      command: "bootstrap",
      error: String(err),
    });
    await settleOneShotMpvIpcBootstrapFailure({
      process: mpv,
      clearOwnedControl: () => opts.onControlReady?.(null),
      reportTerminationFailure: () => {
        emitPlaybackEvent({
          type: "ipc-command-failed",
          command: "terminate",
          error: "mpv did not exit after forced bootstrap teardown",
        });
      },
    });
  });

  const exit = await exitPromise;
  recordPlayerExit(stats, exit);

  // Check if preflight returned a definitive failure before mpv started.
  // This catches dead URLs early so we can skip to fallback without waiting
  // for full mpv startup/shutdown latency.
  const preflightResult = await preflight;
  if (shouldAbortLaunchForDefinitivePreflight(preflightResult, ipcSession !== null)) {
    // Stream is definitively dead and mpv hasn't found it either — abort.
    watchdog.stop();
    const socketPathCleanedUp = await cleanupAbortedMpvLaunch({
      ipcBootstrap,
      getIpcSession: () => ipcSession,
      closeIpcSession,
      cleanupSocket: async () =>
        shouldUnlinkUnixSocket(ipcEndpoint) ? await cleanupUnixSocketFile(ipcEndpoint.path) : true,
    });
    opts.onControlReady?.(null);
    return {
      watchedSeconds: 0,
      duration: 0,
      endReason: "error",
      resultSource: "unknown",
      playerExitedCleanly: false,
      playerExitCode: exit.code,
      playerExitSignal: exit.signal ?? null,
      socketPathCleanedUp,
      lastNonZeroPositionSeconds: 0,
      lastNonZeroDurationSeconds: 0,
      lastTrustedProgressSeconds: 0,
      lastReliableProgressSeconds: 0,
    };
  }

  await ipcBootstrap;

  // Wait for the end-file IPC event (or timeout) before finalizing playback result.
  // A timeout here — e.g. a keep-open session that never emits end-file — leaves
  // endReason unknown, and unknown never writes completed:true downstream
  // (recordPlayerExit refuses to infer eof without an end-file event).
  await Promise.race([endFileReceived, Bun.sleep(1_500).then(() => undefined)]);

  await closeIpcSession(ipcSession);
  watchdog.stop();
  emitPlaybackEvent({ type: "player-closed" });
  const socketPathCleanedUp = shouldUnlinkUnixSocket(ipcEndpoint)
    ? await cleanupUnixSocketFile(ipcEndpoint.path)
    : true;

  opts.onControlReady?.(null);

  return finalizePlaybackResult(stats, { socketPathCleanedUp });
}

export function shouldAbortLaunchForDefinitivePreflight(
  result: StreamPreflightResult,
  ipcConnected: boolean,
): result is Extract<StreamPreflightResult, { status: "unreachable" }> {
  return shouldAbortPlaybackForPreflight(result, ipcConnected);
}

export function assertOneShotMpvIpcEndpointReady(ready: boolean, detail: string): asserts ready {
  if (!ready) throw new Error(detail);
}

/**
 * A one-shot IPC failure still owns the child it spawned. Do not release the
 * generation or allow provider fallback until that exact child is reaped.
 */
export async function settleOneShotMpvIpcBootstrapFailure(options: {
  readonly process: MpvChildProcess;
  readonly terminate?: (process: MpvChildProcess) => Promise<MpvTerminationResult>;
  readonly clearOwnedControl: () => void;
  readonly reportTerminationFailure: () => void;
}): Promise<MpvTerminationResult> {
  const result = await (options.terminate ?? terminateMpvProcess)(options.process);
  if (result.exited) {
    options.clearOwnedControl();
  } else {
    // Keep the control/process registry ownership intact. Returning to fallback
    // here would knowingly stack a second mpv over a still-live first one.
    options.reportTerminationFailure();
  }
  return result;
}

export async function cleanupAbortedMpvLaunch(options: {
  ipcBootstrap: Promise<void>;
  getIpcSession: () => MpvIpcSession | null;
  closeIpcSession: (session: MpvIpcSession | null) => Promise<void>;
  cleanupSocket: () => Promise<boolean>;
  bootstrapWaitMs?: number;
  sleep?: (milliseconds: number) => Promise<unknown>;
}): Promise<boolean> {
  const bootstrapCompleted = options.ipcBootstrap.then(
    () => true,
    () => true,
  );
  const completedBeforeDeadline = await Promise.race([
    bootstrapCompleted,
    (options.sleep ?? Bun.sleep)(options.bootstrapWaitMs ?? 2_000).then(() => false),
  ]);

  await options.closeIpcSession(options.getIpcSession());
  const socketPathCleanedUp = await options.cleanupSocket();

  if (!completedBeforeDeadline) {
    // Cleanup-only continuation: reconcile a session that opens after the bounded wait.
    void options.ipcBootstrap
      .then(async () => {
        await options.closeIpcSession(options.getIpcSession());
        await options.cleanupSocket();
        return undefined;
      })
      .catch(() => {});
  }

  return socketPathCleanedUp;
}

/**
 * The options that can carry credentials: stream `http-header-fields` (e.g.
 * CloudFront signed cookies) and `ytdl-raw-options` (the yt-dlp extractor-args
 * block may embed a po_token). mpv's argv is world-readable on POSIX while it
 * runs, so when the caller supplies an owner-only conf path these go there via
 * `--include` and never touch argv.
 *
 * Both the argv and conf paths draw from this one collector so the sensitive
 * set cannot drift between them.
 */
export function collectSensitiveMpvOptions(opts: {
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly requiresYtdl?: boolean;
  readonly ytdlRawOptions?: string;
}): string[] {
  const lines: string[] = [];
  const { origin, extraFields } = normalizeStreamHttpHeaders(opts.headers);
  const headerFields = [...(origin ? [`Origin: ${origin}`] : []), ...extraFields];
  if (headerFields.length > 0) {
    lines.push(`http-header-fields=${headerFields.join(",")}`);
  }
  if (isYoutubeWatchUrl(opts.url) || opts.requiresYtdl) {
    lines.push(`ytdl-raw-options=${guardedYtdlRawOptions(opts.ytdlRawOptions)}`);
  }
  return lines;
}

/** mpv's length-quoting — `%<byteLen>%<value>` — keeps `#`, commas, and spaces intact in conf files. */
function quoteMpvConfValue(value: string): string {
  return `%${new TextEncoder().encode(value).length}%${value}`;
}

/**
 * Write the sensitive options into an owner-only conf file placed next to the
 * IPC socket (itself in a private directory) — or a fresh private dir on
 * Windows, where the endpoint is a named pipe with no filesystem path. Returns
 * the path for {@link buildMpvArgs}' `sensitiveOptionsPath`, or null when no
 * sensitive options exist for this stream.
 *
 * Lifetime: one-shot mpv parses the include at startup, so the caller may
 * delete the file as soon as the IPC endpoint is provably live. Persistent mpv
 * reads it when the first file's scoped local options are applied; retain it
 * until that file settles or the process exits.
 */
export async function writeMpvSensitiveConf(
  opts: {
    readonly url: string;
    readonly headers?: Record<string, string>;
    readonly requiresYtdl?: boolean;
    readonly ytdlRawOptions?: string;
  },
  ipcEndpoint: ReturnType<typeof createMpvIpcEndpoint>,
): Promise<{ readonly path: string; readonly cleanup: () => Promise<void> } | null> {
  const lines = collectSensitiveMpvOptions(opts);
  if (lines.length === 0) return null;
  const body = `${lines
    .map((line) => {
      const eq = line.indexOf("=");
      return `${line.slice(0, eq)}=${quoteMpvConfValue(line.slice(eq + 1))}`;
    })
    .join("\n")}\n`;

  if (ipcEndpoint.kind === "unix_socket") {
    const path = `${ipcEndpoint.path}.conf`;
    await writeFile(path, body, { mode: 0o600 });
    return {
      path,
      cleanup: async () => {
        await rm(path, { force: true }).catch(() => {});
      },
    };
  }
  const dir = await createPrivateTempDir("mpv-conf");
  const path = join(dir, "kunai-mpv.conf");
  await writeFile(path, body, { mode: 0o600 });
  return {
    path,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

export function buildMpvArgs(
  opts: {
    url: string;
    urlKind?: MpvUrlKind;
    headers: Record<string, string>;
    subtitle: string | null;
    subtitleUrlKind?: MpvUrlKind;
    audioPreference?: string;
    subtitlePreference?: string;
    subtitleTracks?: readonly SubtitleTrack[];
    displayTitle: string;
    startAt?: number;
    requiresYtdl?: boolean;
    ytdlFormat?: string;
    ytdlRawOptions?: string;
    isLive?: boolean;
    /** Stremio addon file: confine this file's network behavior via `--{ ... --}`. */
    stremioAddon?: boolean;
    /** Local subtitle files owned by this playback. */
    localSubtitlePaths?: ReadonlySet<string>;
    chaptersFile?: string | null;
  },
  ipcPath: string | null,
  config?: {
    persistent?: boolean;
    includeStartArg?: boolean;
    mpv?: MpvRuntimeOptions;
    scriptPath?: string;
    /** Single `--script-opts=` value (comma-separated key=value). */
    scriptOpts?: string;
    /**
     * Owner-only conf file the sensitive options (`http-header-fields`,
     * `ytdl-raw-options`) were written into by {@link writeMpvSensitiveConf}.
     * When set, they leave argv — which is world-readable on POSIX — and only
     * `--include=<path>` is emitted.
     */
    sensitiveOptionsPath?: string;
  },
): string[] {
  if (!isAllowedMpvUrl(opts.url, opts.urlKind ?? "remote")) {
    throw new MpvLaunchError(
      "unsafe-target",
      "Refusing to launch mpv with unsafe stream URL scheme",
    );
  }

  const args: string[] = [];

  if (opts.stremioAddon) {
    // One-shot only: `--ytdl=no` is process-wide, so a persistent session
    // disables it per file in `buildPersistentLoadfileOptions` instead.
    if (config?.persistent !== true) args.push("--ytdl=no");
  } else if (isYoutubeWatchUrl(opts.url) || opts.requiresYtdl) {
    args.push("--ytdl=yes");
    args.push(`--ytdl-format=${opts.ytdlFormat ?? DEFAULT_MPV_YTDL_FORMAT}`);
    // `ytdl-raw-options` (may carry a po_token) is emitted through the
    // sensitive sink below — it must not ride argv when a conf path exists.
  } else if (opts.url.toLowerCase().includes(".m3u8") && config?.persistent !== true) {
    // One-shot only. `--ytdl=no` is process-wide and a later per-file
    // `ytdl: "yes"` cannot lift it, so a persistent session launched on an HLS
    // stream could never play a YouTube URL handed to it over IPC afterwards —
    // mpv reported the loadfile as successful and then produced no video at all.
    // The persistent path already disables ytdl per file for remote HLS in
    // `buildPersistentLoadfileOptions`, which is the correct scope.
    args.push("--ytdl=no");
  }

  // Options that shape this file's request: referrer, user-agent and the
  // credential-bearing set. A one-shot process may carry them on argv, but in a
  // persistent session they must ride the file's `--{ ... --}` group instead —
  // process-wide values would leak into later loadfiles that carry no headers.
  const requestOptions: string[] = [];
  const { referer, userAgent } = normalizeStreamHttpHeaders(opts.headers);
  if (referer) requestOptions.push(`--referrer=${referer}`);
  if (userAgent) requestOptions.push(`--user-agent=${userAgent}`);
  // argv is world-readable on POSIX (`/proc/<pid>/cmdline`), so
  // credential-bearing options never ride it when a conf path was supplied —
  // they land in the owner-only `--include` file the caller wrote instead.
  const sensitive = collectSensitiveMpvOptions(opts);
  if (sensitive.length > 0) {
    if (config?.sensitiveOptionsPath) {
      requestOptions.push(`--include=${config.sensitiveOptionsPath}`);
    } else {
      for (const line of sensitive) requestOptions.push(`--${line}`);
    }
  }
  if (!config?.persistent) args.push(...requestOptions);
  // ani-cli plays mp4upload with --tls-verify=no; without it mpv rejects some hosts.
  // The mp4upload exception never applies to an addon file — its block carries
  // `--tls-verify=yes` and must not be cancelled by a process-level "no".
  const disableTlsVerify = !opts.stremioAddon && shouldDisableMpvTlsVerify(opts.url, opts.headers);
  if (disableTlsVerify && !config?.persistent) args.push("--tls-verify=no");

  for (const file of allowedLaunchSubtitleFiles(opts)) {
    args.push(`--sub-file=${file}`);
  }

  const alang = toMpvLanguageToken(opts.audioPreference, {
    forSubtitle: false,
  });
  if (alang) {
    args.push(`--alang=${alang}`);
  }
  const slang = (() => {
    if (isYoutubeWatchUrl(opts.url) || opts.requiresYtdl) {
      return toYoutubeSubtitlePreferenceTokens(opts.subtitlePreference).mpvSlang;
    }
    return toMpvLanguageToken(opts.subtitlePreference, { forSubtitle: true });
  })();
  if (slang) {
    args.push(`--slang=${slang}`);
    if (slang === "no") args.push("--sid=no");
    if ((isYoutubeWatchUrl(opts.url) || opts.requiresYtdl) && slang !== "no" && slang !== "orig") {
      args.push("--subs-fallback=default");
    }
  }

  const includeStartArg = (config?.includeStartArg ?? config?.persistent !== true) && !opts.isLive;
  if (includeStartArg && shouldApplyStartAtSeek(opts.startAt)) {
    args.push(`--start=${opts.startAt}`);
  }
  args.push(`--force-media-title=${opts.displayTitle}`);
  if (opts.chaptersFile) {
    args.push(`--chapters-file=${opts.chaptersFile}`);
  }
  if (config?.persistent) {
    // keep-open=no is intentional: with keep-open=yes, mpv silently pauses at the last
    // frame on natural EOF and never fires the end-file IPC event, so play() hangs and
    // auto-advance is unreachable. keep-open=no fires end-file with reason "eof" reliably.
    // Completion depends on that event: without it the result stays unknown and history
    // is never marked completed.
    // idle=yes keeps the process alive between episodes; force-window=immediate gives
    // instant visual feedback while mpv is still resolving the media.
    args.push("--keep-open=no");
    args.push("--idle=yes");
  } else {
    args.push("--keep-open=no");
    args.push("--idle=no");
  }
  args.push("--force-window=immediate");
  // Kunai resumes via `--start` / IPC when `shouldApplyStartAtSeek(startAt)`. mpv defaults
  // `--resume-playback=yes`, which restores watch-later positions on load — that clashes
  // with explicit episode changes (N / auto-next) and looks like a stale resume offset.
  args.push("--resume-playback=no");
  args.push("--autofit-smaller=1280x720");
  args.push("--autofit-larger=90%x90%");
  args.push("--cache=yes");
  args.push("--cache-pause=yes");
  args.push("--cache-pause-initial=no");
  // `--demuxer-lavf-o` is single-valued: repeating it replaces the previous value
  // rather than merging. The local-HLS whitelist used to be pushed last and so
  // silently discarded whichever reconnect ladder had been chosen above. Collect
  // the fragments and emit the option exactly once.
  let reconnectLavfOptions: string;
  if (opts.isLive) {
    for (const [key, value] of Object.entries(LIVE_DEMUXER_OPTIONS)) {
      args.push(`--${key}=${value}`);
    }
    reconnectLavfOptions = LIVE_DEMUXER_LAVF_OPTIONS;
  } else {
    args.push("--cache-pause-wait=2");
    const fastStart = config?.mpv?.startupPriority === "fast";
    if (fastStart) {
      args.push("--demuxer-readahead-secs=10");
      args.push("--demuxer-max-bytes=48MiB");
      // Shorter reconnect window so dead CDNs fail fast into Kunai failover.
      reconnectLavfOptions =
        "reconnect=1,reconnect_streamed=1,reconnect_on_network_error=1,reconnect_delay_max=3,reconnect_max_retries=3";
    } else {
      args.push("--demuxer-readahead-secs=60");
      args.push("--demuxer-max-bytes=200MiB");
      // libavformat HTTP/HLS reconnect hints (backend-dependent). We still rely on IPC
      // watchdogs + refresh/reload; keep-open=always is intentionally not used here because
      // it can suppress end-file and stall autoplay/session hand-off (see keep-open=no above).
      reconnectLavfOptions =
        "reconnect=1,reconnect_streamed=1,reconnect_on_network_error=1,reconnect_delay_max=10,reconnect_max_retries=8";
    }
  }
  // Materialized local HLS playlists reference remote HTTPS segments. libavformat defaults
  // to file,crypto,data only for local manifests, which makes every segment fail instantly.
  const demuxerLavfOptions = composeDemuxerLavfOptions(
    reconnectLavfOptions,
    isLocalHlsManifestPlaybackUrl(opts.url) ? LOCAL_HLS_DEMUXER_LAVF_OPTIONS : undefined,
  );
  if (demuxerLavfOptions) {
    args.push(`--demuxer-lavf-o=${demuxerLavfOptions}`);
  }
  if (config?.mpv?.hwdecMode === "off") {
    args.push("--hwdec=no");
  } else if (config?.mpv?.hwdecMode === "auto") {
    if (config.mpv.hwdecBackend) {
      // Probe output is exact mpv vocabulary (including `-copy` backends), not a
      // user-supplied option string; emit it as one argv token.
      args.push(`--hwdec=${config.mpv.hwdecBackend}`);
    }
  } else if (config?.mpv?.hwdecMode) {
    // The config union is closed mpv vocabulary, so this remains one safe argv
    // token rather than a user-controlled option string.
    args.push(`--hwdec=${config.mpv.hwdecMode}`);
  }
  if (config?.mpv?.clean || config?.mpv?.noUserConfig) args.push("--no-config");
  const hdrArgs = resolveMpvHdrArgs({
    hdrMode: config?.mpv?.hdrMode,
    supportsGpuNext: config?.mpv?.supportsGpuNext,
  });
  for (const hdrArg of hdrArgs) {
    args.push(hdrArg);
  }
  if (config?.mpv?.debug) {
    // `--term-msg-level` is not a valid mpv flag and aborts launch; use msg-level only.
    args.push("--msg-level=all=v");
  }
  if (config?.mpv?.logFile) {
    args.push(`--log-file=${config.mpv.logFile}`);
  }
  if (ipcPath) args.push(`--input-ipc-server=${ipcPath}`);
  if (config?.scriptPath) args.push(`--script=${config.scriptPath}`);
  // A persistent session always carries the ytdl guard, even when it launches on
  // a non-YouTube URL: it can be handed a YouTube watch URL later over IPC, and
  // `script-opts` cannot be set per-file. Verified against mpv 0.41 with
  // mpv-ytdlautoformat installed — a loadfile carrying `ytdl-format=…height<=144`
  // still played 720p unless the guard was present in the launch args.
  const needsYoutubeScriptOpts =
    isYoutubeWatchUrl(opts.url) || opts.requiresYtdl || config?.persistent === true;
  if (config?.scriptOpts || needsYoutubeScriptOpts) {
    const scriptOpts = joinMpvScriptOpts(
      config?.scriptOpts,
      needsYoutubeScriptOpts ? buildYoutubeMpvScriptOpts() : undefined,
    );
    if (scriptOpts) args.push(`--script-opts=${scriptOpts}`);
  }

  if (opts.stremioAddon) {
    // File-local confinement for this addon file only: no redirects at the
    // lavf layer (FFmpeg 8.1+/7.1.4 `max_redirects`; older builds may ignore
    // it, which is why the strict preflight exists), no unsafe playlists, and
    // TLS verification regardless of any user-level mpv.conf. Best effort —
    // mpv fetches the URL separately after preflight. For
    // a persistent session the same per-file set rides the initial argv here
    // and every IPC loadfile, including `--ytdl=no` (one-shot already carries
    // it process-wide above).
    args.push(
      "--{",
      ...(config?.persistent ? requestOptions : []),
      "--stream-lavf-o=max_redirects=0",
      "--load-unsafe-playlists=no",
      "--tls-verify=yes",
      ...(config?.persistent ? ["--ytdl=no"] : []),
      opts.url,
      "--}",
    );
  } else if (config?.persistent && (disableTlsVerify || requestOptions.length > 0)) {
    // mpv restores the user's baseline after this file, just as loadfile's
    // per-file options do for replacements and reconnects — so this file's
    // request options (and the validated TLS exception, when it applies) ride
    // inside the scope. The validated target cannot be parsed as a
    // command-line option.
    args.push(
      "--{",
      ...requestOptions,
      ...(disableTlsVerify ? ["--tls-verify=no"] : []),
      opts.url,
      "--}",
    );
  } else {
    args.push("--", opts.url);
  }

  return args;
}

async function unlinkIfExists(path: string): Promise<void> {
  if (!existsSync(path)) return;
  await unlink(path).catch(() => {});
}

async function cleanupUnixSocketFile(socketPath: string): Promise<boolean> {
  if (!existsSync(socketPath)) return true;
  try {
    await unlink(socketPath);
    return true;
  } catch {
    return false;
  }
}

async function closeIpcSession(ipcSession: MpvIpcSession | null): Promise<void> {
  if (ipcSession === null) return;
  await ipcSession.close().catch(() => {});
}

export async function attachLateSubtitles(
  ipcSession: MpvIpcSession | null,
  attachment: LateSubtitleAttachment,
  onAttached?: (trackCount: number) => void,
  resolveSubtitle?: (url: string) => Promise<string | null>,
): Promise<number> {
  if (!ipcSession) return 0;
  let attached = 0;
  // Metadata and dedup stay on the original URLs; a resolver decides what mpv
  // receives and `null` skips the track — there is no raw-URL fallback.
  const primarySubtitle = attachment.primarySubtitle
    ? await resolveSubtitle?.(attachment.primarySubtitle)
    : null;
  if (attachment.primarySubtitle && !primarySubtitle) {
    dbg("mpv", "subtitle-target-rejected", { delivery: "late-primary" });
  }
  if (primarySubtitle && isLocalSubtitlePath(primarySubtitle)) {
    const primary = describeSubtitleTrackForMpv(
      attachment.primarySubtitle ?? "",
      attachment.subtitleTracks,
    );
    const result = await ipcSession.send([
      "sub-add",
      primarySubtitle,
      "select",
      primary.title,
      primary.language,
    ]);
    if (result.ok) attached += 1;
  }

  for (const track of collectAdditionalSubtitleTracks(
    attachment.primarySubtitle ?? null,
    attachment.subtitleTracks,
  )) {
    const resolved = await resolveSubtitle?.(track.url);
    if (!resolved || !isLocalSubtitlePath(resolved)) {
      dbg("mpv", "subtitle-target-rejected", { delivery: "late-additional" });
      continue;
    }
    const result = await ipcSession.send([
      "sub-add",
      resolved,
      "auto",
      track.display ?? "",
      track.language ?? "",
    ]);
    if (result.ok) attached += 1;
  }

  if (attached > 0) onAttached?.(attached);
  return attached;
}
