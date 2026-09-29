import { describe, expect, test } from "bun:test";

import type { ProviderRuntimeContext } from "@kunai/types";

import {
  CINEBY_ORIGIN,
  createVidkingResultFromPayload,
  createVideasyRouteCachePolicy,
  resolveVideasyClientProfile,
  VIDEASY_MEDIA_ORIGIN,
} from "../src/videasy/direct";

/**
 * Videasy carries two different origins and they are not interchangeable:
 *
 * - `clientProfile.origin` says which front-end we impersonate when *calling*
 *   the Videasy API (`cineby.at` for the `bc-frontend` app id).
 * - the media CDN's hotlink rule keys on the *player's* origin.
 *
 * Reusing the API origin as the stream origin shipped a stream that 403s.
 * Measured against `moon.peakstorm.top` on 2026-09-08, with the cineby watch
 * page as Referer:
 *
 *   Origin: https://www.vidking.net -> 200
 *   Origin: https://www.cineby.at   -> 403
 *   Origin: (absent)                -> 403
 *
 * The resolve gate probed the default (vidking) and passed, while playback
 * shipped the client origin and failed — a gate attesting a request shape
 * production never makes. The stream origin is therefore a single constant
 * with no override, so the probed shape and the shipped shape cannot diverge.
 */
const TEST_INPUT = {
  title: { id: "299167", tmdbId: "299167", kind: "series" as const, title: "Dutton Ranch" },
  episode: { season: 1, episode: 1 },
  mediaKind: "series" as const,
  intent: "play" as const,
  allowedRuntimes: ["direct-http" as const],
};

function resultForPayload() {
  return createVidkingResultFromPayload({
    apiRoute: "bc-flix",
    cachePolicy: createVideasyRouteCachePolicy({ resolveInput: TEST_INPUT, apiRoute: "bc-flix" }),
    input: TEST_INPUT,
    payload: {
      sources: [
        { url: "https://moon.peakstorm.top/vd/token/index-s1080p-v1-a1.m3u8", quality: "1080p" },
      ],
      subtitles: [],
    },
    server: "bc-flix",
    streamReferer: "https://www.cineby.at/tv/299167/1/1",
  });
}

describe("videasy stream origin", () => {
  test("the media origin is not the API client origin", () => {
    expect(VIDEASY_MEDIA_ORIGIN).not.toBe(CINEBY_ORIGIN);
  });

  test("a resolved stream carries the media origin", () => {
    const result = resultForPayload();

    expect(result?.streams[0]?.headers?.origin).toBe(VIDEASY_MEDIA_ORIGIN);
  });

  test("the stream referer still identifies the impersonated watch page", () => {
    // The CDN accepts the cineby Referer; it is only the Origin it discriminates
    // on, so the referer must keep pointing at the page we claim to be.
    const result = resultForPayload();

    expect(result?.streams[0]?.headers?.referer).toBe("https://www.cineby.at/tv/299167/1/1");
  });

  test("the cineby client profile still calls the API as cineby", () => {
    // The fix must not leak into the API request identity, which is a separate
    // concern and is correct as it stands.
    const context = { now: () => "2026-09-08T00:00:00.000Z" } as unknown as ProviderRuntimeContext;
    const profile = resolveVideasyClientProfile(TEST_INPUT, context, { appId: "bc-frontend" });

    expect(profile.origin).toBe(CINEBY_ORIGIN);
    expect(profile.streamReferer).toBe("https://www.cineby.at/tv/299167/1/1");
  });
});
