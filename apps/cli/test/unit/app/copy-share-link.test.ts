import { afterEach, expect, mock, test } from "bun:test";

mock.module("@/infra/clipboard", () => ({
  copyToClipboard: mock(async () => true),
}));

const { copyShareLinkForContext } = await import("@/app/bootstrap/copy-share-link");
const { copyToClipboard } = await import("@/infra/clipboard");

afterEach(() => {
  (copyToClipboard as ReturnType<typeof mock>).mockClear();
});

test("copyShareLinkForContext encodes and copies a catalog-anchored URL", async () => {
  const out = await copyShareLinkForContext({
    mode: "series",
    title: {
      id: "tmdb:1396",
      type: "series",
      name: "Breaking Bad",
      externalIds: { tmdbId: "1396" },
    },
    episode: { season: 4, episode: 9 },
    startSeconds: 120,
    providerId: "videasy",
  });

  expect(out?.copied).toBe(true);
  expect(out?.url).toBe(
    "kunai://play?cat=tmdb%3A1396&kind=series&s=4&e=9&t=120&src=videasy&n=Breaking%20Bad",
  );
  expect(copyToClipboard).toHaveBeenCalledWith(out?.url);
});

test("copyShareLinkForContext returns null when no portable ref can be built", async () => {
  const out = await copyShareLinkForContext({
    mode: "series",
    title: { id: "unknown:1", type: "series", name: "" },
  });
  expect(out).toBeNull();
  expect(copyToClipboard).not.toHaveBeenCalled();
});
