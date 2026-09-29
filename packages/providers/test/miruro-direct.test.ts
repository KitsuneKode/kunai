import { beforeAll, describe, expect, test } from "bun:test";

import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import { getMiruroKnownCatalog } from "../src/catalogs/miruro";
import {
  buildMiruroCycleCandidates,
  fetchMiruroPipeBody,
  computeMiruroEpisodesPersistTtlMs,
  createMiruroResultFromPayload,
  decodeMiruroPipePayload,
  describeMiruroPipeFailure,
  interpretMiruroCurlResult,
  mapMiruroSearchMedia,
  miruroProviderModule,
  probeMiruroBackendDown,
  type MiruroSearchMedia,
  miruroWafBlockMessage,
  isMiruroAudioFallback,
  MiruroPipeDecodeError,
  type MiruroPipeDecodeFailureCode,
  setMiruroPipeRetrySleepForTest,
  MIRURO_SERVER_TRY_ORDER,
  resolveMiruroAnilistId,
  type MiruroServerProfile,
} from "../src/miruro/direct";
import { isCloudflareBlockBody, isCloudflareChallengeText } from "../src/shared/curl-impersonate";
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
    ...(anilistId === undefined ? null : { anilistId }),
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

  describe("audio order under a subtitle-delivery preference", () => {
    const bothLangs = { sub: [{ id: "s-1", number: 1 }], dub: [{ id: "d-1", number: 1 }] };
    const providers = { pewe: { episodes: bothLangs }, moo: { episodes: bothLangs } };

    // The cycle engine orders by the `priority` field, so sort as it would.
    const tryOrder = (candidates: ReturnType<typeof buildMiruroCycleCandidates>): string[] =>
      [...candidates]
        .sort((a, b) => a.priority - b.priority)
        .map((candidate) => `${candidate.serverId}:${candidate.groupId}`);

    test("a requested dub is tried before any sub, even when hard subs are preferred", () => {
      // The adapter prefers hard subs for every anime request, so a preference
      // that could outrank the audio the user chose meant Miruro never played
      // a dub while any sub server worked.
      const candidates = buildMiruroCycleCandidates({
        providers,
        episodeNum: 1,
        targetAudio: "dub",
        fallbackAudio: "sub",
        preferredSubtitleDelivery: "hardcoded",
      });
      expect(tryOrder(candidates)).toEqual(["pewe:dub", "moo:dub", "pewe:sub", "moo:sub"]);
    });

    test("a sub request keeps the canonical server order", () => {
      const candidates = buildMiruroCycleCandidates({
        providers,
        episodeNum: 1,
        targetAudio: "sub",
        fallbackAudio: "dub",
        preferredSubtitleDelivery: "hardcoded",
      });
      expect(tryOrder(candidates)).toEqual(["pewe:sub", "moo:sub", "pewe:dub", "moo:dub"]);
    });

    test("a source the user picked still leads, whatever its audio", () => {
      const candidates = buildMiruroCycleCandidates({
        providers,
        episodeNum: 1,
        targetAudio: "dub",
        fallbackAudio: "sub",
        preferredSubtitleDelivery: "hardcoded",
        preferredSourceId: "source:miruro:pipe:moo:sub",
      });
      expect(tryOrder(candidates)[0]).toBe("moo:sub");
    });
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
        // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
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
        // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
        fetchPort as never,
        { wafLikely: true },
      );
      expect(calls).toBe(1);
      expect(result.cloudflareHtml).toBe(true);
    } finally {
      setMiruroPipeRetrySleepForTest(null);
    }
  });

  test("an abort inside the retry wait stops the leg — no curl subprocess is spawned", async () => {
    const controller = new AbortController();
    let calls = 0;
    // The abort lands while the retry wait is in flight — the challenged
    // response must not fall through to the curl fallback (whose listener on
    // an already-dead signal never fires).
    setMiruroPipeRetrySleepForTest(() => {
      controller.abort();
      return Promise.resolve();
    });
    try {
      const fetchPort = {
        fetch: async () => {
          calls += 1;
          return new Response("<html>just a moment</html>", { status: 403 });
        },
      };
      await expect(
        fetchMiruroPipeBody(
          "https://www.miruro.bz/api/secure/pipe?x=1",
          {},
          controller.signal,
          // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
          fetchPort as never,
        ),
      ).rejects.toThrow();
      expect(calls).toBe(1);
    } finally {
      setMiruroPipeRetrySleepForTest(null);
    }
  });
});

