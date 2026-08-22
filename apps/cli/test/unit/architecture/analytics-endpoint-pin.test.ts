import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_ANALYTICS_ENDPOINT } from "@/services/analytics/usage-analytics-service";

const ROOT = join(import.meta.dir, "../../../../..");
const CONTRACT = join(ROOT, ".docs/analytics-privacy-contract.md");

/**
 * The contract pins the default endpoint to a domain Kunai controls. Published
 * npm tarballs and compiled binaries are immutable, so the endpoint baked into
 * them must keep resolving no matter where the ingest happens to run today —
 * DNS can move; a hosting-platform hostname in a shipped binary cannot.
 *
 * Nothing previously bound the constant to that requirement. A well-meaning
 * swap to a `*.vercel.app` URL (or any platform subdomain) would have passed
 * every test while shipping an endpoint the project does not control.
 */
const CONTROLLED_DOMAIN = "kunai.kitsunekode.in";

const HOSTING_PLATFORM_SUFFIXES = [
  "vercel.app",
  "netlify.app",
  "pages.dev",
  "workers.dev",
  "github.io",
  "herokuapp.com",
  "fly.dev",
  "onrender.com",
  "railway.app",
  "amplifyapp.com",
  "azurewebsites.net",
] as const;

describe("analytics default endpoint pin", () => {
  test("ships on a Kunai-controlled domain over https", () => {
    const url = new URL(DEFAULT_ANALYTICS_ENDPOINT);
    expect(url.protocol).toBe("https:");
    expect(
      url.hostname === CONTROLLED_DOMAIN || url.hostname.endsWith(`.${CONTROLLED_DOMAIN}`),
    ).toBe(true);
  });

  test("never points at a hosting-platform URL", () => {
    const { hostname } = new URL(DEFAULT_ANALYTICS_ENDPOINT);
    for (const suffix of HOSTING_PLATFORM_SUFFIXES) {
      expect(hostname.endsWith(`.${suffix}`)).toBe(false);
    }
  });

  test("the contract still states the controlled-domain requirement", () => {
    const prose = readFileSync(CONTRACT, "utf8").replace(/\s+/g, " ");
    expect(prose).toContain(CONTROLLED_DOMAIN);
    expect(prose).toMatch(/domain Kunai controls/i);
  });
});
