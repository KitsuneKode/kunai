import { describe, expect, test } from "bun:test";

import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import { getMiruroKnownCatalog } from "../src/catalogs/miruro";
import {
  buildMiruroCycleCandidates,
  createMiruroResultFromPayload,
  MIRURO_SERVER_TRY_ORDER,
  resolveMiruroAnilistId,
  type MiruroServerProfile,
} from "../src/miruro/direct";

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
    "kiwi",
    "pewe",
    "bee",
    "hop",
    "moo",
    "dune",
    "ANIMEKAI",
    "ANIMEZ",
    "ZORO",
    "ally",
    "bonk",
  ];

  const episodes = { sub: [{ id: "ep-1", number: 1 }] };

  test("exports the canonical try order with bonk last", () => {
    expect(MIRURO_SERVER_TRY_ORDER.map(String)).toEqual([...EXPECTED_ORDER]);
  });

  test("the known catalog is built from the same order", () => {
    const catalogServers = getMiruroKnownCatalog(["sub"]).map((entry) =>
      entry.sourceId.replace(/^source:miruro:pipe:/, "").replace(/:sub$/, ""),
    );

    expect(catalogServers).toEqual([...EXPECTED_ORDER]);
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
      "kiwi",
      "bee",
      "ZORO",
      "bonk",
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
      "kiwi",
      "bonk",
      "zzz",
      "aaa",
    ]);
  });
});
