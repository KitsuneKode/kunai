import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PlaybackTimingMetadata, StreamInfo, TitleInfo } from "@/domain/types";

import {
  buildOfflineBetaSmokeReport,
  buildOfflineBetaSmokeSkippedReport,
  type OfflineBetaSmokeCheck,
} from "./offline-beta-smoke-report";

type OfflineBetaProfile = {
  readonly rootDir: string;
  readonly configHome: string;
  readonly dataHome: string;
  readonly cacheHome: string;
  readonly downloadDir: string;
};

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function readOptIn():
  | { readonly mediaUrl: string; readonly subtitleUrl: string }
  | { readonly skipped: true; readonly reason: string } {
  if (process.env.KUNAI_OFFLINE_BETA_SMOKE !== "1") {
    return {
      skipped: true,
      reason:
        "Set KUNAI_OFFLINE_BETA_SMOKE=1 with KUNAI_OFFLINE_SMOKE_MEDIA_URL and KUNAI_OFFLINE_SMOKE_SUBTITLE_URL to run",
    };
  }
  const mediaUrl = process.env.KUNAI_OFFLINE_SMOKE_MEDIA_URL?.trim() ?? "";
  const subtitleUrl = process.env.KUNAI_OFFLINE_SMOKE_SUBTITLE_URL?.trim() ?? "";
  if (!mediaUrl || !subtitleUrl) {
    return {
      skipped: true,
      reason: "KUNAI_OFFLINE_SMOKE_MEDIA_URL and KUNAI_OFFLINE_SMOKE_SUBTITLE_URL are required",
    };
  }
  return { mediaUrl, subtitleUrl };
}

function createIsolatedProfile(): OfflineBetaProfile {
  const rootDir = mkdtempSync(join(tmpdir(), "kunai-live-offline-beta-"));
  const profile = {
    rootDir,
    configHome: join(rootDir, "config"),
    dataHome: join(rootDir, "data"),
    cacheHome: join(rootDir, "cache"),
    downloadDir: join(rootDir, "downloads"),
  };
  process.env.XDG_CONFIG_HOME = profile.configHome;
  process.env.XDG_DATA_HOME = profile.dataHome;
  process.env.XDG_CACHE_HOME = profile.cacheHome;
  process.on("exit", () => {
    rmSync(rootDir, { force: true, recursive: true });
  });
  return profile;
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
  intervalMs = 100,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await Bun.sleep(intervalMs);
  }
  return predicate();
}

function collectTempResidueNames(root: string): readonly string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (
        /\.tmp\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          entry.name,
        )
      ) {
        found.push(entry.name);
      }
    }
  };
  walk(root);
  return found;
}

const SMOKE_TITLE: TitleInfo = {
  id: "offline-beta-smoke",
  type: "series",
  name: "Offline Beta Smoke",
};

const SMOKE_TIMING: PlaybackTimingMetadata = {
  tmdbId: "offline-beta-smoke",
  type: "series",
  intro: [{ startMs: 0, endMs: 1_000 }],
  recap: [],
  credits: [],
  preview: [],
};

const optIn = readOptIn();
if ("skipped" in optIn) {
  printJson(buildOfflineBetaSmokeSkippedReport(optIn.reason));
  process.exit(0);
}

const profile = createIsolatedProfile();

const ytDlp = Boolean(Bun.which("yt-dlp"));
const ffprobe = Boolean(Bun.which("ffprobe"));
const mpv = Boolean(Bun.which("mpv"));
if (!ytDlp || !ffprobe || !mpv) {
  printJson({
    ok: false,
    skipped: false,
    profileRoot: profile.rootDir,
    reason: "yt-dlp, ffprobe, and mpv must all be on PATH",
    tools: { ytDlp, ffprobe, mpv },
  });
  process.exit(1);
}

const { createContainer, disposeContainer } = await import("@/container");
const { checkDeps } = await import("@/ui");
const capabilitySnapshot = await checkDeps("offline-beta-smoke", { silent: true });

const stream: StreamInfo = {
  url: optIn.mediaUrl,
  subtitle: optIn.subtitleUrl,
  headers: {},
  timestamp: Date.now(),
};

const checks: OfflineBetaSmokeCheck[] = [];
let exitCode = 1;

