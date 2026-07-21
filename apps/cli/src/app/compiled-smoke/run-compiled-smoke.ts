import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { createQueuePlaybackAttempt } from "@/app/playback/queue-playback-attempt";
import type { Container } from "@/container";
import { restoreQueueSessionWithResume } from "@/domain/queue/restore-queue-session";
import type { StreamInfo } from "@/domain/types";

import {
  COMPILED_SMOKE_FIXTURES,
  isCompiledSmokeScenarioId,
  type CompiledSmokeScenarioId,
} from "./scenarios";

function appendRuntimeEvidence(entry: Record<string, unknown>): void {
  const path = process.env.KUNAI_COMPILED_SMOKE_EVIDENCE?.trim();
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(
    path,
    `${JSON.stringify({ ts: Date.now(), source: "runtime", pid: process.pid, ...entry })}\n`,
  );
}

function stream(url: string): StreamInfo {
  return {
    url,
    headers: { Referer: "https://smoke.kunai.test/" },
    timestamp: Date.now(),
  };
}

async function playOnce(
  container: Container,
  url: string,
  displayTitle: string,
  playbackMode: "manual" | "autoplay-chain" = "autoplay-chain",
): Promise<{ readonly endReason: string; readonly sawPlaybackStart: boolean }> {
  let sawPlaybackStart = false;
  const result = await container.player.play(stream(url), {
    url,
    displayTitle,
    playbackMode,
    onPlaybackEvent: (event) => {
      appendRuntimeEvidence({ type: "playback-event", event: event.type });
      if (event.type === "playback-started" || event.type === "player-ready") {
        sawPlaybackStart = true;
      }
    },
  });
  appendRuntimeEvidence({
    type: "playback-result",
    endReason: result.endReason,
    sawPlaybackStart,
  });
  if (playbackMode === "autoplay-chain") {
    await container.player.releasePersistentSession();
  }
  return { endReason: result.endReason, sawPlaybackStart };
}

async function runMovie(container: Container): Promise<number> {
  const fx = COMPILED_SMOKE_FIXTURES.movie;
  const play = await playOnce(container, fx.streamUrl, fx.title);
  if (!play.sawPlaybackStart && play.endReason !== "eof") return 1;
  container.historyRepository.upsertProgress({
    title: { id: fx.titleId, kind: fx.mediaKind, title: fx.title },
    positionSeconds: 120,
    durationSeconds: 600,
    completed: false,
    providerId: fx.providerId,
  });
  appendRuntimeEvidence({ type: "history-upsert", titleId: fx.titleId, mediaKind: fx.mediaKind });
  return 0;
}

async function runSeries(container: Container): Promise<number> {
  const fx = COMPILED_SMOKE_FIXTURES.series;
  const play = await playOnce(container, fx.streamUrl, fx.title);
  if (!play.sawPlaybackStart && play.endReason !== "eof") return 1;
  container.historyRepository.upsertProgress({
    title: { id: fx.titleId, kind: fx.mediaKind, title: fx.title },
    episode: { season: fx.season, episode: fx.episode },
    positionSeconds: 90,
    durationSeconds: 600,
    completed: false,
    providerId: fx.providerId,
  });
  appendRuntimeEvidence({
    type: "history-upsert",
    titleId: fx.titleId,
    season: fx.season,
    episode: fx.episode,
  });
  return 0;
}

async function runAnime(container: Container): Promise<number> {
  const fx = COMPILED_SMOKE_FIXTURES.anime;
  const play = await playOnce(container, fx.streamUrl, fx.title);
  if (!play.sawPlaybackStart && play.endReason !== "eof") return 1;
  container.historyRepository.upsertProgress({
    title: { id: fx.titleId, kind: fx.mediaKind, title: fx.title },
    episode: { absoluteEpisode: fx.absoluteEpisode },
    positionSeconds: 80,
    durationSeconds: 600,
    completed: false,
    providerId: fx.providerId,
  });
  appendRuntimeEvidence({
    type: "history-upsert",
    titleId: fx.titleId,
    absoluteEpisode: fx.absoluteEpisode,
  });
  return 0;
}

