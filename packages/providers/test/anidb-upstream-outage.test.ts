import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ProviderRuntimeContext } from "@kunai/types";

import { AnidbHttpStatusError, fetchAnidbMasterUrl, searchAnidb } from "../src/anidb/client";
import { clearAnidbCachesForTest } from "../src/anidb/direct";
import { urlHasHostname } from "./helpers/anidb-urls";

/**
 * anidb.app answers a site-wide outage with `503 Under Maintenance` on every
 * route. Scraping that page for result rows finds none, so an outage used to be
 * indistinguishable from "this anime does not exist" — search reported zero
 * results for Naruto, One Piece and Frieren alike, threw nothing, and left no
 * health signal for provider fallback to act on.
 */
const MAINTENANCE_HTML = `<!DOCTYPE html>
<html lang="en"><head><title>Under Maintenance</title></head>
<body><h1>Under Maintenance</h1><p>We will be back shortly.</p></body></html>`;

const BROWSE_HTML = readFileSync(
  join(import.meta.dir, "fixtures/anidb/browse-current.html"),
  "utf8",
);

afterEach(() => {
  clearAnidbCachesForTest();
});

function contextReturning(handler: (url: string) => { status: number; body: string }): {
  readonly context: ProviderRuntimeContext;
  readonly calls: string[];
} {
  const calls: string[] = [];
  const context = {
    fetch: {
      async fetch(url: string) {
        if (!urlHasHostname(url, "anidb.app")) throw new Error(`unexpected host: ${url}`);
        calls.push(url);
        const { status, body } = handler(url);
        return new Response(body, { status });
      },
    },
  } as unknown as ProviderRuntimeContext;
  return { context, calls };
}

describe("search during an upstream outage", () => {
  test("a 503 maintenance page is surfaced, not parsed as zero results", async () => {
    const { context } = contextReturning(() => ({ status: 503, body: MAINTENANCE_HTML }));

    await expect(searchAnidb("Naruto", undefined, context)).rejects.toBeInstanceOf(
      AnidbHttpStatusError,
    );
  });

  test("a 5xx is not retried through curl — an outage is not a fingerprint problem", async () => {
    const { context, calls } = contextReturning(() => ({ status: 503, body: MAINTENANCE_HTML }));

    await expect(searchAnidb("Naruto", undefined, context)).rejects.toBeInstanceOf(
      AnidbHttpStatusError,
    );
    expect(calls).toHaveLength(1);
  });

  test("a healthy browse page still parses into results", async () => {
    const { context } = contextReturning(() => ({ status: 200, body: BROWSE_HTML }));

    const results = await searchAnidb("Naruto", undefined, context);

    expect(results.length).toBeGreaterThan(0);
  });

  test("an empty result set from a healthy page stays an empty result set", async () => {
    const { context } = contextReturning(() => ({
      status: 200,
      body: "<html><body><main>No results found.</main></body></html>",
    }));

    await expect(searchAnidb("nonexistent title", undefined, context)).resolves.toEqual([]);
  });
});

describe("stream embeds during an upstream outage", () => {
  test("a 503 embed page is surfaced, not read as a missing master playlist", async () => {
    const { context } = contextReturning(() => ({ status: 503, body: MAINTENANCE_HTML }));

    await expect(
      fetchAnidbMasterUrl("https://anidb.app/embed/1", undefined, context),
    ).rejects.toBeInstanceOf(AnidbHttpStatusError);
  });

  test("a healthy embed page still yields its master url", async () => {
    const { context } = contextReturning(() => ({
      status: 200,
      body: "<script>var player = { file: 'https://cdn.example/master.m3u8' };</script>",
    }));

    await expect(
      fetchAnidbMasterUrl("https://anidb.app/embed/1", undefined, context),
    ).resolves.toBe("https://cdn.example/master.m3u8");
  });
});
