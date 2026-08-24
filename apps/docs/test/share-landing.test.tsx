import { expect, test } from "bun:test";

import { encodePlaybackTargetWebUrl } from "@kunai/types";
import { renderToStaticMarkup } from "react-dom/server";

import SharePage, { generateMetadata } from "../app/w/[code]/page";
import { filterPrivateShareAnalytics } from "../lib/analytics-privacy";

function webCode(url: string): string {
  return new URL(url).pathname.split("/").at(-1) ?? "";
}

test("share landing renders a catalog episode with install and app handoff actions", async () => {
  const url = encodePlaybackTargetWebUrl(
    {
      anchor: { by: "catalog", ns: "tmdb", id: "1396" },
      kind: "series",
      season: 1,
      episode: 3,
      startSeconds: 83,
      title: "Breaking Bad",
    },
    "play",
    { posterUrl: "https://image.tmdb.org/t/p/w500/breaking-bad.jpg" },
  );
  const code = webCode(url);
  const html = renderToStaticMarkup(await SharePage({ params: Promise.resolve({ code }) }));

  expect(html).toContain("Breaking Bad");
  expect(html).toContain("Season 1 · Episode 3");
  expect(html).toContain("Open in Kunai");
  expect(html).toContain("breaking-bad.jpg");
  expect(html).toContain("kunai://play?");
  expect(html).toContain("curl -fsSL");
  expect(html).toContain("install.ps1");
  expect(html).not.toContain("q=");
});

test("malformed or truncated share codes render recovery guidance instead of throwing", async () => {
  const html = renderToStaticMarkup(
    await SharePage({ params: Promise.resolve({ code: "v1.truncated" }) }),
  );
  const metadata = await generateMetadata({ params: Promise.resolve({ code: "v1.truncated" }) });

  expect(html).toContain("This share link is incomplete");
  expect(html).toContain("Kunai home");
  expect(html).not.toContain("kunai://");
  expect(metadata.title).toBe("Invalid share link");
});

test("share codes never enter site analytics", () => {
  const shareEvent = {
    type: "pageview" as const,
    url: "https://kunai.kitsunekode.in/w/v1.private-title-code",
  };
  const docsEvent = {
    type: "pageview" as const,
    url: "https://kunai.kitsunekode.in/docs/users/getting-started",
  };

  expect(filterPrivateShareAnalytics(shareEvent)).toBeNull();
  expect(filterPrivateShareAnalytics(docsEvent)).toBe(docsEvent);
});