async function runQueueManual(container: Container): Promise<number> {
  const fx = COMPILED_SMOKE_FIXTURES.queueManual;
  const claimed = container.queueService.enqueue({
    title: fx.claimedTitle,
    mediaKind: "anime",
    titleId: fx.claimedTitleId,
    absoluteEpisode: fx.claimedAbsoluteEpisode,
    source: "manual",
  });
  const sibling = container.queueService.enqueue({
    title: fx.siblingTitle,
    mediaKind: "anime",
    titleId: fx.siblingTitleId,
    absoluteEpisode: fx.siblingAbsoluteEpisode,
    source: "manual",
  });
  const intent = container.queueService.beginPlayback(claimed.id, "queue");
  if (!intent) return 1;
  const attempt = createQueuePlaybackAttempt(container.queueService, intent);
  attempt.setStage("player-launch");
  let acknowledged = false;
  const result = await container.player.play(stream(fx.streamUrl), {
    url: fx.streamUrl,
    displayTitle: fx.claimedTitle,
    playbackMode: "autoplay-chain",
    onPlaybackEvent: (event) => {
      appendRuntimeEvidence({ type: "playback-event", event: event.type });
      if (event.type === "playback-started") {
        acknowledged = attempt.acknowledgeStarted();
        appendRuntimeEvidence({
          type: "queue-ack",
          queueEntryId: claimed.id,
          acknowledged,
        });
      }
    },
  });
  await container.player.releasePersistentSession();
  if (!acknowledged) {
    attempt.rollbackIfUnacknowledged("mpv-launch-failed", "no playback-started");
    return 1;
  }
  appendRuntimeEvidence({
    type: "queue-manual-done",
    claimedId: claimed.id,
    siblingId: sibling.id,
    endReason: result.endReason,
  });
  return 0;
}

async function runAutoNext(container: Container): Promise<number> {
  const fx = COMPILED_SMOKE_FIXTURES.autoNext;
  let sawPlaybackStart = false;
  const first = await container.player.play(stream(fx.firstStreamUrl), {
    url: fx.firstStreamUrl,
    displayTitle: `${fx.title} Ep1`,
    playbackMode: "autoplay-chain",
    onPlaybackEvent: (event) => {
      appendRuntimeEvidence({ type: "playback-event", event: event.type });
      if (event.type === "playback-started" || event.type === "player-ready") {
        sawPlaybackStart = true;
      }
    },
  });
  if (!sawPlaybackStart && first.endReason !== "eof") return 1;
  sawPlaybackStart = false;
  const second = await container.player.play(stream(fx.secondStreamUrl), {
    url: fx.secondStreamUrl,
    displayTitle: `${fx.title} Ep2`,
    playbackMode: "autoplay-chain",
    onPlaybackEvent: (event) => {
      appendRuntimeEvidence({ type: "playback-event", event: event.type });
      if (event.type === "playback-started" || event.type === "player-ready") {
        sawPlaybackStart = true;
      }
    },
  });
  if (!sawPlaybackStart && second.endReason !== "eof") return 1;
  appendRuntimeEvidence({
    type: "auto-next-done",
    first: first.endReason,
    second: second.endReason,
  });
  await container.player.releasePersistentSession();
  return 0;
}

async function runFailedHandoff(container: Container): Promise<number> {
  const fx = COMPILED_SMOKE_FIXTURES.failedHandoff;
  process.env.KUNAI_FAKE_MPV_MODE = "fail-pre-loaded";
  // Prevent reconnect from turning a pre-start failure into a successful play.
  await container.config.update({
    mpvInProcessStreamReconnect: false,
    mpvInProcessStreamReconnectMaxAttempts: 0,
  });
  const entry = container.queueService.enqueue({
    title: fx.title,
    mediaKind: "anime",
    titleId: fx.titleId,
    absoluteEpisode: fx.absoluteEpisode,
    source: "manual",
  });
  const intent = container.queueService.beginPlayback(entry.id, "queue");
  if (!intent) return 1;
  const attempt = createQueuePlaybackAttempt(container.queueService, intent);
  attempt.setStage("player-launch");
  let sawStart = false;
  await container.player.play(stream(fx.streamUrl), {
    url: fx.streamUrl,
    displayTitle: fx.title,
    playbackMode: "autoplay-chain",
    onPlaybackEvent: (event) => {
      appendRuntimeEvidence({ type: "playback-event", event: event.type });
      if (event.type === "playback-started") sawStart = true;
    },
  });
  await container.player.releasePersistentSession();
  if (sawStart) {
    appendRuntimeEvidence({ type: "failed-handoff-unexpected-start" });
    return 1;
  }
  const rolled = attempt.rollbackIfUnacknowledged(
    "mpv-launch-failed",
    "smoke pre-file-loaded failure",
  );
  appendRuntimeEvidence({ type: "failed-handoff-rollback", queueEntryId: entry.id, rolled });
  return rolled ? 0 : 1;
}

