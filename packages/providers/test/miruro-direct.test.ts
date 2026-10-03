import { describe, expect, test } from "bun:test";

import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import { getMiruroKnownCatalog } from "../src/catalogs/miruro";
import {
  buildMiruroCycleCandidates,
  computeMiruroEpisodesPersistTtlMs,
  createMiruroResultFromPayload,
  isMiruroAudioFallback,
  miruroProviderModule,
  MIRURO_SERVER_TRY_ORDER,
  probeMiruroBackendDown,
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
 * A labelled leaf playlist — `expandMiruroStreams` passes it through without
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
    "animepahe",
    "icarus",
    "vault-6-direct",
    "Vid",
    "HD",
    "Vidstream",
    "Vidplay",
    "BYFMS",
    "DGHG",
    "Bird",
  ];

  const episodes = { sub: [{ id: "ep-1", number: 1 }] };

  test("exports the canonical try order", () => {
    expect(MIRURO_SERVER_TRY_ORDER.map(String)).toEqual([...EXPECTED_ORDER]);
  });

  test("the known catalog is built from the same order", () => {
    const catalogServers = getMiruroKnownCatalog(["sub"]).map((entry) =>
      entry.sourceId.replace(/^source:miruro:catalog:/, "").replace(/:sub$/, ""),
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
        preferredSourceId: "source:miruro:catalog:moo:sub",
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
        "HD-2": { episodes },
        "vault-6-direct-1": { episodes },
        Bird: { episodes },
        animepahe: { episodes },
      },
      episodeNum: 1,
      targetAudio: "sub",
      fallbackAudio: "sub",
    });

    expect(candidates.map((candidate) => candidate.serverId)).toEqual([
      "animepahe",
      "vault-6-direct-1",
      "HD-2",
      "Bird",
    ]);
  });

  test("unknown providers keep source order behind every known server", () => {
    const candidates = buildMiruroCycleCandidates({
      providers: {
        zzz: { episodes },
        "icarus-2-3": { episodes },
        aaa: { episodes },
        Vid: { episodes },
      },
      episodeNum: 1,
      targetAudio: "sub",
      fallbackAudio: "sub",
    });

    expect(candidates.map((candidate) => candidate.serverId)).toEqual([
      "icarus-2-3",
      "Vid",
      "zzz",
      "aaa",
    ]);
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

describe("Miruro search", () => {
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
