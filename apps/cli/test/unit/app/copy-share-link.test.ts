import { expect, mock, test } from "bun:test";

import {
  buildShareLinkArtifactsForContext,
  copyShareLinkForContext,
} from "@/app/bootstrap/copy-share-link";
import { parsePlaybackTargetRef } from "@/domain/share/playback-target-ref";

test("copyShareLinkForContext encodes and copies a catalog-anchored URL", async () => {
  const copyToClipboard = mock(async (_text: string) => true);

  const out = await copyShareLinkForContext(
    {
      mode: "series",
      title: {
        id: "tmdb:1396",
        type: "series",
        name: "Breaking Bad",
        posterUrl: "https://image.tmdb.org/t/p/w500/breaking-bad.jpg",
        externalIds: { tmdbId: "1396" },
      },
      episode: { season: 4, episode: 9 },
      startSeconds: 120,
      providerId: "videasy",
    },
    copyToClipboard,
  );

  expect(out?.copied).toBe(true);
  expect(out?.appUrl).toBe(
    "kunai://play?cat=tmdb%3A1396&kind=series&s=4&e=9&t=120&src=videasy&n=Breaking%20Bad",
  );
  expect(out?.url).toStartWith("https://kunai.kitsunekode.in/w/v1.");
  expect(out?.webUrl).toBe(out?.url);
  expect(out?.qrUrl).toStartWith("https://kunai.kitsunekode.in/w/k1");
  expect(parsePlaybackTargetRef(out?.webUrl ?? "")).toEqual(
    parsePlaybackTargetRef(out?.appUrl ?? ""),
  );
  expect(parsePlaybackTargetRef(out?.shortCode ?? "")).toEqual({
    anchor: { by: "catalog", ns: "tmdb", id: "1396" },
    kind: "series",
    season: 4,
    episode: 9,
    startSeconds: 120,
  });
  expect(out?.shortCode?.length).toBeLessThan(40);
  expect(copyToClipboard).toHaveBeenCalledWith(out?.url);
});

test("QR handoff strips optional metadata while preserving the catalog target", () => {
  const out = buildShareLinkArtifactsForContext({
    mode: "anime",
    title: {
      id: "anilist:21",
      type: "series",
      name: "A deliberately long presentation title that does not belong in a terminal QR",
      externalIds: { anilistId: "21" },
      posterUrl: "https://example.com/poster.jpg",
      isAnime: true,
    },
    episode: { season: 1, episode: 3 },
    startSeconds: 120,
    providerId: "allanime",
  });

  expect(out).not.toBeNull();
  expect(out?.qrUrl.length).toBeLessThan(100);
  expect(parsePlaybackTargetRef(out?.qrUrl ?? "")).toEqual({
    anchor: { by: "catalog", ns: "anilist", id: "21" },
    kind: "anime",
    season: 1,
    episode: 3,
    startSeconds: 120,
  });
  expect(parsePlaybackTargetRef(out?.webUrl ?? "")?.title).toContain("deliberately long");
});

test("a provider-specific identity that exceeds the compact codec still produces an HTTPS link", () => {
  const providerIdentity = "episode/".repeat(40);
  const out = buildShareLinkArtifactsForContext({
    mode: "youtube",
    title: {
      id: "youtube:oversized",
      type: "movie",
      name: "Provider-specific video",
      externalIds: { youtubeId: providerIdentity },
    },
  });

  expect(out?.shortCode).toBeNull();
  expect(out?.qrUrl).toStartWith("https://kunai.kitsunekode.in/w/v1.");
  expect(parsePlaybackTargetRef(out?.qrUrl ?? "")?.title).toBeUndefined();
  expect(parsePlaybackTargetRef(out?.webUrl ?? "")?.anchor).toEqual({
    by: "catalog",
    ns: "youtube",
    id: providerIdentity,
  });
  expect(parsePlaybackTargetRef(out?.qrUrl ?? "")?.anchor).toEqual(
    parsePlaybackTargetRef(out?.webUrl ?? "")?.anchor,
  );
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
