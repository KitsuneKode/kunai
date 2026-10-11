import { expect, test } from "bun:test";

import { encodePlaybackTargetWebUrl } from "@kunai/types";
import { renderToStaticMarkup } from "react-dom/server";

import SharePage, { generateMetadata } from "../app/w/[code]/page";
import { PrivacyAnalytics } from "../components/analytics/privacy-analytics";
import { PrivacySpeedInsights } from "../components/analytics/privacy-speed-insights";
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

test("relative share URLs and malformed telemetry URLs fail closed", () => {
  for (const url of ["/w/v1.private?query=1", "/w/invalid", "http://[", "unparseable"]) {
    expect(filterPrivateShareAnalytics({ type: "pageview", url })).toBeNull();
  }
});

test("both mounted SDK wrappers suppress share events across navigation and delayed delivery", () => {
  const analytics = PrivacyAnalytics();
  const speed = PrivacySpeedInsights();
  // Inspect the actual SDK props emitted by each client boundary, not a detached helper.
  expect(analytics.props.beforeSend).toBeFunction();
  expect(speed.props.beforeSend).toBeFunction();
  for (const [url, allowed] of [
    ["https://kunai.kitsunekode.in/docs", true],
    ["https://kunai.kitsunekode.in/w/v1.private", false],
    ["/w/invalid?title=private", false],
    ["https://kunai.kitsunekode.in/docs/users", true],
    // A share-page performance sample delivered after navigation to docs.
    ["https://kunai.kitsunekode.in/w/v1.private?query=1", false],
    ["http://[", false],
  ] as const) {
    const pageview = { type: "pageview", url };
    const vital = { type: "vital", url, route: "/w/[code]" };
    expect(analytics.props.beforeSend(pageview)).toBe(allowed ? pageview : null);
    expect(speed.props.beforeSend(vital)).toBe(allowed ? vital : null);
  }
});

test("share metadata leaves the image slot to the segment card", async () => {
  const url = encodePlaybackTargetWebUrl(
    {
      anchor: { by: "catalog", ns: "anilist", id: "21" },
      kind: "anime",
      title: "Cowboy Bebop",
    },
    "play",
  );
  const metadata = await generateMetadata({
    params: Promise.resolve({ code: webCode(url) }),
  });

  expect(metadata.openGraph?.images).toBeUndefined();
  expect(metadata.twitter?.images).toBeUndefined();
  expect(metadata.openGraph?.title).toContain("Cowboy Bebop");
});
