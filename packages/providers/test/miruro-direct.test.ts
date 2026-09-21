import { beforeAll, describe, expect, test } from "bun:test";

import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import { getMiruroKnownCatalog } from "../src/catalogs/miruro";
import {
  buildMiruroCycleCandidates,
  fetchMiruroPipeBody,
  computeMiruroEpisodesPersistTtlMs,
  createMiruroResultFromPayload,
  decodeMiruroPipePayload,
  interpretMiruroCurlResult,
  isMiruroAudioFallback,
  MiruroPipeDecodeError,
  type MiruroPipeDecodeFailureCode,
  setMiruroPipeRetrySleepForTest,
  MIRURO_SERVER_TRY_ORDER,
  resolveMiruroAnilistId,
  type MiruroServerProfile,
} from "../src/miruro/direct";
import { inferSubtitleFormat } from "../src/shared/subtitle-helpers";

const TEST_CONTEXT: ProviderRuntimeContext = {
  providerId: "miruro",
  now: () => "2026-08-13T00:00:00.000Z",
};

const TEST_INPUT: ProviderResolveInput = {
  title: { id: "anilist:21", kind: "anime", title: "One Piece", anilistId: "21" },
  episode: { season: 1, episode: 1159 },
  mediaKind: "anime",
  intent: "play",
  allowedRuntimes: ["direct-http"],
};

const KIWI_SUB: MiruroServerProfile = {
  id: "kiwi",
  label: "Kiwi",
  subtitleDelivery: "hardcoded",
  hardSubLanguage: "en",
};

/**
 * A labelled leaf playlist — `expandMiruroPipeStreams` passes it through without
 * a network fetch, so the builder stays deterministic.
 */
const SOURCE_DATA = {
  streams: [
    {
      url: "https://uwucdn.top/stream/1080/index.m3u8",
      type: "hls" as const,
      quality: "1080p",
      referer: "https://kwik.cx/",
    },
  ],
};

async function buildResult(
  streamReachabilityProbe?: Parameters<
    typeof createMiruroResultFromPayload
  >[0]["streamReachabilityProbe"],
) {
  return createMiruroResultFromPayload({
    input: TEST_INPUT,
    sourceData: SOURCE_DATA,
    audioCategory: "sub",
    serverProfile: KIWI_SUB,
    context: TEST_CONTEXT,
    streamReachabilityProbe,
  });
}

describe("createMiruroResultFromPayload reachability attestation", () => {
  test("omits the attestation when no probe evidence is supplied", async () => {
    const result = await buildResult();

    expect(result?.status).toBe("resolved");
    expect(result?.streams.length).toBeGreaterThan(0);
    expect(result?.streamReachabilityVerified).toBeUndefined();
  });

  test("omits the attestation for a timed-out probe", async () => {
    const result = await buildResult({ status: "timeout" });

    expect(result?.streamReachabilityVerified).toBeUndefined();
  });

  test("omits the attestation for an unreachable probe", async () => {
    const result = await buildResult({
      status: "unreachable",
      reason: "HTTP 403",
      definitive: true,
    });

    expect(result?.streamReachabilityVerified).toBeUndefined();
  });

  test("attests only for an explicitly reachable probe", async () => {
    const result = await buildResult({ status: "reachable" });

    expect(result?.streamReachabilityVerified).toBe(true);
  });
});

/**
 * Unlabeled master rows are fetched to expand their variant ladder — that fetch
 * is also the only liveness evidence a candidate gets. A definitive dead answer
 * (5xx / 404 / 410) must drop the stream so the candidate loses to the next
 * server; ambiguous failures (403, timeout, non-master body) still pass through
 * because gatekept CDNs reject expansion yet play fine in mpv.
 */
