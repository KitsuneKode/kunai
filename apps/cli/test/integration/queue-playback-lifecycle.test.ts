/**
 * Integration smoke: queue claim → fake-player acknowledgement → recovery.
 *
 * Proves the S3 queue contract end-to-end without live providers:
 * pending → in-flight → played only after `playback-started`, exact ID handoff,
 * pre-start rollback, crash leaves in-flight recoverable, restart restores that
 * row first, and the shell can render Up Next again after playback returns.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { QueueShell } from "@/app-shell/queue-shell";
import { buildQueueView } from "@/app-shell/queue-view";
import { claimQueuePlaybackLaunch } from "@/app-shell/root-queue-bridge";
import {
  playlistAdvanceFromQueueIntent,
  resolvePlaylistAutoNextCountdown,
} from "@/app/playback/playback-outcome";
import { createQueuePlaybackAttempt } from "@/app/playback/queue-playback-attempt";
import { runMpvPlaybackSession } from "@/app/playback/run-mpv-playback-session";
import { QueueService } from "@/domain/queue/QueueService";
import { restoreQueueSessionWithResume } from "@/domain/queue/restore-queue-session";
import type { EpisodeInfo, PlaybackResult, StreamInfo, TitleInfo } from "@/domain/types";
import type {
  PlayerOptions,
  PlayerPlaybackEvent,
  PlayerService,
} from "@/infra/player/PlayerService";
import { openKunaiDatabase, QueueRepository, runMigrations, type QueueEntry } from "@kunai/storage";
import React from "react";

import { captureFrame } from "../harness/render-capture";

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g");
const NOW = "2026-07-21T12:00:00.000Z";
const STREAM: StreamInfo = {
  url: "https://example.test/queue-lifecycle.m3u8",
  headers: {},
  timestamp: Date.now(),
};
const FINISHED: PlaybackResult = {
  endReason: "eof",
  watchedSeconds: 10,
  duration: 10,
  lastNonZeroPositionSeconds: 10,
  lastNonZeroDurationSeconds: 10,
  playerExitCode: 0,
  playerExitSignal: null,
};

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createQueue(sessionId = "session"): {
  readonly repo: QueueRepository;
  readonly queue: QueueService;
  readonly close: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "kunai-queue-playback-lifecycle-"));
  tempDirs.push(dir);
  const db = openKunaiDatabase(join(dir, "data.sqlite"));
  runMigrations(db, "data");
  const repo = new QueueRepository(db);
  repo.createQueueSession({
    id: sessionId,
    status: "active",
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
  });
  return {
    repo,
    queue: new QueueService(repo, sessionId),
    close: () => db.close(),
  };
}

function enqueueAnime(
  queue: QueueService,
  input: {
    readonly title: string;
    readonly titleId: string;
    readonly absoluteEpisode: number;
  },
): QueueEntry {
  return queue.enqueue({
    title: input.title,
    mediaKind: "anime",
    titleId: input.titleId,
    absoluteEpisode: input.absoluteEpisode,
    source: "manual",
  });
}

function fakePlayer(events: readonly PlayerPlaybackEvent[]): PlayerService {
  return {
    play: async (_stream, playOptions: PlayerOptions) => {
      for (const event of events) {
        playOptions.onPlaybackEvent?.(event);
      }
      return FINISHED;
    },
    releasePersistentSession: async () => undefined,
    killActiveMpvProcessesSync: () => undefined,
    beginShutdown: () => undefined,
    isAvailable: async () => true,
    playLocal: async () => FINISHED,
  };
}

function noopHooks(overrides: { onConfirmedPlaybackStart?: () => void } = {}) {
  return {
    onFeedback: () => undefined,
    onPresenceLaunch: () => undefined,
    onPresenceStarted: () => undefined,
    onPresenceProgress: () => undefined,
    onPresenceSubtitles: () => undefined,
    onPresencePaused: () => undefined,
    onPresenceResumed: () => undefined,
    setPlaybackStatus: () => undefined,
    getPlaybackStatus: () => "idle",
    onTrackChanged: () => undefined,
    onShareCopied: () => undefined,
    onPlayerReady: () => undefined,
    ...overrides,
  };
}

async function playWithFakePlayer(input: {
  readonly player: PlayerService;
  readonly title: TitleInfo;
  readonly episode: EpisodeInfo;
  readonly onConfirmedStart?: () => void;
}): Promise<PlaybackResult> {
  return runMpvPlaybackSession({
    stream: STREAM,
    title: input.title,
    episode: input.episode,
    player: input.player,
    playOptions: {},
    subtitleStatus: "none",
    startAt: 0,
    sessionAborted: false,
    iterationAborted: false,
    shareLinkContext: {
      mode: "anime",
      title: input.title,
      episode: { season: input.episode.season, episode: input.episode.episode },
    },
    timing: null,
    hooks: noopHooks({ onConfirmedPlaybackStart: input.onConfirmedStart }),
  });
}

describe("queue playback lifecycle integration", () => {
  test("manual claim acknowledges only after fake-player playback-started", async () => {
    const { repo, queue, close } = createQueue();
    const head = enqueueAnime(queue, {
      title: "Head",
      titleId: "anilist:1",
      absoluteEpisode: 1,
    });
    const selected = enqueueAnime(queue, {
      title: "Claimed",
      titleId: "anilist:42",
      absoluteEpisode: 13,
    });

    const launch = claimQueuePlaybackLaunch(queue, selected.id, "queue");
    expect(launch?.intent.queueEntryId).toBe(selected.id);
    expect(launch?.intent.absoluteEpisode).toBe(13);
    expect(repo.getById(head.id)?.status).toBe("pending");
    expect(repo.getById(selected.id)?.status).toBe("in-flight");

    const attempt = createQueuePlaybackAttempt(queue, launch!.intent, { now: () => NOW });

    await playWithFakePlayer({
      player: fakePlayer([{ type: "mpv-process-started" }, { type: "ipc-connected" }]),
      title: { id: "anilist:42", name: "Claimed", type: "series" },
      episode: { season: 1, episode: 13, absoluteEpisode: 13 },
      onConfirmedStart: () => attempt.acknowledgeStarted(NOW),
    });
    expect(attempt.acknowledged).toBe(false);
    expect(repo.getById(selected.id)?.status).toBe("in-flight");

    await playWithFakePlayer({
      player: fakePlayer([{ type: "playback-started" }]),
      title: { id: "anilist:42", name: "Claimed", type: "series" },
      episode: { season: 1, episode: 13, absoluteEpisode: 13 },
      onConfirmedStart: () => attempt.acknowledgeStarted(NOW),
    });
    expect(attempt.acknowledged).toBe(true);
    expect(repo.getById(selected.id)?.status).toBe("played");
    expect(repo.getById(head.id)?.status).toBe("pending");
    expect(attempt.rollbackIfUnacknowledged("playback-aborted")).toBe(false);
    close();
  });

  test("auto-next claims exact ID and carries absolute anime identity", () => {
    const { repo, queue, close } = createQueue();
    const head = enqueueAnime(queue, {
      title: "Head",
      titleId: "anilist:1",
      absoluteEpisode: 1,
    });
    const next = enqueueAnime(queue, {
      title: "Abs Anime",
      titleId: "anilist:42",
      absoluteEpisode: 13,
    });

    const claimed = queue.beginPlayback(next.id, "auto-next", NOW);
    expect(claimed?.queueEntryId).toBe(next.id);
    expect(claimed?.absoluteEpisode).toBe(13);
    expect(repo.getById(head.id)?.status).toBe("pending");
    expect(repo.getById(next.id)?.status).toBe("in-flight");

    const advanced = resolvePlaylistAutoNextCountdown({
      intent: claimed!,
      title: next.title,
      countdown: "advanced",
    });
    expect(advanced.kind).toBe("advance");
    if (advanced.kind !== "advance") throw new Error("expected advance");
    expect(advanced.outcome.titleInfo.queuePlaybackIntent?.queueEntryId).toBe(next.id);
    expect(advanced.outcome.titleInfo.queuePlaybackIntent?.absoluteEpisode).toBe(13);
    expect(advanced.outcome.season).toBe(1);
    expect(advanced.outcome.episode).toBe(13);

    const handoff = playlistAdvanceFromQueueIntent({
      intent: claimed!,
      title: next.title,
    });
    expect(handoff.titleInfo.id).toBe("anilist:42");
    expect(handoff.titleInfo.queuePlaybackIntent?.queueEntryId).toBe(next.id);
    close();
  });

  test("failed launch rolls back the same row and position", () => {
    const { repo, queue, close } = createQueue();
    const first = enqueueAnime(queue, {
      title: "First",
      titleId: "anilist:10",
      absoluteEpisode: 2,
    });
    const second = enqueueAnime(queue, {
      title: "Second",
      titleId: "anilist:11",
      absoluteEpisode: 3,
    });

    const intent = queue.beginPlayback(first.id, "queue", NOW);
    expect(intent).toBeDefined();
    const positionBefore = repo.getById(first.id)?.queuePosition;
    const attempt = createQueuePlaybackAttempt(queue, intent!, { now: () => NOW });
    attempt.setStage("player-launch");

    expect(attempt.rollbackIfUnacknowledged("mpv-launch-failed", "fake player refused")).toBe(true);
    expect(repo.getById(first.id)?.status).toBe("pending");
    expect(repo.getById(first.id)?.queuePosition).toBe(positionBefore);
    expect(queue.getAll().map((row) => row.id)).toEqual([first.id, second.id]);
    expect(repo.getById(first.id)?.lastFailure).toEqual({
      code: "mpv-launch-failed",
      stage: "player-launch",
      at: NOW,
      detail: "fake player refused",
    });
    expect(queue.peekNext()?.id).toBe(first.id);
    close();
  });

  test("crash leaves in-flight; restart restores exact row first", () => {
    const { repo, close } = createQueue("crashed");
    const crashed = new QueueService(repo, "crashed");
    const head = enqueueAnime(crashed, {
      title: "Head",
      titleId: "anilist:1",
      absoluteEpisode: 1,
    });
    const interrupted = enqueueAnime(crashed, {
      title: "Interrupted",
      titleId: "anilist:9",
      absoluteEpisode: 7,
    });

    expect(crashed.beginPlayback(interrupted.id, "queue", NOW)).toBeDefined();
    expect(repo.getById(interrupted.id)?.status).toBe("in-flight");
    expect(crashed.prepareForShutdown("2026-07-21T12:01:00.000Z")).toBe("recoverable");
    expect(repo.getById(interrupted.id)?.status).toBe("in-flight");
    expect(repo.getQueueSession("crashed")?.status).toBe("recoverable");

    repo.createQueueSession({
      id: "fresh",
      status: "active",
      createdAt: "2026-07-21T13:00:00.000Z",
      updatedAt: "2026-07-21T13:00:00.000Z",
    });
    const fresh = new QueueService(repo, "fresh");
    const result = restoreQueueSessionWithResume(
      {
        queue: fresh,
        readHistory: () => [],
      },
      "crashed",
    );

    expect(result.restoredCount).toBe(2);
    expect(result.resumeHead?.id).toBe(interrupted.id);
    expect(repo.getById(interrupted.id)?.status).toBe("pending");
    expect(fresh.peekNext()?.id).toBe(interrupted.id);
    expect(fresh.peekNext()?.absoluteEpisode).toBe(7);
    expect(fresh.getAll().map((row) => row.id)).toEqual([interrupted.id, head.id]);
    close();
  });

  test("shell returns to Up Next after acknowledged playback", async () => {
    const { repo, queue, close } = createQueue();
    const playing = enqueueAnime(queue, {
      title: "Now Playing",
      titleId: "anilist:42",
      absoluteEpisode: 5,
    });
    const remaining = enqueueAnime(queue, {
      title: "Still Queued",
      titleId: "anilist:99",
      absoluteEpisode: 1,
    });

    const intent = queue.beginPlayback(playing.id, "queue", NOW);
    const attempt = createQueuePlaybackAttempt(queue, intent!, { now: () => NOW });

    const result = await playWithFakePlayer({
      player: fakePlayer([{ type: "playback-started" }]),
      title: { id: "anilist:42", name: "Now Playing", type: "series" },
      episode: { season: 1, episode: 5, absoluteEpisode: 5 },
      onConfirmedStart: () => attempt.acknowledgeStarted(NOW),
    });
    expect(result.endReason).toBe("eof");
    expect(repo.getById(playing.id)?.status).toBe("played");

    const pending = queue.getUnplayed();
    expect(pending.map((row) => row.id)).toEqual([remaining.id]);

    const view = buildQueueView({
      entries: pending,
      selectedId: remaining.id,
      resolvePoster: () => undefined,
      recoverableSessions: 0,
    });
    const frame = captureFrame(
      React.createElement(QueueShell, {
        view,
        columns: 100,
        listWidth: 92,
        rowWidth: 88,
      }),
      { columns: 100 },
    ).replace(ANSI, "");

    expect(frame).toContain("UP NEXT");
    expect(frame).toContain("Still Queued");
    expect(frame).not.toContain("Now Playing");
    close();
  });
});