try {
  let container = await createContainer({
    debug: true,
    capabilitySnapshot,
  });

  await container.config.update({
    downloadsEnabled: true,
    downloadPath: profile.downloadDir,
  });

  const cancelJob = await container.downloadService.enqueue({
    title: SMOKE_TITLE,
    episode: { season: 1, episode: 1, name: "Cancel Probe" },
    stream,
    providerId: "offline-beta-smoke",
    mode: "series",
    timing: SMOKE_TIMING,
    outputDirectory: profile.downloadDir,
  });
  checks.push({
    id: "enqueue",
    ok: Boolean(cancelJob.id) && cancelJob.status === "queued",
  });

  await container.downloadService.abort(cancelJob.id);
  const aborted = container.downloadService.getJob(cancelJob.id);
  checks.push({
    id: "cancel",
    ok: aborted?.status === "aborted",
    detail: aborted ? `status=${aborted.status}` : "job-missing",
  });

  const pauseJob = await container.downloadService.enqueue({
    title: SMOKE_TITLE,
    episode: { season: 1, episode: 2, name: "Pause Probe" },
    stream,
    providerId: "offline-beta-smoke",
    mode: "series",
    timing: SMOKE_TIMING,
    outputDirectory: profile.downloadDir,
  });

  const processing = container.downloadService.processQueue();
  const sawRunning = await waitUntil(
    () => container.downloadService.getJob(pauseJob.id)?.status === "running",
    45_000,
  );
  await container.downloadService.pauseActiveJobsForShutdown("download paused by shutdown");
  await processing;

  const afterPause = container.downloadService.getJob(pauseJob.id);
  checks.push({
    id: "shutdown-pause",
    ok:
      Boolean(sawRunning) &&
      afterPause?.status === "queued" &&
      afterPause.failureKind === "interrupted",
    detail: sawRunning
      ? `status=${afterPause?.status ?? "missing"}`
      : "download never reached running before pause window",
  });

  await disposeContainer(container);

  container = await createContainer({
    debug: true,
    capabilitySnapshot,
  });
  await container.config.update({
    downloadsEnabled: true,
    downloadPath: profile.downloadDir,
  });

  const recovered = container.downloadService.getJob(pauseJob.id);
  checks.push({
    id: "restart-recovery",
    ok:
      recovered != null &&
      (recovered.status === "queued" ||
        recovered.status === "completed" ||
        recovered.status === "completed-with-notes"),
    detail: recovered ? `status=${recovered.status}` : "job-missing",
  });

  await container.downloadService.drainQueue(5 * 60_000);
  const completed = container.downloadService.getJob(pauseJob.id);
  const artifactOk =
    (completed?.status === "completed" || completed?.status === "completed-with-notes") &&
    Boolean(completed.outputPath) &&
    existsSync(completed.outputPath);
  checks.push({
    id: "artifact-discovery",
    ok: artifactOk,
    detail: completed ? `status=${completed.status}` : "job-missing",
  });

  const playable = artifactOk
    ? await container.offlineLibraryService.getPlayableSource(pauseJob.id)
    : null;
  const libraryReady = playable?.status === "ready";

  checks.push({
    id: "subtitle-sidecar",
    ok: Boolean(
      completed?.subtitlePath &&
      existsSync(completed.subtitlePath) &&
      libraryReady &&
      playable.source.subtitlePath,
    ),
    detail: completed?.subtitlePath ? "sidecar-present" : "sidecar-missing",
  });

  checks.push({
    id: "timing-metadata",
    ok: Boolean(completed?.introSkipJson && libraryReady && playable.source.timing),
    detail: completed?.introSkipJson ? "timing-present" : "timing-missing",
  });

  let playbackStarted = false;
  if (libraryReady) {
    const playPromise = container.player.playLocal({
      source: playable.source,
      onPlaybackEvent: (event) => {
        if (event.type === "playback-started") {
          playbackStarted = true;
          container.player.killActiveMpvProcessesSync();
        }
      },
    });
    await waitUntil(() => playbackStarted, 90_000);
    if (!playbackStarted) {
      container.player.killActiveMpvProcessesSync();
    }
    await playPromise.catch(() => undefined);
  }
  checks.push({
    id: "local-playback-start",
    ok: playbackStarted,
    detail: playbackStarted ? "playback-started" : "playback-started-missing",
  });

  container.player.beginShutdown();
  await container.player.releasePersistentSession().catch(() => undefined);
  container.downloadService.beginShutdown("download paused by shutdown");
  container.downloadService.killActiveProcessesSync();
  await container.downloadService.pauseActiveJobsForShutdown("download paused by shutdown");
  const hadActiveJobs = container.downloadService.hasActiveJobs();
  const tempResidue = collectTempResidueNames(profile.downloadDir);
  await disposeContainer(container);

  checks.push({
    id: "clean-shutdown",
    ok: !hadActiveJobs && tempResidue.length === 0,
    detail:
      tempResidue.length > 0
        ? `temp-residue=${tempResidue.length}`
        : hadActiveJobs
          ? "active-jobs-remain"
          : "clean",
  });

  const report = buildOfflineBetaSmokeReport(checks, profile.rootDir);
  printJson(report);
  exitCode = report.ok ? 0 : 1;
} catch (error) {
  printJson({
    ok: false,
    skipped: false,
    profileRoot: profile.rootDir,
    checks,
    error: error instanceof Error ? error.message : "offline beta smoke failed",
  });
  exitCode = 1;
}

process.exit(exitCode);