/**
 * Both fixtures are trimmed from live 2026-09-11 captures of
 * `www.miruro.bz/api/secure/pipe`. The origin sits behind Cloudflare, so its own
 * error page carries the `cloudflareinsights.com` beacon and a
 * `/cdn-cgi/challenge-platform/` script — that is exactly what made the previous
 * "body starts with <html>" predicate read one dead upstream server as a
 * region-wide WAF block.
 */
const CLOUDFLARE_BLOCK_PAGE = `<!DOCTYPE html>
<!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->
<!--[if gt IE 8]><!--> <html class="no-js" lang="en-US"> <!--<![endif]-->
<head>
<title>Attention Required! | Cloudflare</title>
</head>
<body>
  <div id="cf-wrapper">
    <div id="cf-error-details" class="cf-error-details-wrap">blocked</div>
  </div>
</body>
</html>`;

const UPSTREAM_502_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="robots" content="noindex" />
<title>502 upstream unreachable</title>
</head>
<body>
  <h1>502</h1>
  <script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>
  <script type="module" src="https://static.cloudflareinsights.com/beacon.min.js/v31edd6df"></script>
</body>
</html>`;

describe("Cloudflare block detection separates a WAF block from a dead upstream", () => {
  test("classifies Cloudflare's own block interstitial as a block", () => {
    expect(isCloudflareBlockBody(CLOUDFLARE_BLOCK_PAGE)).toBe(true);
  });

  test("does not classify the origin's 502 page as a Cloudflare block", () => {
    // The regression: this page is HTML, is served through Cloudflare, and
    // mentions both `cdn-cgi` and `cloudflareinsights.com` — and is still just
    // one of the mirror's backing servers being down.
    expect(isCloudflareBlockBody(UPSTREAM_502_PAGE)).toBe(false);
  });

  test("does not classify an obfuscated success body as a Cloudflare block", () => {
    expect(isCloudflareBlockBody("bh4YNPj7abcdef")).toBe(false);
  });

  test("does not classify a JSON error body as a Cloudflare block", () => {
    expect(isCloudflareBlockBody('{"error":"Invalid envelope format"}')).toBe(false);
  });

  test("still catches a managed challenge, which is a block by another name", () => {
    expect(isCloudflareBlockBody("<html><head><title>Just a moment...</title></head></html>")).toBe(
      true,
    );
  });

  test("the challenge predicate is the narrower of the two, and stays that way", () => {
    const challenge = "<html><head><title>Just a moment...</title></head></html>";
    // A challenge is both a challenge and a block.
    expect(isCloudflareChallengeText(challenge)).toBe(true);
    expect(isCloudflareBlockBody(challenge)).toBe(true);

    // A hard 1020-style block is a block but NOT a challenge: no better TLS
    // fingerprint clears it, so callers that retry on a challenge must not
    // retry on this. AniDB depends on that distinction.
    expect(isCloudflareChallengeText(CLOUDFLARE_BLOCK_PAGE)).toBe(false);
    expect(isCloudflareBlockBody(CLOUDFLARE_BLOCK_PAGE)).toBe(true);

    // And neither fires on the origin's own error page.
    expect(isCloudflareChallengeText(UPSTREAM_502_PAGE)).toBe(false);
    expect(isCloudflareBlockBody(UPSTREAM_502_PAGE)).toBe(false);
  });
});

describe("describeMiruroPipeFailure names the failure the mirror actually had", () => {
  test("reports an upstream-unavailable status as an upstream failure", () => {
    // 444 is what the mirror returns when a backing server (pewe/ally/hop) is
    // down. Calling it Cloudflare sent users to configure a relay that cannot
    // help.
    expect(describeMiruroPipeFailure(444, UPSTREAM_502_PAGE)).toBe(
      "HTTP 444 (upstream server unavailable)",
    );
    expect(describeMiruroPipeFailure(502, UPSTREAM_502_PAGE)).toBe(
      "HTTP 502 (upstream server unavailable)",
    );
  });

  test("still reports a real Cloudflare block as cloudflare html", () => {
    expect(describeMiruroPipeFailure(403, CLOUDFLARE_BLOCK_PAGE)).toBe(
      "HTTP 403 (cloudflare html)",
    );
  });

  test("leaves an unremarkable status unqualified", () => {
    expect(describeMiruroPipeFailure(418, "{}")).toBe("HTTP 418");
  });
});

describe("the WAF block message advises the cheapest fix that can still work", () => {
  test("tells a plain-curl user to install curl-impersonate before suggesting a relay", () => {
    const message = miruroWafBlockMessage({
      path: "/usr/bin/curl",
      impersonates: false,
      profile: null,
    });
    expect(message).toContain("curl-impersonate");
    expect(message.indexOf("curl-impersonate")).toBeLessThan(message.indexOf("providerRelay"));
  });

  test("tells a user who already impersonated that the block is region-wide", () => {
    const message = miruroWafBlockMessage({
      path: "/usr/bin/curl_chrome150",
      impersonates: true,
      profile: "chrome150",
    });
    expect(message).toContain("chrome150");
    expect(message).toContain("providerRelay");
  });

  test("keeps the prefix runProviderCycle keys on", () => {
    for (const curl of [
      null,
      { path: "/usr/bin/curl_chrome150", impersonates: true, profile: "chrome150" },
    ]) {
      expect(miruroWafBlockMessage(curl)).toContain("Cloudflare WAF on multiple mirrors");
    }
  });
});

/**
 * Trimmed from a live 2026-09-11 `search` response for `q: "one piece"`, taken
 * while AniList's own API was answering 403 "temporarily disabled".
 */
const ONE_PIECE_ROW: MiruroSearchMedia = {
  id: 21,
  idMal: 21,
  type: "ANIME",
  format: "TV",
  status: "RELEASING",
  isAdult: false,
  episodes: null,
  duration: 24,
  averageScore: 87,
  popularity: 749552,
  seasonYear: 1999,
  startDate: { year: 1999 },
  description: "Gold Roger was known as the Pirate King.<br><br>\nEnter Monkey D. Luffy.",
  title: { native: "ONE PIECE", romaji: "ONE PIECE", english: "ONE PIECE" },
  coverImage: {
    extraLarge: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21.jpg",
    large: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21.jpg",
  },
  bannerImage: "https://s4.anilist.co/file/anilistcdn/media/anime/banner/21.jpg",
};

describe("Miruro search", () => {
  test("carries the same identity the AniList search service produces", () => {
    const result = mapMiruroSearchMedia(ONE_PIECE_ROW);

    // A bare AniList id plus externalIds.anilistId is exactly what
    // definitions/anilist.ts emits, so history sees one title, not two.
    expect(result?.id).toBe("21");
    expect(result?.externalIds).toEqual({ anilistId: "21", malId: "21" });
    expect(result?.title).toBe("ONE PIECE");
    expect(result?.type).toBe("series");
    expect(result?.year).toBe("1999");
    expect(result?.rating).toBe(8.7);
    expect(result?.durationSeconds).toBe(24 * 60);
    expect(result?.overview).toBe(
      "Gold Roger was known as the Pirate King. Enter Monkey D. Luffy.",
    );
    expect(result?.posterPath).toContain("/cover/large/");
    expect(result?.artwork?.backdropUrl).toContain("/banner/");
  });

  test("declares AniList as the metadata source so routing skips re-enriching it", () => {
    // SearchRoutingService skips enrichment only for `metadataSource ===
    // "AniList"` with a poster. Enrichment calls AniList's API — the thing that
    // is down in the case this search exists for.
    const result = mapMiruroSearchMedia(ONE_PIECE_ROW);
    expect(result?.metadataSource).toBe("AniList");
    expect(result?.posterPath).toBeTruthy();
  });

  test("drops what the AniList service's query would have excluded", () => {
    expect(mapMiruroSearchMedia({ ...ONE_PIECE_ROW, type: "MANGA", format: "MANGA" })).toBeNull();
    expect(mapMiruroSearchMedia({ ...ONE_PIECE_ROW, isAdult: true })).toBeNull();
    expect(mapMiruroSearchMedia({ ...ONE_PIECE_ROW, status: "NOT_YET_RELEASED" })).toBeNull();
  });

  test("rejects a row with no usable AniList id or title", () => {
    expect(mapMiruroSearchMedia({ ...ONE_PIECE_ROW, id: 0 })).toBeNull();
    expect(mapMiruroSearchMedia({ ...ONE_PIECE_ROW, id: 1.5 })).toBeNull();
    expect(mapMiruroSearchMedia({ ...ONE_PIECE_ROW, id: undefined })).toBeNull();
    expect(mapMiruroSearchMedia({ ...ONE_PIECE_ROW, title: {} })).toBeNull();
  });

  test("omits a MAL id it does not have rather than inventing one", () => {
    expect(mapMiruroSearchMedia({ ...ONE_PIECE_ROW, idMal: null })?.externalIds).toEqual({
      anilistId: "21",
    });
  });

  test("falls back to romaji when there is no English title, and keeps it as an alias", () => {
    const result = mapMiruroSearchMedia({
      ...ONE_PIECE_ROW,
      title: { romaji: "Sousou no Frieren", native: "葬送のフリーレン" },
    });
    expect(result?.title).toBe("Sousou no Frieren");
    expect(result?.nativeTitle).toBe("葬送のフリーレン");
    expect(result?.altNames).toBeUndefined();

    const withEnglish = mapMiruroSearchMedia({
      ...ONE_PIECE_ROW,
      title: { english: "Frieren", romaji: "Sousou no Frieren" },
    });
    expect(withEnglish?.title).toBe("Frieren");
    expect(withEnglish?.altNames).toEqual(["Sousou no Frieren"]);
  });

  test("classifies structure the way the CLI's AniList format rule does", () => {
    const type = (format: string | null, episodes: number | null) =>
      mapMiruroSearchMedia({ ...ONE_PIECE_ROW, format, episodes })?.type;
    expect(type("MOVIE", 1)).toBe("movie");
    expect(type("SPECIAL", 1)).toBe("movie");
    expect(type("OVA", 1)).toBe("movie");
    expect(type("SPECIAL", 12)).toBe("series");
    // TV and ONA stay series even with one episode aired.
    expect(type("ONA", 1)).toBe("series");
    expect(type("TV", 1)).toBe("series");
    expect(type(null, 1)).toBe("series");
  });

  test("a failed search still returns null, but says so in the trace", async () => {
    const events: { type: string; sourceId?: string; message: string }[] = [];
    // SAFETY: the search path reads only providerId, now, emit and fetch; the
    // fetch rejects before any pipe or curl code could read further members.
    const context = {
      providerId: "miruro",
      now: () => "2026-09-11T00:00:00.000Z",
      emit: (event: { type: string; sourceId?: string; message: string }) => events.push(event),
      fetch: {
        fetch: async () => {
          throw new Error("offline");
        },
      },
    } as never;

    expect(await miruroProviderModule.search?.({ query: "one piece" }, context)).toBeNull();
    expect(events.at(-1)).toMatchObject({
      type: "source:failed",
      sourceId: "source:miruro:search",
    });
  });

  test("an empty query never reaches the network", async () => {
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    const context = { providerId: "miruro", now: () => "2026-09-11T00:00:00.000Z" } as never;
    expect(await miruroProviderModule.search?.({ query: "   " }, context)).toBeNull();
  });
});

