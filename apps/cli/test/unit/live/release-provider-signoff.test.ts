import { describe, expect, test } from "bun:test";

import {
  assertReleaseProviderSignoffComplete,
  assertReleaseProviderSignoffRedacted,
  buildReleaseProviderSignoff,
  classifyReleaseSignoffFailure,
  isReleaseProviderSignoffAcceptable,
  isReleaseProviderSignoffFresh,
  redactVolatileSignoffText,
  type ReleaseProviderSignoff,
  type ReleaseProviderSignoffRoute,
} from "../../live/release-provider-signoff";

function baseRoutes(
  overrides: Partial<
    Record<ReleaseProviderSignoffRoute["lane"], Partial<ReleaseProviderSignoffRoute>>
  > = {},
): readonly ReleaseProviderSignoffRoute[] {
  const movie: ReleaseProviderSignoffRoute = {
    lane: "movie",
    configuredProvider: "videasy",
    successfulProvider: "videasy",
    resolved: true,
    streamCandidates: 3,
    streamReachable: true,
    failureClass: null,
    durationMs: 1_200,
    ...overrides.movie,
  };
  const series: ReleaseProviderSignoffRoute = {
    lane: "series",
    configuredProvider: "videasy",
    successfulProvider: "videasy",
    resolved: true,
    streamCandidates: 2,
    streamReachable: true,
    failureClass: null,
    durationMs: 2_100,
    ...overrides.series,
  };
  const anime: ReleaseProviderSignoffRoute = {
    lane: "anime",
    configuredProvider: "allanime",
    successfulProvider: "allanime",
    resolved: true,
    streamCandidates: 1,
    streamReachable: true,
    failureClass: null,
    durationMs: 3_400,
    ...overrides.anime,
  };
  return [movie, series, anime];
}

describe("release provider signoff", () => {
  test("requires all three lanes with separate configured/successful provider fields", () => {
    const signoff = buildReleaseProviderSignoff({
      generatedAt: "2026-07-21T06:00:00.000Z",
      commitSha: "abc123",
      version: "0.3.0",
      routes: baseRoutes({
        series: { configuredProvider: "videasy", successfulProvider: "rivestream" },
      }),
    });

    expect(signoff.schemaVersion).toBe(1);
    expect(signoff.routes.map((route) => route.lane)).toEqual(["movie", "series", "anime"]);
    expect(signoff.routes[1]?.configuredProvider).toBe("videasy");
    expect(signoff.routes[1]?.successfulProvider).toBe("rivestream");
    expect(Object.keys(signoff.routes[0]!).sort()).toEqual(
      [
        "configuredProvider",
        "durationMs",
        "failureClass",
        "lane",
        "resolved",
        "streamCandidates",
        "streamReachable",
        "successfulProvider",
      ].sort(),
    );
  });

  test("completeness rejects missing or duplicate lanes", () => {
    const incomplete: ReleaseProviderSignoff = {
      schemaVersion: 1,
      generatedAt: "2026-07-21T06:00:00.000Z",
      commitSha: "abc123",
      version: "0.3.0",
      routes: baseRoutes().slice(0, 2),
    };
    expect(() => assertReleaseProviderSignoffComplete(incomplete)).toThrow(
      /Missing release signoff lane: anime/,
    );

    const duplicate: ReleaseProviderSignoff = {
      schemaVersion: 1,
      generatedAt: "2026-07-21T06:00:00.000Z",
      commitSha: "abc123",
      version: "0.3.0",
      routes: [...baseRoutes().slice(0, 2), { ...baseRoutes()[0]! }],
    };
    expect(() => assertReleaseProviderSignoffComplete(duplicate)).toThrow(
      /Duplicate release signoff lane: movie/,
    );
  });

  test("redaction rejects stream URL, token, cookie, and home path leakage", () => {
    const clean = buildReleaseProviderSignoff({
      generatedAt: "2026-07-21T06:00:00.000Z",
      commitSha: "abc123",
      version: "0.3.0",
      routes: baseRoutes(),
    });
    const dirty = {
      ...clean,
      routes: clean.routes.map((route, index) =>
        index === 0
          ? { ...route, streamUrl: "https://cdn.example/master.m3u8?token=secret" }
          : route,
      ),
    } as ReleaseProviderSignoff;
    expect(() => assertReleaseProviderSignoffRedacted(dirty)).toThrow(/must not include/);

    const withHome = {
      ...clean,
      routes: clean.routes.map((route, index) =>
        index === 2
          ? { ...route, note: "/home/kitsunekode/.config/kunai/config.json cookie=abc" }
          : route,
      ),
    } as ReleaseProviderSignoff;
    expect(() => assertReleaseProviderSignoffRedacted(withHome)).toThrow(/must not include/);
  });

  test("redactVolatileSignoffText strips URLs, tokens, and home paths", () => {
    const redacted = redactVolatileSignoffText(
      "failed https://cdn.example/x?token=secret under /home/kitsunekode/.config token=bare-secret cookie=abc",
    );
    expect(redacted).toContain("https://REDACTED");
    expect(redacted).not.toMatch(/cdn\.example/i);
    expect(redacted).toContain("token=REDACTED");
    expect(redacted).not.toContain("bare-secret");
    expect(redacted).toContain("/home/REDACTED");
    expect(redacted).not.toContain("/home/kitsunekode");
  });

  test("freshness is capped at 24 hours for final approval evidence", () => {
    const generatedAt = "2026-07-21T06:00:00.000Z";
    const now = Date.parse("2026-07-21T12:00:00.000Z");
    expect(isReleaseProviderSignoffFresh(generatedAt, now)).toBe(true);
    expect(isReleaseProviderSignoffFresh(generatedAt, Date.parse("2026-07-22T07:00:00.000Z"))).toBe(
      false,
    );

    const signoff = buildReleaseProviderSignoff({
      generatedAt,
      commitSha: "abc123",
      version: "0.3.0",
      routes: baseRoutes(),
    });
    expect(isReleaseProviderSignoffAcceptable(signoff, now)).toBe(true);

    const unresolved = buildReleaseProviderSignoff({
      generatedAt,
      commitSha: "abc123",
      version: "0.3.0",
      routes: baseRoutes({
        series: {
          resolved: false,
          successfulProvider: null,
          streamReachable: false,
          failureClass: "environment-network",
        },
      }),
    });
    expect(isReleaseProviderSignoffAcceptable(unresolved, now)).toBe(false);
  });

  test("classifyReleaseSignoffFailure separates network from provider drift", () => {
    expect(
      classifyReleaseSignoffFailure({
        resolved: true,
        streamReachable: true,
      }),
    ).toBeNull();
    expect(
      classifyReleaseSignoffFailure({
        resolved: false,
        streamReachable: null,
        timedOut: true,
      }),
    ).toBe("environment-network");
    expect(
      classifyReleaseSignoffFailure({
        resolved: false,
        streamReachable: null,
        failureCodes: ["route-dead"],
      }),
    ).toBe("provider-drift");
    expect(
      classifyReleaseSignoffFailure({
        resolved: false,
        streamReachable: null,
        harness: true,
      }),
    ).toBe("harness-failure");
  });
});