describe("createMiruroResultFromPayload dead-host drop", () => {
  const MASTER_SOURCE = {
    streams: [
      {
        url: "https://hls.dead.example/stream/abc/master.m3u8",
        type: "hls" as const,
        referer: "https://www.miruro.bz/",
      },
    ],
  };

  function contextReturning(status: number): ProviderRuntimeContext {
    return {
      ...TEST_CONTEXT,
      fetch: {
        runtime: "direct-http",
        fetch: async () => new Response("dead", { status }),
      } as ProviderRuntimeContext["fetch"],
    };
  }

  test("a 503 master playlist drops the stream and fails the candidate", async () => {
    const events: import("@kunai/types").ProviderTraceEvent[] = [];
    const result = await createMiruroResultFromPayload({
      input: TEST_INPUT,
      sourceData: MASTER_SOURCE,
      audioCategory: "sub",
      serverProfile: KIWI_SUB,
      context: contextReturning(503),
      events,
    });

    expect(result).toBeNull();
    expect(events.some((e) => e.type === "source:failed")).toBe(true);
  });

  test("a 404 master playlist drops the stream and fails the candidate", async () => {
    const result = await createMiruroResultFromPayload({
      input: TEST_INPUT,
      sourceData: MASTER_SOURCE,
      audioCategory: "sub",
      serverProfile: KIWI_SUB,
      context: contextReturning(404),
    });

    expect(result).toBeNull();
  });

  test("a 403 master playlist still passes through (WAF ambiguity preserved)", async () => {
    const result = await createMiruroResultFromPayload({
      input: TEST_INPUT,
      sourceData: MASTER_SOURCE,
      audioCategory: "sub",
      serverProfile: KIWI_SUB,
      context: contextReturning(403),
    });

    expect(result?.status).toBe("resolved");
    expect(result?.streams.length).toBeGreaterThan(0);
  });

  test("a dead master alongside a live leaf keeps the candidate alive", async () => {
    const result = await createMiruroResultFromPayload({
      input: TEST_INPUT,
      sourceData: {
        streams: [
          ...MASTER_SOURCE.streams,
          {
            url: "https://uwucdn.top/stream/720/index.m3u8",
            type: "hls" as const,
            quality: "720p",
            referer: "https://kwik.cx/",
          },
        ],
      },
      audioCategory: "sub",
      serverProfile: KIWI_SUB,
      context: contextReturning(503),
    });

    expect(result?.status).toBe("resolved");
    expect(result?.streams.some((s) => s.url?.includes("uwucdn"))).toBe(true);
  });
});

describe("resolveMiruroAnilistId", () => {
  const anime = (id: string, anilistId?: string) => ({
    id,
    kind: "anime" as const,
    title: "One Piece",
    ...(anilistId === undefined ? {} : { anilistId }),
  });

  test("accepts an explicit positive decimal anilistId", () => {
    expect(resolveMiruroAnilistId(anime("tmdb:37854", "438631"))).toBe("438631");
  });

  test("accepts an exact anilist: prefixed title id", () => {
    expect(resolveMiruroAnilistId(anime("anilist:438631"))).toBe("438631");
  });

  test("rejects a bare numeric title id with no anilist evidence", () => {
    expect(resolveMiruroAnilistId(anime("438631"))).toBeNull();
  });

  test("rejects zero, negative, signed and decimal ids", () => {
    expect(resolveMiruroAnilistId(anime("anilist:0"))).toBeNull();
    expect(resolveMiruroAnilistId(anime("anilist:-5"))).toBeNull();
    expect(resolveMiruroAnilistId(anime("anilist:+5"))).toBeNull();
    expect(resolveMiruroAnilistId(anime("anilist:4.5"))).toBeNull();
    expect(resolveMiruroAnilistId(anime("x", "0"))).toBeNull();
    expect(resolveMiruroAnilistId(anime("x", "-5"))).toBeNull();
    expect(resolveMiruroAnilistId(anime("x", "4.5"))).toBeNull();
  });

  test("rejects padded and partially numeric ids without trimming them into shape", () => {
    expect(resolveMiruroAnilistId(anime("anilist: 438631"))).toBeNull();
    expect(resolveMiruroAnilistId(anime("x", " 438631 "))).toBeNull();
    expect(resolveMiruroAnilistId(anime("anilist:438631abc"))).toBeNull();
    expect(resolveMiruroAnilistId(anime("x", "438631abc"))).toBeNull();
    expect(resolveMiruroAnilistId(anime("anilist:"))).toBeNull();
    expect(resolveMiruroAnilistId(anime("x", ""))).toBeNull();
  });

  test("rejects other catalogs' ids", () => {
    expect(resolveMiruroAnilistId(anime("tmdb:438631"))).toBeNull();
    expect(resolveMiruroAnilistId(anime("mal:21"))).toBeNull();
    expect(resolveMiruroAnilistId(anime("bxCKTopaque"))).toBeNull();
  });

  test("prefers the explicit anilistId over the title id", () => {
    expect(resolveMiruroAnilistId(anime("anilist:21", "438631"))).toBe("438631");
  });
});