describe("probeMiruroBackendDown", () => {
  const withStatus = (status: number) => {
    const seen: { url?: string; headers?: Record<string, string> }[] = [];
    const context = {
      fetch: {
        fetch: async (url: string, init?: RequestInit) => {
          seen.push({ url, headers: init?.headers as Record<string, string> });
          return new Response("x", { status });
        },
      },
    } as never;
    return { context, seen };
  };

  test("reports a backend whose host is down", async () => {
    // 503 is what hls.anidb.app answered through AniDB's maintenance, to
    // every client — the case that handed mpv a dead URL.
    for (const status of [503, 502, 504, 404, 410]) {
      const { context } = withStatus(status);
      expect(await probeMiruroBackendDown("https://hls.anidb.app/x/master.m3u8", {}, context)).toBe(
        status,
      );
    }
  });

  test("a plain 500 is not evidence: a CDN returns it to anything but its player", async () => {
    // AnimeGG (`moo`) hands off to vidcache, which answers
    // {"error":"Invalid request (bad hand off)"} with 500 to a bare ranged GET
    // while mpv plays the same URL. Rejecting on it skipped the most reliable
    // backend Miruro has.
    // Uses another host: AnimeGG itself is no longer asked (see below), and
    // this test is about the 500 rule, which any backend's CDN can trip.
    const { context } = withStatus(500);
    expect(
      await probeMiruroBackendDown("https://cdn.backend.test/v/video.mp4", {}, context),
    ).toBeNull();
  });

  test("a status from a different host than the one asked is not evidence", async () => {
    // The backend answered and redirected; what the CDN it handed us to says
    // about one odd request tells us nothing about the backend.
    const context = {
      fetch: {
        fetch: async () =>
          Object.defineProperty(new Response("{}", { status: 503 }), "url", {
            value: "https://vidcache.net:8161/abc/video.mp4",
          }),
      },
    } as never;
    expect(
      await probeMiruroBackendDown("https://handoff.backend.test/play/1/video.mp4", {}, context),
    ).toBeNull();
  });

  test("does not ask AnimeGG at all — Bun gets no answer from it, only a timeout", async () => {
    // Every moo stream is an animegg.org/play URL, and that endpoint never
    // answers Bun's fetch; the probe spent its whole timeout on every Moo
    // resolve to return "no evidence".
    let asked = 0;
    const context = {
      fetch: {
        fetch: async () => {
          asked += 1;
          return new Response("", { status: 503 });
        },
      },
    } as never;

    expect(
      await probeMiruroBackendDown("https://www.animegg.org/play/1/video.mp4", {}, context),
    ).toBeNull();
    expect(asked).toBe(0);
  });

  test("a same-host redirect still counts", async () => {
    const context = {
      fetch: {
        fetch: async () =>
          Object.defineProperty(new Response("{}", { status: 503 }), "url", {
            value: "https://hls.anidb.app/redirected/master.m3u8",
          }),
      },
    } as never;
    expect(await probeMiruroBackendDown("https://hls.anidb.app/x/master.m3u8", {}, context)).toBe(
      503,
    );
  });

  test("does not condemn a server for refusing this particular client", async () => {
    // owocdn behind kwik answers Bun's fetch with 403 while mpv plays the URL.
    for (const status of [401, 403, 416]) {
      const { context } = withStatus(status);
      expect(await probeMiruroBackendDown("https://vault-16.owocdn.top/x.m3u8", {}, context)).toBe(
        null,
      );
    }
  });

  test("a rate-limited master is rejected — no player gets past one", async () => {
    // 2026-09-12: pewe's hls.anidb.app answered 429 to mpv, to curl with the
    // stream's headers and to curl with none, so the anime lane resolved a
    // stream nothing could open. Unlike 403, this is not a client-specific no.
    const { context } = withStatus(429);
    expect(await probeMiruroBackendDown("https://hls.anidb.app/x/master.m3u8", {}, context)).toBe(
      429,
    );
  });

  test("a working backend is not reported down", async () => {
    for (const status of [200, 206]) {
      const { context } = withStatus(status);
      expect(
        await probeMiruroBackendDown("https://cdn.backend.test/v/video.mp4", {}, context),
      ).toBe(null);
    }
  });

  test("a timeout or connection failure is not evidence the backend is down", async () => {
    // Being offline must not read as "every server is dead".
    const context = {
      fetch: {
        fetch: async () => {
          throw new TypeError("fetch failed: ECONNREFUSED");
        },
      },
    } as never;
    expect(await probeMiruroBackendDown("https://example.test/x.m3u8", {}, context)).toBeNull();
  });

  test("sends the stream's own headers, ranged to one byte", async () => {
    const { context, seen } = withStatus(206);
    await probeMiruroBackendDown(
      "https://vault-16.owocdn.top/x.m3u8",
      { Referer: "https://kwik.cx/" },
      context,
    );
    expect(seen[0]?.headers).toMatchObject({ Referer: "https://kwik.cx/", Range: "bytes=0-0" });
  });

  test("never probes something that is not a remote URL", async () => {
    const { context, seen } = withStatus(503);
    expect(await probeMiruroBackendDown("/tmp/local/stream.mpd", {}, context)).toBeNull();
    expect(seen).toHaveLength(0);
  });
});

