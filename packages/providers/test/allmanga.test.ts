import { describe, expect, test } from "bun:test";
import { createCipheriv, createDecipheriv, createHash } from "node:crypto";

import type {
  ProviderResolveInput,
  ProviderResolveResult,
  ProviderRuntimeContext,
  ProviderTitleBridgePort,
} from "@kunai/types";

import { safeAllMangaHostname } from "../src/allmanga/direct";
import {
  clearAllMangaAnilistBridgeCacheForTest,
  isCatalogIdPassedAsShowId,
  looksLikeAllMangaOpaqueShowId,
  resolveAllMangaShowId,
} from "../src/allmanga/resolve-show-id";
import {
  allmangaProviderModule,
  buildAllmangaCycleCandidates,
  buildAllMangaAaReq,
  buildAllMangaBootToken,
  ALLMANGA_KEY_HEX,
  ALLMANGA_QUERY_HASH,
  BUNDLED_ALLMANGA_CRYPTO,
  buildStreamHeaders,
  AllMangaCaptchaError,
  clearAllMangaProviderCachesForTest,
  decodeTobeparsed,
  decryptTobeparsedPlaintext,
  decryptTobeparsedWithEpochFallback,
  deriveKeyFromPartB,
  deriveMaskKey,
  extractRawSources,
  fetchAllMangaEpisodeCatalog,
  getAllMangaCryptoMaterial,
  gqlPost,
  hashBuildId,
  resolveAllMangaAkDeferredLocator,
  resolveAnimeEpisodeString,
  resolveEpisodeSources,
  searchAllManga,
  collectAllMangaLinksForStartup,
  setAllMangaCryptoMaterialForTest,
  setAllMangaRetrySleepForTest,
} from "../src/index";

const TEST_KEY_HEX = ALLMANGA_KEY_HEX;
const FIXTURE_BASE = new URL("./fixtures/allmanga/", import.meta.url);
const TEST_CONTEXT: ProviderRuntimeContext = {
  providerId: "allanime",
  now: () => new Date().toISOString(),
};

test("AllManga source evidence rejects malformed hosts without losing valid hosts", () => {
  expect(safeAllMangaHostname("https://")).toBeNull();
  expect(safeAllMangaHostname("not a URL")).toBeNull();
  expect(safeAllMangaHostname("https://cdn.example/video.m3u8")).toBe("cdn.example");
});

describe("resolveAllMangaShowId", () => {
  test("returns stored providerNativeIds without bridging", async () => {
    const showId = await resolveAllMangaShowId(
      {
        title: {
          id: "20431",
          kind: "anime",
          title: "Hozuki",
          externalIds: {
            anilistId: "20431",
            providerNativeIds: { allanime: "bxCKTstored" },
          },
        },
        preferredAudioLanguage: "original",
      },
      TEST_CONTEXT,
    );

    expect(showId).toBe("bxCKTstored");
  });

  test("keeps opaque provider-native ids without bridging", async () => {
    const showId = await resolveAllMangaShowId(
      {
        title: {
          id: "bxCKTnota29uSRnZw",
          kind: "anime",
          title: "Hoozuki no Reitetsu",
          externalIds: { anilistId: "20431" },
        },
        preferredAudioLanguage: "original",
      },
      TEST_CONTEXT,
    );

    expect(showId).toBe("bxCKTnota29uSRnZw");
  });

  test("fails closed before catalog lookup when a numeric id has no AniList metadata", async () => {
    using fetchMock = mockAllMangaBridgeFetch("unexpected");
    const result = await allmangaProviderModule.resolve(
      {
        episode: { episode: 1 },
        mediaKind: "anime",
        intent: "play",
        allowedRuntimes: ["direct-http"],
        title: {
          id: "20431",
          kind: "anime",
          title: "Hozuki's Coolheadedness",
        },
      },
      TEST_CONTEXT,
    );

    expect(result.status).toBe("exhausted");
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      providerId: "allanime",
      code: "unsupported-title",
      message: "AllManga title bridge requires an AniList ID for numeric catalog ID 20431",
      retryable: false,
    });
    expect(fetchMock.requests).toEqual([]);
  });

  test("diagnoses a confirmed bridge miss without sending the AniList id to the catalog", async () => {
    using fetchMock = mockAllMangaBridgeFetch("empty");
    const result = await resolveCatalogAllMangaEpisode();

    expect(result.status).toBe("exhausted");
    expect(result.failures[0]).toMatchObject({
      code: "unsupported-title",
      message: "AllManga title bridge found no provider-native show for AniList ID 20431",
      retryable: false,
    });
    expect(fetchMock.catalogRequests).toEqual([]);
  });

  test("diagnoses bridge transport failure before provider-native catalog lookup", async () => {
    using fetchMock = mockAllMangaBridgeFetch("transport-error");
    const result = await resolveCatalogAllMangaEpisode();

    expect(result.status).toBe("exhausted");
    expect(result.failures[0]).toMatchObject({
      code: "network-error",
      message: "AllManga title bridge could not check AniList ID 20431",
      retryable: true,
    });
    expect(fetchMock.catalogRequests).toEqual([]);
  });

  test("bridges catalog anilist ids to opaque show ids via search", async () => {
    clearAllMangaAnilistBridgeCacheForTest();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, _init) => {
      const url = String(input);
      if (url.includes("graphql.anilist.co")) {
        return jsonResponse({
          data: {
            Media: {
              title: {
                romaji: "Hoozuki no Reitetsu",
                english: "Hozuki's Coolheadedness",
              },
            },
          },
        });
      }
      return jsonResponse({
        data: {
          shows: {
            edges: [
              {
                _id: "bxCKTnota29uSRnZw",
                name: "Hoozuki no Reitetsu",
                aniListId: 20431,
                availableEpisodes: { sub: 13, dub: 0 },
              },
            ],
          },
        },
      });
    }) as typeof fetch;

    try {
      const showId = await resolveAllMangaShowId(
        {
          title: {
            id: "20431",
            kind: "anime",
            title: "Hozuki's Coolheadedness",
            anilistId: "20431",
            externalIds: { anilistId: "20431" },
          },
          preferredAudioLanguage: "original",
        },
        TEST_CONTEXT,
      );

      expect(showId).toBe("bxCKTnota29uSRnZw");
      const cached = await resolveAllMangaShowId(
        {
          title: {
            id: "20431",
            kind: "anime",
            title: "Hozuki's Coolheadedness",
            anilistId: "20431",
            externalIds: { anilistId: "20431" },
          },
          preferredAudioLanguage: "original",
        },
        TEST_CONTEXT,
      );
      expect(cached).toBe("bxCKTnota29uSRnZw");
    } finally {
      globalThis.fetch = originalFetch;
      clearAllMangaAnilistBridgeCacheForTest();
    }
  });

  test("detects catalog ids masquerading as show ids", () => {
    expect(looksLikeAllMangaOpaqueShowId("bxCKTnota29uSRnZw")).toBe(true);
    expect(looksLikeAllMangaOpaqueShowId("20431")).toBe(false);
    expect(isCatalogIdPassedAsShowId("20431", "20431")).toBe(true);
  });

  test("reads durable bridge cache via titleBridge port after in-process cache clear", async () => {
    clearAllMangaAnilistBridgeCacheForTest();
    const durable = new Map<string, string>();
    durable.set("allanime:anime:20431", "bxCKTdurable");
    const context: ProviderRuntimeContext = {
      ...TEST_CONTEXT,
      titleBridge: {
        get: ({ providerId, catalogKind, catalogId }) =>
          durable.get(`${providerId}:${catalogKind}:${catalogId}`),
        set: ({ providerId, catalogKind, catalogId, nativeId }) => {
          durable.set(`${providerId}:${catalogKind}:${catalogId}`, nativeId);
        },
      } satisfies ProviderTitleBridgePort,
    };

    const showId = await resolveAllMangaShowId(
      {
        title: {
          id: "20431",
          kind: "anime",
          title: "Hozuki",
          externalIds: { anilistId: "20431" },
        },
        preferredAudioLanguage: "original",
      },
      context,
    );

    expect(showId).toBe("bxCKTdurable");
  });
});