async function runShutdownRestore(container: Container): Promise<number> {
  const phase = process.env.KUNAI_COMPILED_SMOKE_PHASE?.trim() || "seed";
  const fx = COMPILED_SMOKE_FIXTURES.shutdownRestore;

  if (phase === "restore") {
    const recoverable = container.queueService.listRecoverableSessions();
    const sourceId = recoverable[0]?.id;
    if (!sourceId) {
      appendRuntimeEvidence({ type: "shutdown-restore-missing-source" });
      return 1;
    }
    const restored = restoreQueueSessionWithResume(
      {
        queue: container.queueService,
        readHistory: () => container.historyRepository.listRecent(50),
      },
      sourceId,
    );
    appendRuntimeEvidence({
      type: "shutdown-restore-done",
      sourceId,
      restoredCount: restored.restoredCount,
      resumeTitleId: restored.resumeHead?.titleId,
      resumeAbsoluteEpisode: restored.resumeHead?.absoluteEpisode,
      resumeId: restored.resumeHead?.id,
    });
    return restored.resumeHead?.titleId === fx.titleId &&
      restored.resumeHead?.absoluteEpisode === fx.absoluteEpisode
      ? 0
      : 1;
  }

  process.env.KUNAI_FAKE_MPV_MODE = "hold";
  const pending = container.queueService.enqueue({
    title: "Pending Tail",
    mediaKind: "anime",
    titleId: "anilist:smoke-shutdown-tail",
    absoluteEpisode: 1,
    source: "manual",
  });
  const interrupted = container.queueService.enqueue({
    title: fx.title,
    mediaKind: "anime",
    titleId: fx.titleId,
    absoluteEpisode: fx.absoluteEpisode,
    source: "manual",
  });
  const intent = container.queueService.beginPlayback(interrupted.id, "queue");
  if (!intent) return 1;

  const playPromise = container.player.play(stream(fx.streamUrl), {
    url: fx.streamUrl,
    displayTitle: fx.title,
    playbackMode: "autoplay-chain",
    onPlaybackEvent: (event) => {
      appendRuntimeEvidence({ type: "playback-event", event: event.type });
    },
  });

  // Wait briefly for file-loaded / playback-start evidence, then shut down mid-hold.
  await Bun.sleep(400);
  const shutdown = container.queueService.prepareForShutdown();
  appendRuntimeEvidence({
    type: "shutdown-seed",
    interruptedId: interrupted.id,
    pendingId: pending.id,
    shutdown,
    sessionId: container.sessionId,
  });
  container.player.beginShutdown();
  await container.player.releasePersistentSession();
  void playPromise.catch(() => undefined);
  return shutdown === "recoverable" ? 0 : 1;
}

async function runReturnToShell(container: Container): Promise<number> {
  const fx = COMPILED_SMOKE_FIXTURES.returnToShell;
  const play = await playOnce(container, fx.streamUrl, fx.title);
  if (!play.sawPlaybackStart && play.endReason !== "eof") return 1;
  appendRuntimeEvidence({ type: "shell-alive-after-eof", at: Date.now() });
  await Bun.sleep(150);
  appendRuntimeEvidence({ type: "shell-heartbeat", at: Date.now() });
  // Prove the process survived EOF without exiting immediately.
  return 0;
}

export async function runCompiledSmoke(container: Container): Promise<number> {
  const scenarioRaw = process.env.KUNAI_COMPILED_SMOKE_SCENARIO?.trim() ?? "";
  if (!isCompiledSmokeScenarioId(scenarioRaw)) {
    appendRuntimeEvidence({ type: "invalid-scenario", scenario: scenarioRaw });
    return 1;
  }
  const scenario: CompiledSmokeScenarioId = scenarioRaw;
  appendRuntimeEvidence({
    type: "scenario-start",
    scenario,
    providers: container.engine.getProviderIds(),
  });

  try {
    switch (scenario) {
      case "movie":
        return await runMovie(container);
      case "series":
        return await runSeries(container);
      case "anime":
        return await runAnime(container);
      case "queue-manual":
        return await runQueueManual(container);
      case "auto-next":
        return await runAutoNext(container);
      case "failed-handoff":
        return await runFailedHandoff(container);
      case "shutdown-restore":
        return await runShutdownRestore(container);
      case "return-to-shell":
        return await runReturnToShell(container);
      default: {
        const _exhaustive: never = scenario;
        void _exhaustive;
        return 1;
      }
    }
  } catch (error) {
    appendRuntimeEvidence({
      type: "scenario-error",
      scenario,
      error: error instanceof Error ? error.message : String(error),
    });
    return 1;
  }
}
