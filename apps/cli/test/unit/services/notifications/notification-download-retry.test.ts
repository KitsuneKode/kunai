import { describe, expect, test } from "bun:test";

import type { MediaItemIdentity } from "@/domain/media/media-item-identity";
import { createNotificationDownloadRetry } from "@/services/notifications/notification-download-retry";
import type { DownloadJobRecord } from "@kunai/storage";

type Job = Pick<
  DownloadJobRecord,
  "id" | "titleId" | "mediaKind" | "season" | "episode" | "status"
>;

function port(jobs: readonly Job[], retryError?: Error) {
  const retried: string[] = [];
  const kicked: string[] = [];
  // SAFETY: the adapter reads only the fields `Job` declares.
  const asRecord = (job: Job): DownloadJobRecord => job as never;
  return {
    retried,
    kicked,
    downloads: {
      getJob: (id: string) => {
        const job = jobs.find((candidate) => candidate.id === id);
        return job ? asRecord(job) : undefined;
      },
      listFailed: () => jobs.filter((job) => job.status === "failed").map(asRecord),
      retry: async (id: string) => {
        if (retryError) throw retryError;
        retried.push(id);
      },
      kickQueue: (source: string) => {
        kicked.push(source);
      },
    },
  };
}

const anime: MediaItemIdentity = {
  mediaKind: "anime",
  titleId: "anilist:1",
  title: "Frieren",
  absoluteEpisode: 12,
};

describe("notification download retry", () => {
  test("requeues the exact job the notice names, then kicks the queue", async () => {
    const fixture = port([
      { id: "j1", titleId: "anilist:1", mediaKind: "anime", episode: 1, status: "failed" },
      { id: "j12", titleId: "anilist:1", mediaKind: "anime", episode: 12, status: "failed" },
    ]);

    const outcome = await createNotificationDownloadRetry(fixture.downloads).retryFailed({
      jobId: "j12",
      item: anime,
    });

    expect(outcome).toEqual({ status: "requeued" });
    expect(fixture.retried).toEqual(["j12"]);
    expect(fixture.kicked).toEqual(["download-manager"]);
  });

  test("an older notice retries only when exactly one failed job matches its episode", async () => {
    const one = port([
      { id: "j1", titleId: "anilist:1", mediaKind: "anime", episode: 1, status: "failed" },
      { id: "j12", titleId: "anilist:1", mediaKind: "anime", episode: 12, status: "failed" },
    ]);
    expect(
      await createNotificationDownloadRetry(one.downloads).retryFailed({
        jobId: null,
        item: anime,
      }),
    ).toEqual({ status: "requeued" });
    expect(one.retried).toEqual(["j12"]);

    const two = port([
      { id: "a", titleId: "anilist:1", mediaKind: "anime", episode: 12, status: "failed" },
      { id: "b", titleId: "anilist:1", mediaKind: "anime", episode: 12, status: "failed" },
    ]);
    expect(
      await createNotificationDownloadRetry(two.downloads).retryFailed({
        jobId: null,
        item: anime,
      }),
    ).toEqual({ status: "unavailable", reason: "Open Downloads to retry this one." });
    expect(two.retried).toEqual([]);
  });

  test("a job that is no longer failed, or a refused retry, is reported, not queued", async () => {
    const done = port([
      { id: "j12", titleId: "anilist:1", mediaKind: "anime", episode: 12, status: "completed" },
    ]);
    expect(
      await createNotificationDownloadRetry(done.downloads).retryFailed({
        jobId: "j12",
        item: anime,
      }),
    ).toEqual({ status: "unavailable", reason: "That download is completed, not failed." });

    const refused = port(
      [{ id: "j12", titleId: "anilist:1", mediaKind: "anime", episode: 12, status: "failed" }],
      new Error("A playable or active offline copy already exists for this episode."),
    );
    expect(
      await createNotificationDownloadRetry(refused.downloads).retryFailed({
        jobId: "j12",
        item: anime,
      }),
    ).toEqual({
      status: "unavailable",
      reason: "A playable or active offline copy already exists for this episode.",
    });
    expect(refused.kicked).toEqual([]);
  });
});
