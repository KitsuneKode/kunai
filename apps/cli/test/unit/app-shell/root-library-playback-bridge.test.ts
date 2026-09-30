import { expect, test } from "bun:test";

import {
  cancelRootLibraryPlaybackLaunch,
  resolveRootLibraryPlaybackLaunch,
  waitForRootLibraryPlaybackLaunch,
} from "@/app-shell/root-library-playback-bridge";

test("closing Library settles the active playback waiter without leaving a stale launch", async () => {
  const cancelled = waitForRootLibraryPlaybackLaunch();
  cancelRootLibraryPlaybackLaunch();
  await expect(cancelled).resolves.toBeNull();

  const next = waitForRootLibraryPlaybackLaunch();
  resolveRootLibraryPlaybackLaunch({
    jobId: "job-2",
    title: {
      id: "title-2",
      type: "movie",
      name: "Fresh selection",
      launchSource: "offline-library",
    },
  });

  await expect(next).resolves.toEqual({
    jobId: "job-2",
    title: {
      id: "title-2",
      type: "movie",
      name: "Fresh selection",
      launchSource: "offline-library",
    },
  });
});