describe("decodeTobeparsed", () => {
  test("decodes the current versioned allmanga blob layout", async () => {
    const plain =
      '{"sourceUrl":"--68656c6c6f","sourceName":"Default"}' +
      '{"sourceUrl":"--776f726c64","sourceName":"Yt-mp4"}';
    const blob = buildBlob(plain);

    await expect(decodeTobeparsed(blob)).resolves.toEqual([
      { sourceUrl: "--68656c6c6f", sourceName: "Default" },
      { sourceUrl: "--776f726c64", sourceName: "Yt-mp4" },
    ]);
  });

  test("decrypts AES-256-GCM blobs with the request key and rejects wrong keys", async () => {
    const blob = buildBlob('{"sourceUrl":"--68656c6c6f","sourceName":"Default"}');

    await expect(decryptTobeparsedPlaintext(blob, TEST_KEY_HEX)).resolves.toContain("sourceUrl");
    await expect(decryptTobeparsedPlaintext(blob, "00".repeat(32))).resolves.toBeNull();
    await expect(decryptTobeparsedPlaintext("not-a-blob", TEST_KEY_HEX)).resolves.toBeNull();
  });
});

describe("buildAllMangaAaReq", () => {
  test("builds a versioned AES-GCM attestation blob with buildId + content lane", () => {
    const aaReq = buildAllMangaAaReq(1_700_000_000_000);
    const raw = Buffer.from(aaReq, "base64");
    expect(raw[0]).toBe(1);
    expect(raw.length).toBeGreaterThan(1 + 12 + 16);
    // Key must be 32 raw bytes (not SHA-256 of a passphrase).
    expect(Buffer.from(ALLMANGA_KEY_HEX, "hex").length).toBe(32);

    const ts = Math.floor(1_700_000_000_000 / 300_000) * 300_000;
    const buildId = BUNDLED_ALLMANGA_CRYPTO.buildId;
    const lane = BUNDLED_ALLMANGA_CRYPTO.contentLane;
    const iv = createHash("sha256")
      .update(
        `${BUNDLED_ALLMANGA_CRYPTO.epoch}:${buildId}:${BUNDLED_ALLMANGA_CRYPTO.queryHash}:${ts}:${lane}`,
      )
      .digest()
      .subarray(0, 12);
    expect(raw.subarray(1, 13).equals(iv)).toBe(true);

    const rest = raw.subarray(13);
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(ALLMANGA_KEY_HEX, "hex"), iv);
    decipher.setAuthTag(rest.subarray(rest.length - 16));
    const payload = JSON.parse(
      Buffer.concat([
        decipher.update(rest.subarray(0, rest.length - 16)),
        decipher.final(),
      ]).toString("utf8"),
    ) as Record<string, unknown>;
    expect(payload).toEqual({
      v: 1,
      ts,
      epoch: BUNDLED_ALLMANGA_CRYPTO.epoch,
      buildId,
      qh: BUNDLED_ALLMANGA_CRYPTO.queryHash,
      k: lane,
    });
  });
});

