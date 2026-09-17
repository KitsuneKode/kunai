import { describe, expect, test } from "bun:test";

import {
  classifyProviderHealth,
  parseJsonPayload,
  parseSmokeOutput,
} from "../../live/matrix-harness.mjs";

describe("matrix harness parser", () => {
  test("parses a single pretty-printed payload", () => {
    const stdout = JSON.stringify(
      {
        ok: true,
        provider: "vidlink",
        providerId: "vidlink",
        streamResolved: true,
        streamReachable: true,
      },
      null,
      2,
    );
    expect(parseJsonPayload(stdout)?.provider).toBe("vidlink");
  });

  test("picks the primary payload out of youtube NDJSON check lines", () => {
    const primary = JSON.stringify({
      ok: true,
      provider: "youtube",
      providerId: "youtube",
      streamResolved: true,
      streamHost: "www.youtube.com",
      streamReachable: true,
      isolatedProfile: true,
    });
    const stdout = [
      primary,
      JSON.stringify({ ok: true, check: "quality-ladder", maxLadderHeight: 2160 }),
      JSON.stringify({ ok: true, check: "type-short-search", resultCount: 12 }),
    ].join("\n");
    const parsed = parseJsonPayload(stdout);
    expect(parsed?.provider).toBe("youtube");
    expect(parsed?.streamResolved).toBe(true);
  });

  test("falls back to stderr for search-stage failures", () => {
    const failure = JSON.stringify({
      ok: false,
      stage: "search",
      searchedProvider: "anidb",
      searchResults: 0,
      reason: 'anidb search returned zero results for "Onigiri"',
    });
    const found = parseSmokeOutput("", failure);
    expect(found?.source).toBe("stderr");
    expect(found?.payload.stage).toBe("search");
  });

  test("returns null when neither stream carries JSON", () => {
    expect(parseSmokeOutput("no json here", "container log line")).toBeNull();
  });
});

describe("matrix health classification", () => {
  test("captcha / WAF evidence is environment-network, not drift", () => {
    expect(
      classifyProviderHealth(
        { ok: false, error: "AllAnime requires a captcha for stream sources from this network" },
        { timedOut: false, harness: false },
      ),
    ).toBe("environment-network");
    expect(
      classifyProviderHealth(
        { ok: false, error: "Miruro pipe blocked by Cloudflare WAF (HTTP 403 HTML)" },
        { timedOut: false, harness: false },
      ),
    ).toBe("environment-network");
  });

  test("HLS 403 probe evidence is environment-network", () => {
    expect(
      classifyProviderHealth(
        {
          ok: false,
          streamResolved: true,
          streamReachable: false,
          streamProbeStatus: "unreachable",
          streamProbeReason: "HLS segment unreachable: HTTP 403",
        },
        { timedOut: false, harness: false },
      ),
    ).toBe("environment-network");
  });

  test("HTTP 503 site outage is environment-network", () => {
    expect(
      classifyProviderHealth(
        { ok: false, stage: "search", reason: "anidb fetch HTTP 503" },
        { timedOut: false, harness: false },
      ),
    ).toBe("environment-network");
  });

  test("zero-result search is provider-drift", () => {
    expect(
      classifyProviderHealth(
        { ok: false, stage: "search", reason: 'anidb search returned zero results for "Onigiri"' },
        { timedOut: false, harness: false },
      ),
    ).toBe("provider-drift");
  });

  test("unparseable output stays harness-failure", () => {
    expect(classifyProviderHealth({ ok: false }, { timedOut: false, harness: true })).toBe(
      "harness-failure",
    );
  });
});
