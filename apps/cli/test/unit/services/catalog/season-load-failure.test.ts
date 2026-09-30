import { describe, expect, test } from "bun:test";

import { describeSeasonLoadFailure } from "@/services/catalog/season-load-failure";
import {
  classifyTmdbFetchFailure,
  isTmdbClientError,
  TmdbHttpError,
} from "@/services/catalog/tmdb-proxy";

describe("classifyTmdbFetchFailure", () => {
  test("404 is a definitive 'no record', other statuses are upstream errors", () => {
    expect(classifyTmdbFetchFailure(new TmdbHttpError(404, "https://x/tv/1"))).toBe("not-found");
    expect(classifyTmdbFetchFailure(new TmdbHttpError(500, "https://x/tv/1"))).toBe("upstream");
    expect(classifyTmdbFetchFailure(new TmdbHttpError(429, "https://x/tv/1"))).toBe("upstream");
  });

  test("transport failures classify as unreachable", () => {
    expect(classifyTmdbFetchFailure(new Error("getaddrinfo ENOTFOUND api.tmdb.org"))).toBe(
      "unreachable",
    );
    expect(classifyTmdbFetchFailure(new Error("no TMDB hosts available"))).toBe("unreachable");
  });

  test("a body that is not JSON is malformed, not a dead connection", () => {
    expect(classifyTmdbFetchFailure(new SyntaxError("Unexpected token < in JSON"))).toBe(
      "malformed",
    );
  });

  test("unrecognised errors stay unknown rather than borrowing a cause", () => {
    expect(classifyTmdbFetchFailure(new Error("cannot read properties of undefined"))).toBe(
      "unknown",
    );
    expect(classifyTmdbFetchFailure(undefined)).toBe("unknown");
  });

  test("isTmdbClientError marks only definitive 4xx answers", () => {
    expect(isTmdbClientError(new TmdbHttpError(404, "u"))).toBe(true);
    expect(isTmdbClientError(new TmdbHttpError(403, "u"))).toBe(true);
    expect(isTmdbClientError(new TmdbHttpError(500, "u"))).toBe(false);
    expect(isTmdbClientError(new Error("socket"))).toBe(false);
  });
});

describe("describeSeasonLoadFailure", () => {
  test("unreachable is the only kind allowed to mention the connection", () => {
    expect(describeSeasonLoadFailure("unreachable")).toContain("network connection");
    for (const kind of ["upstream", "not-found", "empty", "malformed", "unknown"] as const) {
      const message = describeSeasonLoadFailure(kind);
      expect(message).not.toContain("Check your connection");
      expect(message).not.toContain("network connection");
      expect(message.length).toBeGreaterThan(0);
    }
  });

  test("offline mode explains unreachable and unknown, never an answered failure", () => {
    const offline = { offlineMode: true };
    expect(describeSeasonLoadFailure("unreachable", offline)).toContain("Offline mode");
    // A 404/5xx/malformed/empty read proves the network answered — blame the catalog.
    expect(describeSeasonLoadFailure("not-found", offline)).toContain("no record");
    expect(describeSeasonLoadFailure("upstream", offline)).toContain("answered with an error");
    expect(describeSeasonLoadFailure("empty", offline)).toContain("no playable seasons");
    expect(describeSeasonLoadFailure("malformed", offline)).toContain("could not be read");
  });

  test("a missing failure kind stays vague on purpose", () => {
    expect(describeSeasonLoadFailure(undefined)).toContain("unexpected error");
  });
});