describe("AllManga crypto material (mkissa bootstrap)", () => {
  const partBBytes = Array.from({ length: 32 }, (_, index) => index + 1);
  const PART_B = Buffer.from(partBBytes).toString("base64");
  const EXPECTED_KEY_HEX = "532fbba462deed2b68657d7c758b7bcd6978e4ebeac46cd4e3f6d4c24ab863c7";
  const PLAIN_SOURCE_JSON = JSON.stringify({
    data: {
      episode: {
        episodeString: "1",
        sourceUrls: [
          {
            sourceUrl: "--https://cdn.allmanga.example/sub/1080/video.mp4?token=x",
            sourceName: "Default",
          },
        ],
      },
    },
  });

  function mockCryptoSiteFetch(options: {
    readonly apiResponses: readonly string[];
    readonly bootstrapStatus?: number;
  }) {
    clearAllMangaProviderCachesForTest();
    const originalFetch = globalThis.fetch;
    let apiCallCount = 0;
    let bootstrapFetchCount = 0;
    let bootstrapHeaders: Headers | undefined;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.includes("/client-crypto/v1/bootstrap")) {
        bootstrapFetchCount += 1;
        bootstrapHeaders = new Headers(init?.headers);
        if (options.bootstrapStatus && options.bootstrapStatus !== 200) {
          return new Response(JSON.stringify({ error: "nope" }), {
            status: options.bootstrapStatus,
          });
        }
        return new Response(
          JSON.stringify({
            epoch: 6900,
            partB: PART_B,
            k: "k7",
            switchAt: Date.now() + 86_400_000,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("variables=")) {
        const body =
          options.apiResponses[Math.min(apiCallCount, options.apiResponses.length - 1)] ?? "{}";
        apiCallCount += 1;
        return new Response(body, { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    return {
      get apiCallCount() {
        return apiCallCount;
      },
      get bootstrapFetchCount() {
        return bootstrapFetchCount;
      },
      get bootstrapHeaders() {
        return bootstrapHeaders;
      },
      [Symbol.dispose]() {
        globalThis.fetch = originalFetch;
      },
    };
  }

  function resolveWithSiteSources() {
    return resolveEpisodeSources({
      context: TEST_CONTEXT,
      apiUrl: "https://api.mkissa.net/api",
      referer: "https://mkissa.to",
      ua: "ua",
      showId: "show-1",
      epStr: "1",
      mode: "sub",
    });
  }

  test("derives the key from bootstrap and caches it", async () => {
    using site = mockCryptoSiteFetch({ apiResponses: [PLAIN_SOURCE_JSON] });
    const epochContext: ProviderRuntimeContext = {
      ...TEST_CONTEXT,
      now: () => new Date(6900 * 604_800_000 + 2 * 86_400_000).toISOString(),
    };

    const material = await getAllMangaCryptoMaterial(epochContext, "ua");
    expect(material?.keyHex).toBe(EXPECTED_KEY_HEX);
    expect(material?.epoch).toBe(6900);
    expect(material?.queryHash).toBe(ALLMANGA_QUERY_HASH);
    expect(material?.buildId).toBe("140");
    expect(site.bootstrapHeaders?.get("x-build-id")).toBe("140");
    expect(site.bootstrapHeaders?.get("x-aa-boot")).toBe(
      "9589a0b5c93919e01039dc83eeced3966f2abda839f8302dc7087e7b3df5cd35",
    );
    expect(site.bootstrapHeaders?.get("origin")).toBe("https://mkissa.to");
    expect(site.bootstrapHeaders?.get("referer")).toBe("https://mkissa.to/");

    const again = await getAllMangaCryptoMaterial(epochContext, "ua");
    expect(again?.keyHex).toBe(EXPECTED_KEY_HEX);
    expect(site.bootstrapFetchCount).toBe(1);
  });

  test("matches independent build-140 derivation and boot-token vectors", () => {
    expect(hashBuildId("140").toString("hex")).toBe(
      "07041a152a2823383631cec4dfdcd2ede2e0fbf08e89869c9794aaa5bab8b348",
    );
    expect(deriveMaskKey("140").toString("hex")).toBe(
      "522db8a067d8ea23616f7670788574dd786af7ffffd27bccfaeccfde57a67ce7",
    );
    expect(deriveKeyFromPartB(PART_B, "140").toString("hex")).toBe(EXPECTED_KEY_HEX);
    expect(
      buildAllMangaBootToken({
        buildId: "140",
        epoch: 6900,
        keyGroup: "mkissa",
        refererHost: "mkissa.to",
        contentLane: "k7",
      }),
    ).toBe("9589a0b5c93919e01039dc83eeced3966f2abda839f8302dc7087e7b3df5cd35");
  });

  test("falls back to bundled material when bootstrap fails", async () => {
    using site = mockCryptoSiteFetch({
      apiResponses: [PLAIN_SOURCE_JSON],
      bootstrapStatus: 500,
    });

    const links = await resolveWithSiteSources();

    expect(links.length).toBeGreaterThan(0);
    expect(site.bootstrapFetchCount).toBeGreaterThan(0);
    expect(site.apiCallCount).toBe(1);
  });

  test("refreshes crypto material on AA_CRYPTO_STALE instead of retry-storming", async () => {
    using site = mockCryptoSiteFetch({
      apiResponses: ['{"errors":[{"message":"AA_CRYPTO_STALE"}]}', PLAIN_SOURCE_JSON],
    });
    const sleeps: number[] = [];
    setAllMangaRetrySleepForTest((ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    });

    try {
      const links = await resolveWithSiteSources();

      expect(links.length).toBeGreaterThan(0);
      expect(site.apiCallCount).toBe(2);
      // Initial derive + exactly one stale re-bootstrap.
      expect(site.bootstrapFetchCount).toBe(2);
      expect(sleeps).toEqual([400]);
    } finally {
      clearAllMangaProviderCachesForTest();
    }
  });

  /**
   * `NEED_CAPTCHA` is what a geo/bot-gated region actually gets back from the
   * episode-sources query while the episode *catalog* still resolves — the exact
   * "valid catalog, zero streams" shape. It used to fall through the retry loop
   * and return an empty list, so the user saw "No streams extracted" with no way
   * to know the request was gated rather than the episode empty.
   */
  test("surfaces NEED_CAPTCHA as a distinct, actionable failure", async () => {
    using site = mockCryptoSiteFetch({
      apiResponses: ['{"errors":[{"message":"NEED_CAPTCHA"}],"data":{"episode":null}}'],
    });

    let thrown: unknown;
    try {
      await resolveWithSiteSources();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AllMangaCaptchaError);
    expect((thrown as Error).message).toContain("captcha");
    // A captcha is not a crypto problem: it must not trigger re-bootstrapping,
    // and it must not burn the retry budget on identical requests.
    expect(site.apiCallCount).toBe(1);
    expect(site.bootstrapFetchCount).toBe(1);
  });

  test("does not mistake NEED_CAPTCHA for a stale key or a rate limit", async () => {
    using site = mockCryptoSiteFetch({
      apiResponses: ['{"errors":[{"message":"NEED_CAPTCHA"}]}', PLAIN_SOURCE_JSON],
    });
    const sleeps: number[] = [];
    setAllMangaRetrySleepForTest((ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    });

    try {
      await expect(resolveWithSiteSources()).rejects.toBeInstanceOf(AllMangaCaptchaError);
      expect(sleeps).toEqual([]);
      expect(site.apiCallCount).toBe(1);
    } finally {
      clearAllMangaProviderCachesForTest();
    }
  });

  test("backs off on API rate limiting instead of failing", async () => {
    using site = mockCryptoSiteFetch({
      apiResponses: [
        '{"errors":[{"message":"Too many requests, please try again in 3 seconds."}]}',
        PLAIN_SOURCE_JSON,
      ],
    });
    const sleeps: number[] = [];
    setAllMangaRetrySleepForTest((ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    });

    try {
      const links = await resolveWithSiteSources();

      expect(links.length).toBeGreaterThan(0);
      expect(site.apiCallCount).toBe(2);
      expect(sleeps).toEqual([3_200]);
    } finally {
      clearAllMangaProviderCachesForTest();
    }
  });
});

describe("buildStreamHeaders", () => {
  test("prefers the stream-specific referer when one is required", () => {
    expect(buildStreamHeaders("https://cdn.example/ref", "https://allmanga.to", "ua")).toEqual({
      Referer: "https://cdn.example/ref",
      "User-Agent": "ua",
    });
  });

  test("falls back to the provider referer when the stream has no override", () => {
    expect(buildStreamHeaders(undefined, "https://allmanga.to", "ua")).toEqual({
      Referer: "https://allmanga.to",
      "User-Agent": "ua",
    });
  });
});

describe("Mp4 / mp4upload source parity (ani-cli b8032b7+)", () => {
  test("scrapes the embed page and returns the video with mp4upload referer", async () => {
    clearAllMangaProviderCachesForTest();
    setAllMangaCryptoMaterialForTest(BUNDLED_ALLMANGA_CRYPTO);
    const originalFetch = globalThis.fetch;
    const embedUrl = "https://www.mp4upload.com/embed-abc123.html";
    const videoUrl = "https://www6.mp4upload.com:282/d/video/file.mp4";
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.includes("variables=")) {
        return new Response(
          JSON.stringify({
            data: {
              episode: {
                episodeString: "1",
                sourceUrls: [{ sourceUrl: embedUrl, sourceName: "Mp4" }],
              },
            },
          }),
          { status: 200 },
        );
      }
      if (url === embedUrl) {
        return new Response(
          `<html><script>player.src({ type: "video/mp4", src: "${videoUrl}" });</script></html>`,
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;

    try {
      const links = await resolveEpisodeSources({
        context: TEST_CONTEXT,
        apiUrl: "https://api.mkissa.net/api",
        referer: "https://mkissa.to",
        ua: "ua",
        showId: "show-mp4",
        epStr: "1",
        mode: "sub",
      });

      expect(links).toEqual([
        {
          url: videoUrl,
          quality: "Mp4",
          sourceName: "Mp4",
          referer: "https://www.mp4upload.com",
          protocol: "mp4",
          container: "mp4",
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      clearAllMangaProviderCachesForTest();
    }
  });
});

describe("resolveAnimeEpisodeString", () => {
  test("matches the exact episode number even when the upstream list is reverse ordered", () => {
    expect(
      resolveAnimeEpisodeString(["12", "11", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1"], 1),
    ).toBe("1");
    expect(
      resolveAnimeEpisodeString(
        ["12", "11", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1"],
        12,
      ),
    ).toBe("12");
  });

  test("falls back to positional lookup when an exact numeric match is unavailable", () => {
    expect(resolveAnimeEpisodeString(["special-a", "special-b"], 2)).toBe("special-b");
  });

  test("positional fallback follows catalog display order (sorted), not raw upstream order", () => {
    // The UI numbers episodes after `compareEpisodeStrings` sorting; resolving
    // against raw upstream order would pick a different entry for non-numeric
    // strings whenever upstream is not pre-sorted.
    expect(resolveAnimeEpisodeString(["SP2", "SP1", "OVA"], 1)).toBe("OVA");
    expect(resolveAnimeEpisodeString(["SP2", "SP1", "OVA"], 2)).toBe("SP1");
    expect(resolveAnimeEpisodeString(["SP2", "SP1", "OVA"], 3)).toBe("SP2");
  });
});

describe("extractRawSources", () => {
  test("parses a plain sourceUrls payload", async () => {
    const payload = JSON.stringify({
      data: {
        episode: {
          sourceUrls: [
            { sourceUrl: "--68656c6c6f", sourceName: "Default" },
            { sourceUrl: "https://embed.example/page", sourceName: "Mp4" },
            { sourceUrl: "javascript:void(0)", sourceName: "Junk" },
          ],
        },
      },
    });
    await expect(extractRawSources(payload)).resolves.toEqual([
      { sourceUrl: "--68656c6c6f", sourceName: "Default" },
      { sourceUrl: "https://embed.example/page", sourceName: "Mp4" },
    ]);
  });

  test("returns an empty lane for non-JSON bodies instead of throwing", async () => {
    await expect(extractRawSources("<html>Just a moment...</html>")).resolves.toEqual([]);
    await expect(extractRawSources("")).resolves.toEqual([]);
    await expect(extractRawSources('{"data": {"episode":')).resolves.toEqual([]);
  });

  /**
   * Guarding only `JSON.parse` covers the body shape this endpoint is least
   * likely to send. It is a GraphQL API: a rate limit or an auth failure comes
   * back as valid JSON with no `data` key, and `{"data":null}` is spec-legal.
   * Both used to reach `data.data.episode` and throw a TypeError one line past
   * the guard, on the one lane (`baseline`) that has no `.catch()` above it.
   */
  test("returns an empty lane for JSON that carries no episode payload", async () => {
    await expect(extractRawSources('{"errors":[{"message":"rate limited"}]}')).resolves.toEqual([]);
    await expect(extractRawSources('{"data":null}')).resolves.toEqual([]);
    await expect(extractRawSources('{"data":{}}')).resolves.toEqual([]);
    await expect(extractRawSources('{"data":{"episode":null}}')).resolves.toEqual([]);
    await expect(extractRawSources("null")).resolves.toEqual([]);
    await expect(extractRawSources("[]")).resolves.toEqual([]);
  });

  test("skips malformed source entries rather than throwing on a missing url", async () => {
    const payload = JSON.stringify({
      data: {
        episode: {
          sourceUrls: [
            { sourceName: "NoUrl" },
            { sourceUrl: "https://cdn.example/a.m3u8", sourceName: "Good" },
          ],
        },
      },
    });
    await expect(extractRawSources(payload)).resolves.toEqual([
      { sourceUrl: "https://cdn.example/a.m3u8", sourceName: "Good" },
    ]);
  });
});

describe("decryptTobeparsedWithEpochFallback", () => {
  const PLAIN = '{"sourceUrl":"--68656c6c6f","sourceName":"Default"}';
  const LIVE_KEY_HEX = "ab".repeat(32);

  test("decrypts with the live material key when it works", async () => {
    const blob = buildBlob(PLAIN, LIVE_KEY_HEX);
    await expect(decryptTobeparsedWithEpochFallback(blob, LIVE_KEY_HEX)).resolves.toBe(PLAIN);
  });

  test("falls back to the bundled key when the live epoch key fails (rollover grace)", async () => {
    const blob = buildBlob(PLAIN, ALLMANGA_KEY_HEX);
    await expect(decryptTobeparsedWithEpochFallback(blob, LIVE_KEY_HEX)).resolves.toBe(PLAIN);
  });

  test("returns null when neither key decrypts", async () => {
    const blob = buildBlob(PLAIN, "cd".repeat(32));
    await expect(decryptTobeparsedWithEpochFallback(blob, LIVE_KEY_HEX)).resolves.toBeNull();
    await expect(
      decryptTobeparsedWithEpochFallback("not-a-blob", LIVE_KEY_HEX),
    ).resolves.toBeNull();
  });
});

describe("AllManga HTTP helpers", () => {
  test("gqlPost composes caller cancellation with its request timeout", async () => {
    const originalFetch = globalThis.fetch;
    const parent = new AbortController();
    let capturedSignal: AbortSignal | undefined;
    globalThis.fetch = (async (_input, init) => {
      capturedSignal = init?.signal ?? undefined;
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    }) as typeof fetch;

    try {
      await gqlPost(
        TEST_CONTEXT,
        "https://api.example/graphql",
        "https://referer.example",
        "ua",
        "query { ok }",
        {},
        parent.signal,
      );
      expect(capturedSignal).toBeDefined();
      expect(capturedSignal).not.toBe(parent.signal);
      expect(capturedSignal?.aborted).toBe(false);
      parent.abort("test-cancel");
      expect(capturedSignal?.aborted).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("search and episode catalog helpers pass caller cancellation into fetches", async () => {
    const originalFetch = globalThis.fetch;
    const parent = new AbortController();
    const capturedSignals: AbortSignal[] = [];
    globalThis.fetch = (async (_input, init) => {
      if (init?.signal) capturedSignals.push(init.signal);
      return new Response(
        JSON.stringify({
          data: {
            shows: { edges: [] },
            show: {
              _id: "show-1",
              availableEpisodesDetail: { sub: ["1"], dub: [] },
              availableEpisodes: { sub: 1, dub: 0 },
              episodeCount: 1,
            },
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    try {
      await searchAllManga(
        TEST_CONTEXT,
        "https://api.example/graphql",
        "https://referer.example",
        "ua",
        "Example",
        "sub",
        parent.signal,
      );
      await fetchAllMangaEpisodeCatalog({
        context: TEST_CONTEXT,
        apiUrl: "https://api.example/graphql",
        referer: "https://referer.example",
        ua: "ua",
        showId: "show-1",
        mode: "sub",
        signal: parent.signal,
      });

      expect(capturedSignals.length).toBeGreaterThanOrEqual(2);
      expect(capturedSignals.every((signal) => signal !== parent.signal)).toBe(true);
      parent.abort("test-cancel");
      expect(capturedSignals.every((signal) => signal.aborted)).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("AllManga provider evidence fixtures", () => {
  test("starts crypto bootstrap while the cold episode catalog is still pending", async () => {
    let releaseCatalog: () => void = () => undefined;
    const catalogGate = new Promise<void>((resolve) => {
      releaseCatalog = resolve;
    });
    using fetchMock = await mockAllMangaFetch({ liveCrypto: true, catalogGate });

    const resolvePromise = resolveEvidenceEpisode();
    for (
      let attempt = 0;
      attempt < 50 && !fetchMock.startedRequests.includes("catalog");
      attempt++
    ) {
      await Bun.sleep(1);
    }
    await Bun.sleep(20);
    const overlapped = fetchMock.startedRequests.includes("bootstrap");
    releaseCatalog();
    const result = await resolvePromise;

    expect(result.status).toBe("resolved");
    expect(overlapped).toBe(true);
    const preparationEvent = result.trace.events?.find(
      (event) => event.sourceId === "source:allanime:cold-preparation",
    );
    expect(preparationEvent?.type).toBe("source:success");
    expect(preparationEvent?.durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(preparationEvent)).not.toMatch(
      /partB|aaReq|x-aa-boot|token|https?:\/\//i,
    );
  });

  test("search result preserves provider-native ids artwork and language evidence", async () => {
    using fetchMock = await mockAllMangaFetch();

    const results = await allmangaProviderModule.search?.(
      { query: "Evidence Fox", preferredAudioLanguage: "ja" },
      { now: nowFixture, signal: new AbortController().signal },
    );
    const expected = await readFixture<ExpectedAllMangaContract>("expected-normalized.json");

    expect(results?.[0]).toMatchObject({
      id: expected.search.id,
      externalIds: expected.search.externalIds,
      artwork: {
        posterUrl: expected.search.artwork.posterUrl,
        backdropUrl: expected.search.artwork.backdropUrl,
      },
      availableAudioModes: expected.search.languageModes,
    });
    expect(results?.[0]?.languageEvidence?.map((evidence) => evidence.nativeLabel)).toContain(
      "sub",
    );
    expect(results?.[0]?.languageEvidence?.map((evidence) => evidence.normalizedLanguage)).toEqual(
      expect.arrayContaining(["ja", "en"]),
    );
    expect(fetchMock.calls.some((url) => url.includes("query="))).toBe(false);
  });

  test("episode catalog carries native ids and artwork without live calls", async () => {
    await using _fetchMock = await mockAllMangaFetch();

    const episodes = await allmangaProviderModule.listEpisodes?.(
      {
        title: {
          id: "allanime:show-allmanga-evidence",
          kind: "anime",
          title: "Evidence Fox",
        },
        preferredAudioLanguage: "ja",
      },
      { now: nowFixture, signal: new AbortController().signal },
    );
    const expected = await readFixture<ExpectedAllMangaContract>("expected-normalized.json");

    expect(episodes?.[0]).toMatchObject({
      index: 1,
      label: "Episode 1",
      externalIds: expected.episode.externalIds,
      artwork: {
        thumbnailUrl: expected.episode.thumbnailUrl,
      },
    });
  });

  test("sub and dub source inventory remains distinct and ISO-normalized", async () => {
    await using _fetchMock = await mockAllMangaFetch();
    const expected = await readFixture<ExpectedAllMangaContract>("expected-normalized.json");

    const sub = await resolveEvidenceEpisode({
      title: {
        id: "allanime:show-allmanga-evidence",
        kind: "anime",
        title: "Evidence Fox",
        externalIds: expected.search.externalIds,
      },
      preferredAudioLanguage: "ja",
    });
    const dub = await resolveEvidenceEpisode({
      title: {
        id: "allanime:show-allmanga-evidence",
        kind: "anime",
        title: "Evidence Fox",
        externalIds: expected.search.externalIds,
      },
      preferredAudioLanguage: "en",
    });

    expect(sub.status).toBe("resolved");
    expect(dub.status).toBe("resolved");
    expect(sub.streams[0]).toMatchObject({
      audioLanguages: [expected.subResolve.audioLanguage],
      hardSubLanguage: expected.subResolve.hardSubLanguage,
      presentation: expected.subResolve.presentation,
    });
    expect(dub.streams[0]).toMatchObject({
      audioLanguages: [expected.dubResolve.audioLanguage],
      presentation: expected.dubResolve.presentation,
    });
    expect(sub.streams[0]?.languageEvidence?.[0]).toMatchObject({
      nativeLabel: expected.subResolve.nativeLabel,
      normalizedLanguage: expected.subResolve.audioLanguage,
    });
    expect(dub.streams[0]?.languageEvidence?.[0]).toMatchObject({
      nativeLabel: expected.dubResolve.nativeLabel,
      normalizedLanguage: expected.dubResolve.audioLanguage,
    });
    expect(sub.sources?.[0]?.metadata?.sourceFamily).toBe("default");
    expect(sub.sources?.[0]).toMatchObject({
      // Shared anime presentation: Sub/Dub · Server · subtitle mode
      label: expect.stringMatching(/^Sub · Default · (hard sub|soft sub)$/),
      host: expect.any(String),
      metadata: expect.objectContaining({
        qualityLabels: expect.any(String),
        flavorLabel: expect.stringMatching(/^Sub · Default · /),
        audioCategory: "sub",
      }),
    });
    expect(sub.sources?.[0]?.languageEvidence?.[0]).toMatchObject({
      normalizedLanguage: expected.subResolve.audioLanguage,
    });
    expect(sub.sources?.[0]?.sourceEvidence?.[0]).toMatchObject({
      nativeLabel: "Default",
    });
    expect(dub.sources?.[0]?.label).toMatch(/^Dub · Default · /);
    expect(dub.streams[0]?.url).toContain("/dub/");
    expect(sub.externalIds).toEqual(expected.search.externalIds);
    expect(dub.externalIds).toEqual(expected.search.externalIds);
    expect(sub.trace.events?.some((event) => event.type === "source:start")).toBe(true);
    expect(sub.trace.events?.some((event) => event.type === "variant:selected")).toBe(true);
    const audioModesEvent = sub.trace.events?.find(
      (event) => event.type === "inventory:audio-modes",
    );
    expect(audioModesEvent?.attributes?.modes).toBe("sub,dub");
  });

  test("normal playback does not request Ak when a baseline stream is playable", async () => {
    using fetchMock = await mockAllMangaFetch({
      subSourceFixture: "sub-source-response",
      akDelayMs: 100,
    });

    const result = await resolveEvidenceEpisode({ intent: "play" });

    expect(result.status).toBe("resolved");
    expect(result.streams[0]?.protocol).toBe("hls");
    expect(fetchMock.calls.some((url) => url.includes("/ak-source"))).toBe(false);
    const sourcePreparationEvent = result.trace.events?.find(
      (event) => event.sourceId === "source:allanime:source-preparation",
    );
    expect(sourcePreparationEvent).toMatchObject({
      type: "source:success",
      attributes: { linkCount: 2, requiredAkFallback: false },
    });
    expect(sourcePreparationEvent?.durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(sourcePreparationEvent)).not.toMatch(/token|https?:\/\//i);
  });

  test("baseline extraction aborts a slow optional adapter after its wait budget", async () => {
    using fetchMock = await mockAllMangaFetch({
      subSourceFixture: "fast-and-slow-baseline",
      fastBaselineDelayMs: 10,
      slowBaselineDelayMs: 100,
    });

    const startedAt = performance.now();
    const links = await resolveEpisodeSources({
      context: TEST_CONTEXT,
      apiUrl: "https://api.allanime.day/api",
      referer: "https://youtu-chan.com",
      ua: "ua",
      showId: "show-allmanga-evidence",
      epStr: "1",
      mode: "sub",
      sourceLane: "baseline",
      adapterWaitBudgetMs: 20,
      signal: new AbortController().signal,
    } as Parameters<typeof resolveEpisodeSources>[0]);

    const hosts = links.map((link) => new URL(link.url).hostname);
    expect(hosts).toContain("video.wixstatic.com");
    expect(hosts).toContain("direct.example");
    expect(performance.now() - startedAt).toBeLessThan(80);
    expect(fetchMock.abortedBaselineRequests).toBe(1);
  });

  test("quality-first startup includes prompt Ak response", async () => {
    using fetchMock = await mockAllMangaFetch({
      subSourceFixture: "baseline-ak",
    });

    const result = await resolveEvidenceEpisode({ startupPriority: "quality-first" });

    expect(result.status).toBe("resolved");
    expect(result.streams.some((stream) => stream.sourceId === "source:allanime:ak")).toBe(true);
    expect(result.selectionDecision?.startupPriority).toBe("quality-first");
    expect(result.selectionDecision?.reason).toBe("quality-first");
    expect(fetchMock.calls.filter((url) => url.includes("/ak-source"))).toHaveLength(1);
  });

  test("quality-first startup returns baseline when optional Ak exceeds the bounded wait", async () => {
    using fetchMock = await mockAllMangaFetch({
      subSourceFixture: "baseline-ak",
      akDelayMs: 100,
    });

    const result = await collectEvidenceLinksForStartup(
      { startupPriority: "quality-first" },
      { qualityFirstWaitMs: 5 },
    );

    expect(result.requiredAkFallback).toBe(false);
    expect(result.links.some((link) => link.deferredLocator?.startsWith("allmanga-ak:"))).toBe(
      false,
    );
    expect(fetchMock.calls.filter((url) => url.includes("/ak-source"))).toHaveLength(1);
  });

  test("quality-first startup aborts optional Ak after the bounded wait", async () => {
    using fetchMock = await mockAllMangaFetch({
      subSourceFixture: "baseline-ak",
      akDelayMs: 100,
    });

    const result = await collectEvidenceLinksForStartup(
      { startupPriority: "quality-first" },
      { qualityFirstWaitMs: 5 },
    );

    expect(result.requiredAkFallback).toBe(false);
    expect(fetchMock.abortedAkRequests).toBe(1);
  });

  test("result cache policy includes startup priority in key parts", async () => {
    await using _fetchMock = await mockAllMangaFetch();

    const fast = await resolveEvidenceEpisode({ startupPriority: "fast" });
    const qualityFirst = await resolveEvidenceEpisode({ startupPriority: "quality-first" });

    expect(fast.status).toBe("resolved");
    expect(qualityFirst.status).toBe("resolved");
    expect(fast.cachePolicy?.keyParts).toContain("fast");
    expect(qualityFirst.cachePolicy?.keyParts).toContain("quality-first");
    expect(fast.cachePolicy?.keyParts).not.toEqual(qualityFirst.cachePolicy?.keyParts);
  });

  test("normal playback requests Ak as required fallback when baseline is empty", async () => {
    using fetchMock = await mockAllMangaFetch({ subSourceFixture: "ak-episode-response" });

    const result = await resolveEvidenceEpisode({ intent: "play" });

    expect(result.status).toBe("resolved");
    expect(result.streams[0]?.deferredLocator).toStartWith("allmanga-ak:");
    expect(fetchMock.calls.filter((url) => url.includes("/ak-source"))).toHaveLength(1);
  });

  test("normal playback requests Ak when baseline sources are not selectable", async () => {
    using fetchMock = await mockAllMangaFetch({
      subSourceFixture: "mixed-unselectable-baseline-ak",
    });

    const result = await resolveEvidenceEpisode({ intent: "play" });

    expect(result.status).toBe("resolved");
    expect(result.streams[0]?.deferredLocator).toStartWith("allmanga-ak:");
    expect(fetchMock.calls.filter((url) => url.includes("/broken-source"))).toHaveLength(1);
    expect(fetchMock.calls.filter((url) => url.includes("/ak-source"))).toHaveLength(1);
  });

  test("selection stays tied to the provider-cycle validated stream", async () => {
    await using _fetchMock = await mockAllMangaFetch({
      subSourceFixture: "cycle-hls-720-mp4-1080",
    });

    const result = await resolveEvidenceEpisode({ intent: "play", startupPriority: "balanced" });
    const selectedStream = result.streams.find((stream) => stream.id === result.selectedStreamId);

    expect(result.status).toBe("resolved");
    expect(result.streams.map((stream) => [stream.protocol, stream.qualityRank])).toEqual([
      ["mp4", 1080],
      ["hls", 720],
    ]);
    expect(selectedStream).toMatchObject({
      protocol: "hls",
      qualityRank: 720,
    });
    expect(result.selectionDecision?.selectedQualityRank).toBe(720);
  });

  test("quality-first baseline-empty required Ak is not bounded by the optional wait", async () => {
    using fetchMock = await mockAllMangaFetch({
      subSourceFixture: "ak-episode-response",
      akDelayMs: 25,
    });

    const result = await collectEvidenceLinksForStartup(
      { startupPriority: "quality-first" },
      { qualityFirstWaitMs: 1 },
    );

    expect(result.requiredAkFallback).toBe(true);
    expect(result.links.some((link) => link.deferredLocator?.startsWith("allmanga-ak:"))).toBe(
      true,
    );
    expect(fetchMock.abortedAkRequests).toBe(0);
  });

  test("explicit Ak source selection skips baseline and requests Ak once", async () => {
    using fetchMock = await mockAllMangaFetch({
      subSourceFixture: "mixed-unselectable-baseline-ak",
    });

    const result = await resolveEvidenceEpisode({
      intent: "play",
      preferredSourceId: "source:allanime:ak",
    });

    expect(result.status).toBe("resolved");
    expect(result.streams[0]?.sourceId).toBe("source:allanime:ak");
    expect(result.streams[0]?.deferredLocator).toStartWith("allmanga-ak:");
    expect(fetchMock.calls.some((url) => url.includes("/broken-source"))).toBe(false);
    expect(fetchMock.calls.filter((url) => url.includes("/ak-source"))).toHaveLength(1);
  });

  test("Ak DASH source resolves as an opaque deferred stream with subtitles", async () => {
    await using _fetchMock = await mockAllMangaFetch({ subSourceFixture: "ak-episode-response" });

    const result = await resolveEvidenceEpisode({ intent: "play" });

    expect(result.status).toBe("resolved");
    expect(result.streams[0]).toMatchObject({
      protocol: "dash",
      container: "mpd",
      presentation: "sub",
      qualityLabel: "1080p",
      audioLanguages: ["ja"],
    });
    expect(result.streams[0]?.url).toBeUndefined();
    expect(result.streams[0]?.deferredLocator).toStartWith("allmanga-ak:");
    expect(result.streams[0]?.deferredLocator).not.toContain("redacted-video");
    expect(result.subtitles[0]).toMatchObject({
      language: "en",
      format: "ass",
      source: "embedded",
    });

    const descriptor = resolveAllMangaAkDeferredLocator(result.streams[0]?.deferredLocator ?? "");
    expect(descriptor?.video.url).toContain("redacted-video-1080");
    expect(descriptor?.audio.url).toContain("redacted-audio");
    expect(descriptor?.duration).toBe(1440);
  });

  test("source cycle candidates preserve native labels separately from normalized language", () => {
    const candidates = buildAllmangaCycleCandidates(
      [
        {
          id: "stream:allmanga:hls",
          providerId: "allanime",
          sourceId: "source:allanime:fm-hls",
          variantId: "variant:allanime:fm-hls:1080",
          url: "https://cdn.example/sub/1080.m3u8",
          protocol: "hls",
          container: "m3u8",
          audioLanguages: ["ja"],
          hardSubLanguage: "en",
          presentation: "sub",
          qualityLabel: "1080p",
          qualityRank: 1080,
          cachePolicy: {
            ttlClass: "stream-manifest",
            scope: "local",
            keyParts: ["provider", "allmanga", "cycle-candidate"],
          },
          sourceEvidence: [
            {
              sourceId: "source:allanime:fm-hls",
              nativeLabel: "FM-HLS",
              host: "cdn.example",
              confidence: 0.95,
            },
          ],
          confidence: 0.95,
        },
      ],
      "1080",
    );

    expect(candidates[0]).toMatchObject({
      sourceId: "source:allanime:fm-hls",
      streamId: "stream:allmanga:hls",
      nativeLabel: "FM-HLS",
      normalizedAudioLanguage: "ja",
      normalizedSubtitleLanguage: "en",
      presentation: "sub",
    });
  });

  test("source cycle candidates prioritize exact selected stream hints", () => {
    const streams = [
      {
        id: "stream:allmanga:default-1080",
        providerId: "allanime",
        sourceId: "source:allanime:fm-hls",
        variantId: "variant:allanime:fm-hls:1080",
        url: "https://cdn.example/default/1080.m3u8",
        protocol: "hls",
        container: "m3u8",
        qualityLabel: "1080p",
        qualityRank: 1080,
        confidence: 0.95,
        cachePolicy: {
          ttlClass: "stream-manifest",
          scope: "local",
          keyParts: ["provider", "allmanga", "cycle-candidate"],
        },
      },
      {
        id: "stream:allmanga:selected-720",
        providerId: "allanime",
        sourceId: "source:allanime:vid-mp4",
        variantId: "variant:allanime:vid-mp4:720",
        url: "https://cdn.example/selected/720.mp4",
        protocol: "mp4",
        container: "mp4",
        qualityLabel: "720p",
        qualityRank: 720,
        confidence: 0.85,
        cachePolicy: {
          ttlClass: "stream-manifest",
          scope: "local",
          keyParts: ["provider", "allmanga", "cycle-candidate"],
        },
      },
    ] as const;

    const candidates = buildAllmangaCycleCandidates(streams, undefined, {
      preferredSourceId: "source:allanime:vid-mp4",
      preferredStreamId: "stream:allmanga:selected-720",
    });

    expect([...candidates].sort((left, right) => left.priority - right.priority)[0]?.streamId).toBe(
      "stream:allmanga:selected-720",
    );
  });
});

/** Build a tobeparsed blob with the live layout: base64(0x01 || iv12 || ct || gcmTag16). */
function buildBlob(plain: string, keyHex: string = TEST_KEY_HEX): string {
  const iv = Buffer.from(Array.from({ length: 12 }, (_, index) => index + 1));
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), iv, ciphertext, cipher.getAuthTag()]).toString("base64");
}

type ExpectedAllMangaContract = {
  readonly search: {
    readonly id: string;
    readonly externalIds: { readonly anilistId: string; readonly malId: string };
    readonly artwork: { readonly posterUrl: string; readonly backdropUrl: string };
    readonly languageModes: readonly ("sub" | "dub")[];
  };
  readonly episode: {
    readonly externalIds: { readonly anilistId: string; readonly malId: string };
    readonly thumbnailUrl: string;
  };
  readonly subResolve: {
    readonly audioLanguage: string;
    readonly hardSubLanguage: string;
    readonly presentation: string;
    readonly nativeLabel: string;
  };
  readonly dubResolve: {
    readonly audioLanguage: string;
    readonly presentation: string;
    readonly nativeLabel: string;
  };
};

type ResolveEvidenceEpisodeOverrides = Partial<ProviderResolveInput> & {
  readonly title?: Partial<ProviderResolveInput["title"]>;
};

async function collectEvidenceLinksForStartup(
  overrides: ResolveEvidenceEpisodeOverrides = {},
  options: { readonly qualityFirstWaitMs?: number } = {},
) {
  return collectAllMangaLinksForStartup(
    {
      episode: { episode: 1 },
      mediaKind: "anime",
      preferredAudioLanguage: "ja",
      intent: "play",
      allowedRuntimes: ["direct-http"],
      ...overrides,
      title: {
        id: "allanime:show-allmanga-evidence",
        kind: "anime",
        title: "Evidence Fox",
        ...overrides.title,
      },
    },
    {
      context: TEST_CONTEXT,
      apiUrl: "https://api.allanime.day/api",
      referer: "https://youtu-chan.com",
      ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
      showId: "show-allmanga-evidence",
      epStr: "1",
      mode: "sub",
      signal: new AbortController().signal,
    },
    options,
  );
}

async function resolveEvidenceEpisode(
  overrides: ResolveEvidenceEpisodeOverrides = {},
): Promise<ProviderResolveResult> {
  const title = {
    id: "allanime:show-allmanga-evidence",
    kind: "anime" as const,
    title: "Evidence Fox",
    ...overrides.title,
  };
  return allmangaProviderModule.resolve(
    {
      episode: { episode: 1 },
      mediaKind: "anime",
      preferredAudioLanguage: "ja",
      intent: "play",
      allowedRuntimes: ["direct-http"],
      ...overrides,
      title,
    },
    { now: nowFixture, signal: new AbortController().signal },
  );
}

async function resolveCatalogAllMangaEpisode(): Promise<ProviderResolveResult> {
  return allmangaProviderModule.resolve(
    {
      episode: { episode: 1 },
      mediaKind: "anime",
      preferredAudioLanguage: "ja",
      intent: "play",
      allowedRuntimes: ["direct-http"],
      title: {
        id: "20431",
        kind: "anime",
        title: "Hozuki's Coolheadedness",
        anilistId: "20431",
        externalIds: { anilistId: "20431" },
      },
    },
    TEST_CONTEXT,
  );
}

function mockAllMangaBridgeFetch(
  outcome: "empty" | "transport-error" | "unexpected",
): Disposable & {
  readonly requests: readonly string[];
  readonly catalogRequests: readonly string[];
} {
  clearAllMangaAnilistBridgeCacheForTest();
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const catalogRequests: string[] = [];
  // SAFETY: This deterministic test stub implements the fetch call shape exercised here.
  globalThis.fetch = (async (request, init) => {
    const url = String(request);
    requests.push(url);
    if (outcome === "unexpected") {
      return new Response("unexpected request", { status: 500 });
    }
    if (url.includes("graphql.anilist.co")) {
      return jsonResponse({
        data: {
          Media: {
            title: { romaji: "Hoozuki no Reitetsu" },
          },
        },
      });
    }

    const body = String(init?.body ?? "");
    if (body.includes("show(_id:$id)")) catalogRequests.push(body);
    return outcome === "transport-error"
      ? new Response("upstream unavailable", { status: 503 })
      : jsonResponse({ data: { shows: { edges: [] } } });
  }) as typeof fetch;

  return {
    requests,
    catalogRequests,
    [Symbol.dispose]() {
      globalThis.fetch = originalFetch;
      clearAllMangaAnilistBridgeCacheForTest();
    },
  };
}

async function mockAllMangaFetch(
  options: {
    readonly subSourceFixture?:
      | "sub-source-response"
      | "ak-episode-response"
      | "mixed-unselectable-baseline-ak"
      | "baseline-ak"
      | "fast-and-slow-baseline"
      | "cycle-hls-720-mp4-1080";
    readonly akDelayMs?: number;
    readonly fastBaselineDelayMs?: number;
    readonly slowBaselineDelayMs?: number;
    readonly liveCrypto?: boolean;
    readonly catalogGate?: Promise<void>;
  } = {},
): Promise<
  Disposable & {
    readonly calls: readonly string[];
    readonly startedRequests: readonly string[];
    readonly abortedAkRequests: number;
    readonly abortedBaselineRequests: number;
  }
> {
  clearAllMangaProviderCachesForTest();
  // Keep resolve paths off the live mkissa.to key scrape; fixtures return plain
  // sourceUrls JSON so the key itself is never exercised here.
  if (!options.liveCrypto) setAllMangaCryptoMaterialForTest(BUNDLED_ALLMANGA_CRYPTO);
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const startedRequests: string[] = [];
  let abortedAkRequests = 0;
  let abortedBaselineRequests = 0;
  const subFixture =
    options.subSourceFixture === "mixed-unselectable-baseline-ak" ||
    options.subSourceFixture === "baseline-ak" ||
    options.subSourceFixture === "cycle-hls-720-mp4-1080" ||
    options.subSourceFixture === "fast-and-slow-baseline"
      ? {
          data: {
            episode: {
              episodeString: "1",
              sourceUrls:
                options.subSourceFixture === "cycle-hls-720-mp4-1080"
                  ? [
                      {
                        sourceName: "1080p",
                        sourceUrl: "--https://cdn.allmanga.example/sub/1080/video.mp4?token=x",
                      },
                      {
                        sourceName: "720p",
                        sourceUrl: "--https://cdn.allmanga.example/sub/720/master.m3u8",
                      },
                    ]
                  : options.subSourceFixture === "fast-and-slow-baseline"
                    ? [
                        {
                          sourceName: "Yt-mp4",
                          sourceUrl: "--https://direct.example/video.mp4",
                        },
                        { sourceName: "Default", sourceUrl: "--/baseline-fast" },
                        { sourceName: "Luf-Mp4", sourceUrl: "--/baseline-slow" },
                      ]
                    : [
                        {
                          sourceName: "Default",
                          sourceUrl:
                            options.subSourceFixture === "baseline-ak"
                              ? "--https://cdn.allmanga.example/sub//1080/master.m3u8"
                              : "--/broken-source",
                        },
                        {
                          sourceName: "Ak",
                          sourceUrl: "--/ak-source",
                        },
                      ],
            },
          },
        }
      : await readFixture<unknown>(`${options.subSourceFixture ?? "sub-source-response"}.json`);
  const fixtures = {
    search: await readFixture<unknown>("search-response.json"),
    catalog: await readFixture<unknown>("catalog-response.json"),
    sub: subFixture,
    dub: await readFixture<unknown>("dub-source-response.json"),
    ak: await readFixture<unknown>("ak-source-response.json"),
  };

  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/client-crypto/v1/bootstrap")) {
      startedRequests.push("bootstrap");
      return jsonResponse({
        epoch: 6900,
        partB: "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=",
        k: "k7",
      });
    }
    if (url.includes("/ak-source")) {
      if (init?.signal?.aborted) {
        abortedAkRequests += 1;
        throw init.signal.reason ?? new DOMException("Aborted", "AbortError");
      }
      init?.signal?.addEventListener(
        "abort",
        () => {
          abortedAkRequests += 1;
        },
        { once: true },
      );
      if (options.akDelayMs) {
        await Bun.sleep(options.akDelayMs);
        if (init?.signal?.aborted) {
          throw init.signal.reason ?? new DOMException("Aborted", "AbortError");
        }
      }
      return jsonResponse(fixtures.ak);
    }
    if (url.includes("/broken-source")) {
      return jsonResponse({ links: [{ link: "", resolutionStr: "1080p" }] });
    }
    if (url.includes("/baseline-fast")) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          abortedBaselineRequests += 1;
          reject(init?.signal?.reason ?? new DOMException("Aborted", "AbortError"));
        };
        const timer = setTimeout(() => {
          init?.signal?.removeEventListener("abort", onAbort);
          resolve();
        }, options.fastBaselineDelayMs ?? 0);
        init?.signal?.addEventListener("abort", onAbort, { once: true });
      });
      return jsonResponse({
        links: [{ link: "https://video.wixstatic.com/video/fast.mp4", resolutionStr: "1080p" }],
      });
    }
    if (url.includes("/baseline-slow")) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          abortedBaselineRequests += 1;
          reject(init?.signal?.reason ?? new DOMException("Aborted", "AbortError"));
        };
        const timer = setTimeout(() => {
          init?.signal?.removeEventListener("abort", onAbort);
          resolve();
        }, options.slowBaselineDelayMs ?? 100);
        init?.signal?.addEventListener("abort", onAbort, { once: true });
      });
      return jsonResponse({ links: [] });
    }
    const bodyText = typeof init?.body === "string" ? init.body : "";
    if (url.includes("variables=")) {
      const variablesMatch = /variables=([^&]+)/.exec(url);
      const variables = variablesMatch?.[1]
        ? (JSON.parse(decodeURIComponent(variablesMatch[1])) as { translationType?: string })
        : {};
      return jsonResponse(variables.translationType === "dub" ? fixtures.dub : fixtures.sub);
    }
    if (bodyText.includes("shows(search:")) {
      return jsonResponse(fixtures.search);
    }
    if (bodyText.includes("show(_id:$id)")) {
      startedRequests.push("catalog");
      await options.catalogGate;
      return jsonResponse(fixtures.catalog);
    }
    if (bodyText.includes("episode(showId:$showId")) {
      const body = JSON.parse(bodyText) as { variables?: { translationType?: string } };
      return jsonResponse(body.variables?.translationType === "dub" ? fixtures.dub : fixtures.sub);
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;

  return {
    calls,
    startedRequests,
    get abortedAkRequests() {
      return abortedAkRequests;
    },
    get abortedBaselineRequests() {
      return abortedBaselineRequests;
    },
    [Symbol.dispose]() {
      globalThis.fetch = originalFetch;
    },
  };
}

async function readFixture<T>(name: string): Promise<T> {
  return JSON.parse(await Bun.file(new URL(name, FIXTURE_BASE)).text()) as T;
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function nowFixture(): string {
  return "2026-05-19T00:00:00.000Z";
}

/**
 * Transport failure must not render as a healthy empty catalog.
 *
 * `gqlPost` returns null for a timeout, 429, 5xx, DNS failure, or an upstream
 * rotation. The search path used to coalesce that to `[]` — the same value a
 * healthy search with no matches produces — so an unreachable AllAnime showed
 * "No results" and was invisible to provider health and diagnostics.
 */
describe("AllManga transport failure is preserved, not flattened", () => {
  const API = "https://api.example/graphql";

  function serve(handler: () => Response) {
    globalThis.fetch = (async () => handler()) as unknown as typeof fetch;
  }

  test("a 5xx is null, while a genuinely empty result stays an empty array", async () => {
    const originalFetch = globalThis.fetch;
    try {
      serve(() => new Response("upstream exploded", { status: 503 }));
      const failed = await searchAllManga(
        TEST_CONTEXT,
        API,
        "https://referer.example",
        "ua",
        "Example",
        "sub",
      );
      expect(failed).toBeNull();

      serve(
        () =>
          new Response(JSON.stringify({ data: { shows: { edges: [] } } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      );
      const empty = await searchAllManga(
        TEST_CONTEXT,
        API,
        "https://referer.example",
        "ua",
        "Nothing Matches This",
        "sub",
      );
      // A catalog that answered and had nothing is not a failure.
      expect(empty).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a rate limit is null, not an empty catalog", async () => {
    const originalFetch = globalThis.fetch;
    try {
      serve(() => new Response("slow down", { status: 429 }));
      expect(
        await searchAllManga(TEST_CONTEXT, API, "https://referer.example", "ua", "Example", "sub"),
      ).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a thrown request is null, not an empty catalog", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => {
        throw new Error("ENOTFOUND api.example");
      }) as unknown as typeof fetch;
      expect(
        await searchAllManga(TEST_CONTEXT, API, "https://referer.example", "ua", "Example", "sub"),
      ).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