describe("decodeMiruroPipePayload for search", () => {
  const PIPE_KEY = "71951034f8fbcf53d89db52ceb3dc22c";
  // Plain (un-gzipped) version-2 body: base64url(xor(json, key)).
  const encode = (value: unknown): string => {
    const key = Uint8Array.from(
      (PIPE_KEY.match(/.{2}/g) ?? []).map((hex) => Number.parseInt(hex, 16)),
    );
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const xored = bytes.map((byte, index) => byte ^ (key[index % key.length] ?? 0));
    let binary = "";
    for (const byte of xored) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const decode = (value: unknown) =>
    decodeMiruroPipePayload({
      body: encode(value),
      obfuscationVersion: "2",
      expectedKind: "search",
      keyHex: PIPE_KEY,
    });

  test("accepts a list of media rows", () => {
    expect(decode([ONE_PIECE_ROW])).toEqual([ONE_PIECE_ROW]);
  });

  test("accepts an empty list as a real no-match, not a shape failure", () => {
    expect(decode([])).toEqual([]);
  });

  test("rejects an episodes-shaped body sent to the search contract", () => {
    try {
      decode({ providers: {}, mappings: {} });
    } catch (error) {
      expect((error as MiruroPipeDecodeError).code).toBe("pipe-json-shape-invalid");
      return;
    }
    throw new Error("expected a shape failure");
  });

  test("rejects rows without a numeric id", () => {
    try {
      decode([{ id: "21" }]);
    } catch (error) {
      expect((error as MiruroPipeDecodeError).code).toBe("pipe-json-shape-invalid");
      return;
    }
    throw new Error("expected a shape failure");
  });
});
