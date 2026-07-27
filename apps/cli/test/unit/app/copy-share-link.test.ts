import { expect, mock, test } from "bun:test";

import { copyShareLinkForContext } from "@/app/bootstrap/copy-share-link";

test("copyShareLinkForContext encodes and copies a catalog-anchored URL", async () => {
  const copyToClipboard = mock(async (_text: string) => true);

  const out = await copyShareLinkForContext(
    {
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
    },
    copyToClipboard,
  );

  expect(out?.copied).toBe(true);
  expect(out?.url).toBe(
    "kunai://play?cat=tmdb%3A1396&kind=series&s=4&e=9&t=120&src=videasy&n=Breaking%20Bad",
  );
  expect(copyToClipboard).toHaveBeenCalledWith(out?.url);
});

test("copyShareLinkForContext returns null when no portable ref can be built", async () => {
  const copyToClipboard = mock(async (_text: string) => true);

  const out = await copyShareLinkForContext(
    {
      mode: "series",
      title: { id: "unknown:1", type: "series", name: "" },
    },
    copyToClipboard,
  );
  expect(out).toBeNull();
  expect(copyToClipboard).not.toHaveBeenCalled();
});