describe("Miruro server order has one authority", () => {
  const EXPECTED_ORDER: readonly string[] = [
    "pewe",
    "moo",
    "bee",
    "ally",
    "bonk",
    "dune",
    "ANIMEKAI",
    "ANIMEZ",
    "ZORO",
    "kiwi",
    "hop",
  ];

  const episodes = { sub: [{ id: "ep-1", number: 1 }] };

  test("exports the canonical try order", () => {
    expect(MIRURO_SERVER_TRY_ORDER.map(String)).toEqual([...EXPECTED_ORDER]);
  });

  test("the known catalog is built from the same order", () => {
    const catalogServers = getMiruroKnownCatalog(["sub"]).map((entry) =>
      entry.sourceId.replace(/^source:miruro:pipe:/, "").replace(/:sub$/, ""),
    );

    expect(catalogServers).toEqual([...EXPECTED_ORDER]);
  });

  test("a hardcoded subtitle preference pulls sub servers ahead of dub", () => {
    // The builder gives sub servers a -5000 boost when hard-sub is preferred.
    // The resolve path never passed the preference, so the boost was dead code;
    // this proves it now reorders when the preference is supplied.
    const bothLangs = { sub: [{ id: "s-1", number: 1 }], dub: [{ id: "d-1", number: 1 }] };
    const providers = { kiwi: { episodes: bothLangs } };

    // The cycle engine orders by the `priority` field, so sort as it would.
    const leader = (
      candidates: ReturnType<typeof buildMiruroCycleCandidates>,
    ): string | undefined => [...candidates].sort((a, b) => a.priority - b.priority)[0]?.groupId;

    const withoutPreference = buildMiruroCycleCandidates({
      providers,
      episodeNum: 1,
      targetAudio: "dub",
      fallbackAudio: "sub",
    });
    // Default: dub (the target) is tried first.
    expect(leader(withoutPreference)).toBe("dub");

    const withHardsub = buildMiruroCycleCandidates({
      providers,
      episodeNum: 1,
      targetAudio: "dub",
      fallbackAudio: "sub",
      preferredSubtitleDelivery: "hardcoded",
    });
    // With the preference honoured, the boosted sub server leads.
    expect(leader(withHardsub)).toBe("sub");
  });

  test("fallback construction with no discovered providers follows the canonical order", () => {
    const candidates = buildMiruroCycleCandidates({
      episodes,
      episodeNum: 1,
      targetAudio: "sub",
      fallbackAudio: "sub",
    });

    expect(candidates.map((candidate) => candidate.serverId)).toEqual([...EXPECTED_ORDER]);
  });

  test("discovered providers are ranked by the canonical order", () => {
    const candidates = buildMiruroCycleCandidates({
      providers: {
        bonk: { episodes },
        ZORO: { episodes },
        kiwi: { episodes },
        bee: { episodes },
      },
      episodeNum: 1,
      targetAudio: "sub",
      fallbackAudio: "sub",
    });

    expect(candidates.map((candidate) => candidate.serverId)).toEqual([
      "bee",
      "bonk",
      "ZORO",
      "kiwi",
    ]);
  });

  test("unknown providers keep source order behind every known server", () => {
    const candidates = buildMiruroCycleCandidates({
      providers: {
        zzz: { episodes },
        bonk: { episodes },
        aaa: { episodes },
        kiwi: { episodes },
      },
      episodeNum: 1,
      targetAudio: "sub",
      fallbackAudio: "sub",
    });

    expect(candidates.map((candidate) => candidate.serverId)).toEqual([
      "bonk",
      "kiwi",
      "zzz",
      "aaa",
    ]);
  });
});

