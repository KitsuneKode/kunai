import { expect, test } from "bun:test";

import { projectReleaseAvailability } from "@/services/attention/ReleaseAvailabilityService";

test("aired but not provider-confirmed does not create playable notification", () => {
  expect(
    projectReleaseAvailability({
      titleId: "tmdb:1",
      mediaKind: "series",
      title: "Example",
      season: 1,
      episode: 6,
      released: true,
      providerConfirmed: false,
      providerId: "vidking",
    }).notificationSignal,
  ).toBeUndefined();
});

test("provider-confirmed release creates playable signal with identity only", () => {
  const projection = projectReleaseAvailability({
    titleId: "tmdb:1",
    mediaKind: "series",
    title: "Example",
    season: 1,
    episode: 6,
    released: true,
    providerConfirmed: true,
    providerId: "vidking",
    streamUrl: "https://must-not-leak.example/master.m3u8",
  });

  expect(projection.shelfState).toBe("provider-confirmed");
  expect(projection.notificationSignal?.type).toBe("new-playable-episode");
  expect(JSON.stringify(projection)).not.toContain("http");
});
