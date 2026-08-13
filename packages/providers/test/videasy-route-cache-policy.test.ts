import { beforeAll, describe, expect, test } from "bun:test";

import type { CachePolicy, ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import {
  createVideasyRouteCachePolicy,
  createVidkingResultFromPayload,
} from "../src/videasy/direct";

const TEST_CONTEXT: ProviderRuntimeContext = {
  providerId: "videasy",
  now: () => "2026-08-13T00:00:00.000Z",
};

const TEST_INPUT: ProviderResolveInput = {
  title: { id: "299167", kind: "movie", title: "Bloodhounds", tmdbId: "299167" },
  mediaKind: "movie",
  intent: "play",
  allowedRuntimes: ["direct-http"],
};

type VidkingTestPayload = Parameters<typeof createVidkingResultFromPayload>[0]["payload"];

let PAYLOAD: VidkingTestPayload;

beforeAll(async () => {
  PAYLOAD = (await Bun.file(
    new URL("./fixtures/videasy/source-payload.json", import.meta.url),
  ).json()) as VidkingTestPayload;
});

function buildResult(cachePolicy: CachePolicy, apiRoute: string) {
  return createVidkingResultFromPayload({
    input: TEST_INPUT,
    cachePolicy,
    apiRoute,
    payload: PAYLOAD,
    server: apiRoute,
    context: TEST_CONTEXT,
  });
}

describe("createVideasyRouteCachePolicy", () => {
  test("keys on the selected route, so two routes of one title do not collide", () => {
    const cdn = createVideasyRouteCachePolicy({
      resolveInput: TEST_INPUT,
      apiRoute: "wings-cdn",
    });
    const neon = createVideasyRouteCachePolicy({
      resolveInput: TEST_INPUT,
      apiRoute: "wings-neon2",
    });

    expect(cdn.keyParts).not.toEqual(neon.keyParts);
    expect(cdn.keyParts).toContain("wings-cdn");
    expect(neon.keyParts).toContain("wings-neon2");
  });

  test("is stable for the same route and title", () => {
    const a = createVideasyRouteCachePolicy({ resolveInput: TEST_INPUT, apiRoute: "wings-cdn" });
    const b = createVideasyRouteCachePolicy({ resolveInput: TEST_INPUT, apiRoute: "wings-cdn" });

    expect(a.keyParts).toEqual(b.keyParts);
  });

  test("distinguishes app ids", () => {
    const withApp = createVideasyRouteCachePolicy({
      resolveInput: TEST_INPUT,
      apiRoute: "wings-cdn",
      appId: "app-a",
    });
    const withOther = createVideasyRouteCachePolicy({
      resolveInput: TEST_INPUT,
      apiRoute: "wings-cdn",
      appId: "app-b",
    });

    expect(withApp.keyParts).not.toEqual(withOther.keyParts);
  });
});

describe("createVidkingResultFromPayload uses the policy it is given", () => {
  /**
   * The function used to name its parameter `_cachePolicy` and rebuild a policy
   * internally, re-deriving the route and app id. Two owners for one key is the
   * house "declared and unread" failure mode.
   */
  test("returns the exact policy object supplied by the caller", () => {
    const policy = createVideasyRouteCachePolicy({
      resolveInput: TEST_INPUT,
      apiRoute: "wings-cdn",
    });

    const result = buildResult(policy, "wings-cdn");

    expect(result).not.toBeNull();
    expect(result?.cachePolicy).toBe(policy);
  });

  test("carries the selected route through streams and the selected source", () => {
    const policy = createVideasyRouteCachePolicy({
      resolveInput: TEST_INPUT,
      apiRoute: "wings-neon2",
    });

    const result = buildResult(policy, "wings-neon2");

    expect(result?.sources?.[0]?.metadata?.apiRoute).toBe("wings-neon2");
    expect(result?.sources?.[0]?.cachePolicy).toBe(policy);
    for (const stream of result?.streams ?? []) {
      expect(stream.cachePolicy).toBe(policy);
    }
  });

  test("does not alias two routes onto one policy", () => {
    const cdn = createVideasyRouteCachePolicy({ resolveInput: TEST_INPUT, apiRoute: "wings-cdn" });
    const neon = createVideasyRouteCachePolicy({
      resolveInput: TEST_INPUT,
      apiRoute: "wings-neon2",
    });

    expect(buildResult(cdn, "wings-cdn")?.cachePolicy?.keyParts).not.toEqual(
      buildResult(neon, "wings-neon2")?.cachePolicy?.keyParts ?? [],
    );
  });
});