describe("decodeMiruroPipePayload", () => {
  const FIXTURES = new URL("./fixtures/miruro/", import.meta.url);
  const read = (name: string) => Bun.file(new URL(name, FIXTURES)).text();
  const PIPE_KEY = "71951034f8fbcf53d89db52ceb3dc22c";

  const decode = (
    body: string,
    expectedKind: "episodes" | "sources",
    overrides: { obfuscationVersion?: string | null; keyHex?: string } = {},
  ) =>
    decodeMiruroPipePayload({
      body,
      obfuscationVersion:
        "obfuscationVersion" in overrides ? (overrides.obfuscationVersion ?? null) : "2",
      expectedKind,
      keyHex: "keyHex" in overrides ? overrides.keyHex : PIPE_KEY,
    });

  const expectCode = (run: () => unknown, code: MiruroPipeDecodeFailureCode) => {
    try {
      run();
    } catch (error) {
      expect(error).toBeInstanceOf(MiruroPipeDecodeError);
      expect((error as MiruroPipeDecodeError).code).toBe(code);
      return;
    }
    throw new Error(`expected ${code} but decode succeeded`);
  };

  let episodesUnderForeignKey = "";
  let sourcesUnderForeignKey = "";

  beforeAll(async () => {
    episodesUnderForeignKey = await read("pipe-wrong-key-episodes-v2.txt");
    sourcesUnderForeignKey = await read("pipe-wrong-key-sources-v2.txt");
  });

  test("decodes a plain version-2 episodes body", async () => {
    const decoded = decode(await read("pipe-valid-episodes-v2.txt"), "episodes");

    expect(decoded).toMatchObject({
      mappings: { malId: 21 },
      providers: { kiwi: { episodes: { sub: [{ id: "kiwi-ep-1", number: 1 }] } } },
    });
  });

  test("decodes a gzipped version-2 sources body", async () => {
    const decoded = decode(await read("pipe-valid-sources-v2.txt"), "sources");

    expect(decoded).toMatchObject({
      streams: [{ url: "https://uwucdn.top/stream/1080/index.m3u8", quality: "1080p" }],
      intro: { start: 0, end: 90 },
    });
  });

  test("reports a missing or unusable key distinctly", async () => {
    const body = await read("pipe-valid-episodes-v2.txt");

    expectCode(() => decode(body, "episodes", { keyHex: undefined }), "pipe-key-missing");
    expectCode(() => decode(body, "episodes", { keyHex: "" }), "pipe-key-missing");
    expectCode(() => decode(body, "episodes", { keyHex: "zz" }), "pipe-key-missing");
  });

  test("reports an unexpected obfuscation version distinctly", async () => {
    const body = await read("pipe-valid-episodes-v2.txt");

    expectCode(
      () => decode(body, "episodes", { obfuscationVersion: "3" }),
      "pipe-version-mismatch",
    );
    expectCode(
      () => decode(body, "episodes", { obfuscationVersion: null }),
      "pipe-version-mismatch",
    );
  });

  test("reports a base64 failure distinctly", () => {
    expectCode(() => decode("!!!not base64!!!", "episodes"), "pipe-base64-invalid");
  });

  test("reports an XOR/gunzip failure distinctly", async () => {
    const body = await read("pipe-truncated-gzip-sources-v2.txt");

    expectCode(() => decode(body, "sources"), "pipe-xor-gunzip-failed");
  });

  test("reports a JSON syntax failure distinctly", async () => {
    const body = await read("pipe-wrong-key-episodes-v2.txt");

    expectCode(() => decode(body, "episodes"), "pipe-json-syntax-invalid");
  });

  // A rotated key does not announce itself: XOR always "succeeds", so the failure
  // surfaces at whichever later stage the garbage breaks. Both codes are still
  // actionable and neither is silent, which is the point.
  test("a rotated key surfaces at the stage its garbage actually breaks", async () => {
    expectCode(() => decode(episodesUnderForeignKey, "episodes"), "pipe-json-syntax-invalid");
    expectCode(() => decode(sourcesUnderForeignKey, "sources"), "pipe-json-syntax-invalid");
  });

  test("reports endpoint schema drift distinctly", async () => {
    const episodesBody = await read("pipe-valid-episodes-v2.txt");
    const sourcesBody = await read("pipe-valid-sources-v2.txt");

    expectCode(() => decode(episodesBody, "sources"), "pipe-json-shape-invalid");
    expectCode(() => decode(sourcesBody, "episodes"), "pipe-json-shape-invalid");
  });

  test("never leaks the key, the encrypted body, or plaintext in a public failure", async () => {
    const body = await read("pipe-wrong-key-episodes-v2.txt");

    try {
      decode(body, "episodes");
      throw new Error("expected decode to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(MiruroPipeDecodeError);
      const rendered = `${(error as Error).name}: ${(error as Error).message}\n${(error as Error).stack ?? ""}`;
      expect(rendered).not.toContain(PIPE_KEY);
      expect(rendered).not.toContain(body.slice(0, 16));
      expect(rendered).not.toContain("Romance Dawn");
      expect((error as MiruroPipeDecodeError).message).toBe("pipe-json-syntax-invalid");
    }
  });
});

describe("subtitle format comes from evidence", () => {
  test("reads the extension, ignoring the query string", () => {
    expect(inferSubtitleFormat("https://cdn.example/track.vtt")).toBe("vtt");
    expect(inferSubtitleFormat("https://cdn.example/track.srt?token=redacted")).toBe("srt");
    expect(inferSubtitleFormat("https://cdn.example/track.ass#cue")).toBe("ass");
  });

  test("falls back to a known content type when the URL carries no extension", () => {
    expect(inferSubtitleFormat("https://cdn.example/track", "text/vtt")).toBe("vtt");
    expect(inferSubtitleFormat("https://cdn.example/track", "application/x-subrip")).toBe("srt");
    expect(inferSubtitleFormat("https://cdn.example/track", "text/x-ssa")).toBe("ass");
  });

  test("returns unknown rather than guessing SRT", () => {
    expect(inferSubtitleFormat("https://cdn.example/track.bin")).toBe("unknown");
    expect(inferSubtitleFormat("https://cdn.example/track")).toBe("unknown");
    expect(inferSubtitleFormat("https://cdn.example/track", "application/octet-stream")).toBe(
      "unknown",
    );
  });

  test("a Miruro subtitle row with no format evidence is not labelled SRT", async () => {
    const result = await createMiruroResultFromPayload({
      input: TEST_INPUT,
      sourceData: {
        ...SOURCE_DATA,
        subtitles: [
          { url: "https://cdn.example/eng.vtt", lang: "English" },
          { url: "https://cdn.example/eng.srt?token=redacted", lang: "English" },
          { url: "https://cdn.example/opaque-track", lang: "English" },
        ],
      },
      audioCategory: "sub",
      serverProfile: KIWI_SUB,
      context: TEST_CONTEXT,
    });

    expect(result?.subtitles.map((subtitle) => subtitle.format)).toEqual(["vtt", "srt", "unknown"]);
  });
});

describe("interpretMiruroCurlResult", () => {
  const marker = "\n__KUNAI_CURL_STATUS__:";

  test("accepts a complete transfer and strips the status marker", () => {
    const result = interpretMiruroCurlResult({
      exitCode: 0,
      stdout: `bh4YNPj7payload${marker}200`,
      stderr: "",
    });

    expect(result).toEqual({ status: 200, text: "bh4YNPj7payload" });
  });

  /**
   * curl writes its `-w` status line even when `--max-time` aborts mid-body, so
   * the marker alone is not proof of a complete transfer. Accepting it fed a
   * truncated payload to the decoder, which then reported a transport failure as
   * `pipe-xor-gunzip-failed` — a real Miruro live failure.
   */
  test("rejects a truncated transfer even though curl still reported HTTP 200", () => {
    expect(() =>
      interpretMiruroCurlResult({
        exitCode: 28,
        stdout: `bh4YNPj7partial${marker}200`,
        stderr: "curl: (28) Operation timed out after 8001 milliseconds with 1024 bytes received",
      }),
    ).toThrow("Operation timed out");
  });

  test("rejects a transfer that produced no HTTP status at all", () => {
    expect(() =>
      interpretMiruroCurlResult({ exitCode: 0, stdout: "no marker here", stderr: "" }),
    ).toThrow();
    expect(() =>
      interpretMiruroCurlResult({ exitCode: 0, stdout: `body${marker}not-a-number`, stderr: "" }),
    ).toThrow();
    expect(() =>
      interpretMiruroCurlResult({ exitCode: 0, stdout: `body${marker}0`, stderr: "" }),
    ).toThrow();
  });
});

describe("miruro audio fallback detection", () => {
  test("a resolved presentation matching the request is not a fallback", () => {
    expect(isMiruroAudioFallback("dub", "dub")).toBe(false);
    expect(isMiruroAudioFallback("sub", "sub")).toBe(false);
  });

  test("a dub request resolving a sub is a fallback", () => {
    // The silent dub->sub downgrade this event makes visible.
    expect(isMiruroAudioFallback("dub", "sub")).toBe(true);
    expect(isMiruroAudioFallback("sub", "dub")).toBe(true);
  });

  test("a missing or non-audio presentation is not treated as a fallback", () => {
    expect(isMiruroAudioFallback("dub", undefined)).toBe(false);
    expect(isMiruroAudioFallback("dub", "external")).toBe(false);
  });
});

describe("computeMiruroEpisodesPersistTtlMs", () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const NOW = Date.parse("2026-08-26T00:00:00.000Z");
  const ep = (airDate?: string) => ({ id: airDate ?? "x", number: 1, airDate });

  test("a finished show (newest episode aired long ago) persists for 12h", () => {
    const entries = [ep("2020-01-01T00:00:00.000Z"), ep("2020-03-15T00:00:00.000Z")];
    expect(computeMiruroEpisodesPersistTtlMs(entries, NOW)).toBe(12 * HOUR);
  });

  test("no parseable air date falls back to the finished 12h TTL", () => {
    expect(computeMiruroEpisodesPersistTtlMs([ep(), ep("not-a-date")], NOW)).toBe(12 * HOUR);
  });

  test("an airing show persists until roughly its next air date", () => {
    // Newest episode aired 2 days ago; the next is ~5 days out.
    const entries = [ep(new Date(NOW - 2 * DAY).toISOString())];
    expect(computeMiruroEpisodesPersistTtlMs(entries, NOW)).toBe(5 * DAY);
  });

  test("a just-aired show is capped at one week, never longer", () => {
    // Newest episode aired today; +7d would exceed the one-week cap.
    const entries = [ep(new Date(NOW).toISOString())];
    expect(computeMiruroEpisodesPersistTtlMs(entries, NOW)).toBe(7 * DAY);
  });

  test("an airing show close to its next episode persists only until then", () => {
    // Newest episode aired 6 days ago; next is ~1 day out.
    const entries = [ep(new Date(NOW - 6 * DAY).toISOString())];
    const ttl = computeMiruroEpisodesPersistTtlMs(entries, NOW);
    expect(ttl).toBe(DAY);
  });

  test("an overdue airing show clamps to the 2h floor rather than going negative", () => {
    // Newest episode aired 8 days ago; next was due 1 day ago.
    const entries = [ep(new Date(NOW - 8 * DAY).toISOString())];
    expect(computeMiruroEpisodesPersistTtlMs(entries, NOW)).toBe(2 * HOUR);
  });

  test("uses the newest air date across mixed entries", () => {
    const entries = [ep("2020-01-01T00:00:00.000Z"), ep(new Date(NOW - 6 * DAY).toISOString())];
    expect(computeMiruroEpisodesPersistTtlMs(entries, NOW)).toBe(DAY);
  });
});

