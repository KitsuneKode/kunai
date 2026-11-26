/**
 * Tier A distribution counts. Every HTTP call here is a local fake: nothing
 * reaches GitHub, npm, or the ingest.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  classifyGithubAsset,
  fetchDistributionEntries,
  NPM_EPOCH,
  NPM_LAUNCHER,
  NPM_PLATFORM_PACKAGES,
  npmRangeWindows,
  parseGithubReleases,
  sumNpmRange,
  type DistributionFetch,
} from "../src/distribution-sources";
import { buildPublicDistribution, computeDistributionDeltas } from "../src/public-distribution";
import type { DistributionRow } from "../src/store";
import { isGitHubApiUrl } from "./support/github-host";

const CLI_PACKAGE = join(import.meta.dir, "../../cli/package.json");

describe("asset classification", () => {
  test("binaries and archives map to their platform", () => {
    expect(classifyGithubAsset("kunai-linux-x64")).toEqual({
      source: "github",
      platform: "linux-x64",
    });
    expect(classifyGithubAsset("kunai-linux-arm64-musl.tar.gz")?.platform).toBe("linux-arm64-musl");
    expect(classifyGithubAsset("kunai-windows-x64.zip")?.platform).toBe("windows-x64");
    expect(classifyGithubAsset("kunai-windows-arm64.exe")?.platform).toBe("windows-arm64");
    expect(classifyGithubAsset("kunai-android-arm64.tar.gz")?.platform).toBe("android-arm64");
  });

  test("markers are counted apart from downloads", () => {
    expect(classifyGithubAsset("install.marker")).toEqual({
      source: "marker",
      platform: "install",
    });
    expect(classifyGithubAsset("update.marker")).toEqual({ source: "marker", platform: "update" });
  });

  test("checksums, signatures and unknown assets are not downloads", () => {
    for (const name of [
      "SHA256SUMS",
      "SHA256SUMS.archives",
      "kunai-linux-x64.sig",
      "kunai-linux-x64.tar.gz.minisig",
      "kunai-npm.tgz",
      "kunai-solaris-x64",
    ]) {
      expect(classifyGithubAsset(name)).toBeNull();
    }
  });
});

describe("source parsing", () => {
  test("a binary and its archive sum into one platform entry; drafts are skipped", () => {
    const page = parseGithubReleases(
      JSON.stringify([
        {
          tag_name: "v0.4.0",
          assets: [
            { name: "kunai-linux-x64", download_count: 10 },
            { name: "kunai-linux-x64.tar.gz", download_count: 32 },
            { name: "install.marker", download_count: 7 },
            { name: "SHA256SUMS", download_count: 99 },
          ],
        },
        {
          tag_name: "v0.5.0",
          draft: true,
          assets: [{ name: "kunai-linux-x64", download_count: 1 }],
        },
      ]),
    );
    expect(page.releases).toBe(2);
    expect(page.entries).toEqual([
      { source: "github", release: "v0.4.0", platform: "linux-x64", cumulative: 42 },
      { source: "marker", release: "v0.4.0", platform: "install", cumulative: 7 },
    ]);
  });

  test("an undocumented shape throws rather than counting zero", () => {
    expect(() => parseGithubReleases(JSON.stringify({ message: "Not Found" }))).toThrow();
    expect(() => sumNpmRange(JSON.stringify({ error: "bad range" }))).toThrow();
  });

  test("npm ranges are summed and split into windows npm will serve", () => {
    expect(
      sumNpmRange(JSON.stringify({ downloads: [{ day: "x", downloads: 3 }, { downloads: 4 }] })),
    ).toBe(7);
    expect(npmRangeWindows("2026-05-01", "2026-05-03")).toEqual([["2026-05-01", "2026-05-03"]]);
    const windows = npmRangeWindows("2026-05-01", "2028-01-01");
    expect(windows).toHaveLength(2);
    expect(windows[0]?.[1]).toBe("2027-10-22");
    expect(windows[1]).toEqual(["2027-10-23", "2028-01-01"]);
  });

  test("every npm platform package the CLI ships is counted, android included", () => {
    // SAFETY: the test reads the CLI's own manifest; it is JSON by construction.
    const manifest = JSON.parse(readFileSync(CLI_PACKAGE, "utf8")) as {
      optionalDependencies: Record<string, string>;
    };
    const shipped = Object.keys(manifest.optionalDependencies)
      .map((name) => name.replace(`${NPM_LAUNCHER}-`, ""))
      .sort();
    expect(NPM_PLATFORM_PACKAGES.map(String).sort()).toEqual(shipped);
    expect(NPM_PLATFORM_PACKAGES).toContain("android-arm64");
  });
});

describe("fetchDistributionEntries", () => {
  type FakeFetch = { fetch: DistributionFetch; urls: string[]; headers: Headers[] };

  function fakeFetch(handler: (url: string) => Response): FakeFetch {
    const urls: string[] = [];
    const headers: Headers[] = [];
    return {
      urls,
      headers,
      fetch: async (url, init) => {
        urls.push(url);
        headers.push(new Headers(init?.headers));
        return handler(url);
      },
    };
  }

  test("reads GitHub and every npm package, with an optional token", async () => {
    const fake = fakeFetch((url) =>
      isGitHubApiUrl(url)
        ? new Response(
            JSON.stringify([
              { tag_name: "v0.4.0", assets: [{ name: "kunai-android-arm64", download_count: 5 }] },
            ]),
          )
        : new Response(JSON.stringify({ downloads: [{ downloads: 2 }] })),
    );
    const entries = await fetchDistributionEntries({
      fetch: fake.fetch,
      today: "2026-11-25",
      githubToken: "token-value",
    });

    expect(entries).toContainEqual({
      source: "github",
      release: "v0.4.0",
      platform: "android-arm64",
      cumulative: 5,
    });
    expect(entries).toContainEqual({
      source: "npm",
      release: "",
      platform: "launcher",
      cumulative: 2,
    });
    expect(entries.filter((entry) => entry.source === "npm")).toHaveLength(11);

    const githubIndex = fake.urls.findIndex((url) => isGitHubApiUrl(url));
    expect(fake.urls[githubIndex]).toBe(
      "https://api.github.com/repos/KitsuneKode/kunai/releases?per_page=100&page=1",
    );
    expect(fake.headers[githubIndex]?.get("authorization")).toBe("Bearer token-value");
    expect(fake.urls).toContain(
      `https://api.npmjs.org/downloads/range/${NPM_EPOCH}:2026-11-24/@kitsunekode/kunai-android-x64`,
    );
    // The token goes to GitHub only.
    for (const [i, url] of fake.urls.entries()) {
      if (url.includes("npmjs")) expect(fake.headers[i]?.get("authorization")).toBeNull();
    }
  });

  test("a package npm has never seen counts zero; any other failure rejects", async () => {
    const missing = fakeFetch((url) =>
      isGitHubApiUrl(url)
        ? new Response("[]")
        : new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
    );
    const entries = await fetchDistributionEntries({ fetch: missing.fetch, today: "2026-11-25" });
    expect(entries.every((entry) => entry.cumulative === 0)).toBe(true);

    const broken = fakeFetch((url) =>
      isGitHubApiUrl(url) ? new Response("[]") : new Response("", { status: 500 }),
    );
    await expect(
      fetchDistributionEntries({ fetch: broken.fetch, today: "2026-11-25" }),
    ).rejects.toThrow("answered 500");
  });
});

function row(
  day: string,
  source: DistributionRow["source"],
  release: string,
  platform: string,
  cumulative: number,
): DistributionRow {
  return { day, source, release, platform, cumulative };
}

describe("deltas", () => {
  test("come from consecutive cumulative snapshots", () => {
    const deltas = computeDistributionDeltas([
      row("2026-11-20", "github", "v0.4.0", "linux-x64", 100),
      row("2026-11-20", "npm", "", "linux-x64", 40),
      row("2026-11-20", "npm", "", "launcher", 50),
      row("2026-11-21", "github", "v0.4.0", "linux-x64", 112),
      row("2026-11-21", "npm", "", "linux-x64", 43),
      row("2026-11-21", "npm", "", "launcher", 54),
      // A new release counts from zero on its first snapshot.
      row("2026-11-22", "github", "v0.4.0", "linux-x64", 115),
      row("2026-11-22", "github", "v0.5.0", "linux-x64", 9),
      row("2026-11-22", "npm", "", "linux-x64", 43),
      row("2026-11-22", "npm", "", "launcher", 54),
    ]);
    // The first snapshot is an opening total, not a day's downloads.
    expect(deltas).toEqual([
      { day: "2026-11-21", downloads: 15, installs: null, updates: null },
      { day: "2026-11-22", downloads: 12, installs: null, updates: null },
    ]);
  });

  test("a counter that went down contributes nothing, not a negative", () => {
    const deltas = computeDistributionDeltas([
      row("2026-11-20", "github", "v0.4.0", "linux-x64", 100),
      row("2026-11-21", "github", "v0.4.0", "linux-x64", 3),
    ]);
    expect(deltas[0]?.downloads).toBe(0);
  });

  test("markers become installs and updates once they exist", () => {
    const deltas = computeDistributionDeltas([
      row("2026-11-20", "marker", "v0.5.0", "install", 10),
      row("2026-11-20", "marker", "v0.5.0", "update", 30),
      row("2026-11-21", "marker", "v0.5.0", "install", 14),
      row("2026-11-21", "marker", "v0.5.0", "update", 41),
    ]);
    expect(deltas).toEqual([{ day: "2026-11-21", downloads: 0, installs: 4, updates: 11 }]);
  });
});

describe("buildPublicDistribution", () => {
  test("totals per release and per platform from the newest snapshot", () => {
    const published = buildPublicDistribution([
      row("2026-11-20", "github", "v0.4.0", "linux-x64", 90),
      row("2026-11-21", "github", "v0.4.0", "linux-x64", 100),
      row("2026-11-21", "github", "v0.10.0", "android-arm64", 7),
      row("2026-11-21", "npm", "", "linux-x64", 40),
      row("2026-11-21", "npm", "", "launcher", 45),
    ]);
    expect(published?.asOf).toBe("2026-11-21");
    expect(published?.totals).toEqual({
      downloads: 147,
      github: 107,
      npm: 40,
      npmLauncher: 45,
      installs: null,
      updates: null,
    });
    // Numeric tag order: v0.10.0 is newer than v0.4.0.
    expect(published?.perRelease.map((release) => release.release)).toEqual(["v0.10.0", "v0.4.0"]);
    expect(published?.perPlatform).toEqual([
      { platform: "android-arm64", github: 7, npm: 0, total: 7 },
      { platform: "linux-x64", github: 100, npm: 40, total: 140 },
    ]);
    expect(published?.daily).toEqual([
      { day: "2026-11-21", downloads: 57, installs: null, updates: null },
    ]);
  });

  test("null with no snapshot", () => {
    expect(buildPublicDistribution([])).toBeNull();
  });
});
