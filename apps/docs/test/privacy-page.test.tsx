import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import PrivacyPage from "../app/privacy/page";

/**
 * The privacy page is a promise — its value is that every material disclosure
 * is present. The assertions below pin the claims a lazy policy would drop:
 * the site's own Vercel telemetry (the only third-party send on the docs
 * site), the /w/ share-link filter, and the direct-to-provider model that
 * puts the user's IP in front of whoever serves the stream.
 */
const html = renderToStaticMarkup(<PrivacyPage />);

describe("PrivacyPage disclosures", () => {
  test("discloses the docs site's own Vercel telemetry", () => {
    expect(html).toContain("Vercel Analytics");
    expect(html).toContain("Speed Insights");
  });

  test("discloses that share links are filtered out of telemetry", () => {
    expect(html).toContain("/w/");
  });

  test("states the direct-provider model instead of hiding behind it", () => {
    expect(html).toContain("no proxy");
  });

  test("carries the analytics opt-in facts, not vibes", () => {
    expect(html).toContain("sha256");
    expect(html).toContain("DO_NOT_TRACK");
    expect(html).toContain("/analytics");
  });

  test("carries the disclaimer's core position", () => {
    expect(html).toContain("does not host");
    expect(html).toContain("third-party providers");
    expect(html).toContain('href="/docs/users/supported-and-unsupported#disclaimer"');
  });

  test("names the project as a fun open-source build", () => {
    expect(html).toContain("open-source");
  });
});