describe("fetchMiruroPipeBody CF-challenge retry", () => {
  test("a challenged first fetch is refetched once and can clear to a valid body", async () => {
    let calls = 0;
    const sleepCalls: number[] = [];
    setMiruroPipeRetrySleepForTest((ms) => {
      sleepCalls.push(ms);
      return Promise.resolve();
    });
    try {
      const fetchPort = {
        fetch: async () => {
          calls += 1;
          if (calls === 1) {
            return new Response("<!DOCTYPE html><html><title>Just a moment</title>", {
              status: 403,
            });
          }
          return new Response("bh4YNPj7obfuscated-pipe-body", { status: 200 });
        },
      };
      const result = await fetchMiruroPipeBody(
        "https://www.miruro.bz/api/secure/pipe?x=1",
        {},
        undefined,
        fetchPort as never,
      );
      expect(calls).toBe(2);
      expect(result.status).toBe(200);
      expect(result.cloudflareHtml).toBe(false);
      expect(sleepCalls.length).toBe(1);
      expect(sleepCalls[0]).toBeGreaterThanOrEqual(400);
      expect(sleepCalls[0]).toBeLessThan(800);
    } finally {
      setMiruroPipeRetrySleepForTest(null);
    }
  });

  test("wafLikely skips the retry — a region-wide block is not re-polled", async () => {
    let calls = 0;
    setMiruroPipeRetrySleepForTest(() => {
      throw new Error("sleep must not run when wafLikely is set");
    });
    try {
      const fetchPort = {
        fetch: async () => {
          calls += 1;
          return new Response("<html>just a moment</html>", { status: 403 });
        },
      };
      const result = await fetchMiruroPipeBody(
        "https://www.miruro.bz/api/secure/pipe?x=1",
        {},
        undefined,
        fetchPort as never,
        { wafLikely: true },
      );
      expect(calls).toBe(1);
      expect(result.cloudflareHtml).toBe(true);
    } finally {
      setMiruroPipeRetrySleepForTest(null);
    }
  });
});
