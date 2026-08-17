import { expect, test } from "bun:test";

import { handleShellAction } from "@/app-shell/workflows";
import type { Container } from "@/container";

test("playlist-add queues the selected anime film with title-level catalogue identity", async () => {
  const enqueued: unknown[] = [];
  const feedback: unknown[] = [];
  const container = {
    stateManager: {
      getState: () => ({
        mode: "anime",
        currentTitle: {
          id: "anilist:181053",
          name: "Infinity Castle",
          type: "movie",
          isAnime: true,
          externalIds: { anilistId: "181053", malId: "40456" },
        },
        currentEpisode: undefined,
      }),
      dispatch: (transition: unknown) => feedback.push(transition),
    },
    queueService: {
      enqueueMediaItem: (item: unknown, options: unknown) => enqueued.push({ item, options }),
    },
  } as unknown as Container;

  await expect(handleShellAction({ action: "playlist-add", container })).resolves.toBe("handled");
  expect(enqueued).toEqual([
    {
      item: {
        titleId: "anilist:181053",
        title: "Infinity Castle",
        mediaKind: "anime",
        contentType: "movie",
        externalIds: { anilistId: "181053", malId: "40456" },
      },
      options: { placement: "end", source: "manual" },
    },
  ]);
  expect(feedback).toHaveLength(1);
});
