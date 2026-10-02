import { describe, expect, test } from "bun:test";

import { isJsonString, type JsonValue } from "@kunai/types";

import {
  NPM_DOWNLOADS_MAX_ENTRIES,
  NPM_DOWNLOADS_WINDOW_DAYS,
  NPM_PACKAGE_NAME,
  fetchNpmDownloads,
  npmDownloadsUrl,
  npmWindow,
  parseNpmDownloads,
} from "../lib/analytics-npm";

const DAY_MS = 86_400_000;

/**
 * The npm payload is a third-party shape read at ISR time. These tests pin the
 * parse boundary — what counts as a usable window and what fails closed — the
 * same way the ingest series tests pin the first-party contract.
 */

const valid = {
  start: "2026-09-01",
  end: "2026-09-03",
  package: NPM_PACKAGE_NAME,
  downloads: [
    { day: "2026-09-01", downloads: 4 },
    { day: "2026-09-02", downloads: 9.7 },
    { day: "2026-09-03", downloads: 2 },
  ],
};

describe("npmWindow", () => {
  test("ends on yesterday — today is still being counted", () => {
    const now = Date.parse("2026-09-15T12:00:00.000Z");
    const window = npmWindow(now);
    expect(window.to).toBe("2026-09-14");
    // Inclusive of both ends: `to` minus `from` spans one day short of the
    // window length because the last day is counted inside it.
    const days = (Date.parse(window.to) - Date.parse(window.from)) / DAY_MS + 1;
    expect(days).toBe(NPM_DOWNLOADS_WINDOW_DAYS);
  });
});

describe("npmDownloadsUrl", () => {
  test("addresses the npm range endpoint for the package", () => {
    expect(npmDownloadsUrl("2026-09-01", "2026-09-30")).toBe(
      `https://api.npmjs.org/downloads/range/2026-09-01:2026-09-30/${NPM_PACKAGE_NAME}`,
    );
  });
});

describe("parseNpmDownloads", () => {
  test("a well-formed payload sorts by day and floors counts", () => {
    const parsed = parseNpmDownloads({
      ...valid,
      downloads: [...valid.downloads].reverse(),
    });
    expect(parsed?.package).toBe(NPM_PACKAGE_NAME);
    expect(parsed?.from).toBe("2026-09-01");
    expect(parsed?.to).toBe("2026-09-03");
    expect(parsed?.points.map((point) => point.day)).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
    ]);
    expect(parsed?.points[1]?.downloads).toBe(9);
  });

  test("rejects the non-shapes outright", () => {
    expect(parseNpmDownloads(null)).toBeNull();
    expect(parseNpmDownloads("nope")).toBeNull();
    expect(parseNpmDownloads([valid])).toBeNull();
  });

  test("a malformed window bound rejects the series", () => {
    expect(parseNpmDownloads({ ...valid, start: "nope" })).toBeNull();
    expect(parseNpmDownloads({ ...valid, end: "2026-13-45" })).toBeNull();
    expect(parseNpmDownloads({ ...valid, start: "2026-09-03", end: "2026-09-01" })).toBeNull();
  });

  test("an empty download list is not a series", () => {
    expect(parseNpmDownloads({ ...valid, downloads: [] })).toBeNull();
    expect(
      parseNpmDownloads({ package: valid.package, start: valid.start, end: valid.end }),
    ).toBeNull();
  });

  test("one malformed entry rejects the whole window", () => {
    // Same rule as the ingest series: a half-parsed chart misstates the
    // channel it claims to show.
    const bad = (entry: JsonValue) => ({
      ...valid,
      downloads: [{ day: "2026-09-01", downloads: 4 }, entry],
    });
    expect(parseNpmDownloads(bad({ day: "nope", downloads: 1 }))).toBeNull();
    expect(parseNpmDownloads(bad({ day: "2026-09-02", downloads: -1 }))).toBeNull();
    expect(parseNpmDownloads(bad({ day: "2026-09-02", downloads: "1" }))).toBeNull();
    expect(parseNpmDownloads(bad(null))).toBeNull();
  });

  test("an oversized point list is refused", () => {
    // The request asks for a 30-day window; a payload claiming far more is
    // not an answer to it.
    const downloads = Array.from({ length: NPM_DOWNLOADS_MAX_ENTRIES + 1 }, (_, i) => ({
      day: new Date(Date.parse("2025-01-01T00:00:00.000Z") + i * DAY_MS).toISOString().slice(0, 10),
      downloads: 1,
    }));
    expect(parseNpmDownloads({ ...valid, downloads })).toBeNull();
    expect(
      parseNpmDownloads({ ...valid, downloads: downloads.slice(0, NPM_DOWNLOADS_MAX_ENTRIES) }),
    ).not.toBeNull();
  });
});

describe("fetchNpmDownloads", () => {
  const stubFetch =
    (payload: JsonValue, status = 200): typeof fetch =>
    // @ts-expect-error — the helper only needs the response surface `fetch`
    // returns; the extra `next` init option is ignored by the stub.
    async () =>
      new Response(isJsonString(payload) ? payload : JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      });

  test("a live-shaped response parses into a series", async () => {
    const series = await fetchNpmDownloads({
      fetchImpl: stubFetch(valid),
      now: Date.parse("2026-09-15T12:00:00.000Z"),
    });
    expect(series?.points).toHaveLength(3);
  });

  test("a non-2xx and a non-JSON body both fail closed to null", async () => {
    expect(await fetchNpmDownloads({ fetchImpl: stubFetch({ error: "x" }, 404) })).toBeNull();
    expect(await fetchNpmDownloads({ fetchImpl: stubFetch("<html>nope</html>") })).toBeNull();
  });

  test("a response for a different package is refused", async () => {
    // The URL names the package; an echo for another package would chart a
    // channel the card does not claim to show.
    const wrong = await fetchNpmDownloads({
      fetchImpl: stubFetch({ ...valid, package: "left-pad" }),
      now: Date.parse("2026-09-15T12:00:00.000Z"),
    });
    expect(wrong).toBeNull();
  });
});
