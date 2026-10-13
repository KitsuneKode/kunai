import { describe, expect, test } from "bun:test";

import { readTorrentResumeSeconds, writeTorrentHistory } from "@/app/torrent/torrent-playback";
import type { PlaybackResult } from "@/domain/types";
import type { HistoryProgressInput } from "@kunai/storage";
import type { TitleIdentity } from "@kunai/types";

const TITLE: TitleIdentity = { id: "torrent:abc123", kind: "movie", title: "Some Film" };

type FakeHistory = {
  readonly getProgress?: (
    title: TitleIdentity,
  ) => { completed: boolean; positionSeconds: number } | undefined;
  readonly upsertCalls: HistoryProgressInput[];
};

function fakeContainer(history: FakeHistory) {
  // SAFETY: readTorrentResumeSeconds/writeTorrentHistory only touch
  // historyRepository.getProgress/upsertProgress and diagnosticsService.record.
  return {
    historyRepository: {
      getProgress: (title: TitleIdentity) => history.getProgress?.(title),
      upsertProgress: (input: HistoryProgressInput) => {
        history.upsertCalls.push(input);
      },
    },
    diagnosticsService: { record: () => {} },
  } as never;
}

function played(overrides: Partial<PlaybackResult>): PlaybackResult {
  const { endReason = "quit", duration = 0, watchedSeconds = 0 } = overrides;
  // SAFETY: every other PlaybackResult field is optional; the three required
  // fields are set above and the rest default per the domain contract.
  return { endReason, duration, watchedSeconds, ...overrides } as PlaybackResult;
}

describe("torrent history resume", () => {
  test("replays resume past a completed-engagement point", () => {
    const container = fakeContainer({
      getProgress: () => ({ completed: false, positionSeconds: 301 }),
      upsertCalls: [],
    });
    expect(readTorrentResumeSeconds(container, TITLE)).toBe(301);
  });

  test("no resume for fresh, completed, or short watches", () => {
    const fresh = fakeContainer({ upsertCalls: [] });
    expect(readTorrentResumeSeconds(fresh, TITLE)).toBeUndefined();
    const done = fakeContainer({
      getProgress: () => ({ completed: true, positionSeconds: 900 }),
      upsertCalls: [],
    });
    expect(readTorrentResumeSeconds(done, TITLE)).toBeUndefined();
    const short = fakeContainer({
      getProgress: () => ({ completed: false, positionSeconds: 5 }),
      upsertCalls: [],
    });
    expect(readTorrentResumeSeconds(short, TITLE)).toBeUndefined();
  });

  test("history read failure never blocks play", () => {
    // SAFETY: read path only calls getProgress; the throw exercises the
    // fail-open catch in readTorrentResumeSeconds.
    const container = {
      historyRepository: {
        getProgress: () => {
          throw new Error("db locked");
        },
      },
      diagnosticsService: { record: () => {} },
    } as never;
    expect(readTorrentResumeSeconds(container, TITLE)).toBeUndefined();
  });

  test("engaged quit checkpoints a resumable row", () => {
    const upsertCalls: HistoryProgressInput[] = [];
    const container = fakeContainer({ upsertCalls });
    writeTorrentHistory(
      container,
      TITLE,
      played({
        endReason: "quit",
        duration: 3600,
        watchedSeconds: 1200,
        lastTrustedProgressSeconds: 1150,
      }),
    );
    expect(upsertCalls.length).toBe(1);
    expect(upsertCalls[0]?.completed).toBe(false);
    expect(upsertCalls[0]?.title.id).toBe("torrent:abc123");
  });

  test("only a clean EOF clears the resume point", () => {
    const eofCalls: HistoryProgressInput[] = [];
    writeTorrentHistory(
      fakeContainer({ upsertCalls: eofCalls }),
      TITLE,
      played({ endReason: "eof", duration: 3600, watchedSeconds: 3600 }),
    );
    expect(eofCalls[0]?.completed).toBe(true);

    const quitCalls: HistoryProgressInput[] = [];
    writeTorrentHistory(
      fakeContainer({ upsertCalls: quitCalls }),
      TITLE,
      played({
        endReason: "quit",
        duration: 3600,
        watchedSeconds: 3500,
        lastTrustedProgressSeconds: 3490,
      }),
    );
    expect(quitCalls[0]?.completed).toBe(false);
  });

  test("did-not-start plays write nothing", () => {
    const upsertCalls: HistoryProgressInput[] = [];
    writeTorrentHistory(
      fakeContainer({ upsertCalls }),
      TITLE,
      played({ endReason: "quit", duration: 3600 }),
    );
    expect(upsertCalls.length).toBe(0);
  });
});
