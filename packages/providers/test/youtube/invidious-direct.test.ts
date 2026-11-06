import { describe, expect, test } from "bun:test";

import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import { toYoutubeVideoCatalogId } from "../../src/youtube/ids";
import {
  INVIDIOUS_PROVIDER_ID,
  invidiousManifest,
  invidiousProviderModule,
  resolveInvidious,
} from "../../src/youtube/invidious-direct";

const TEST_CONTEXT: ProviderRuntimeContext = {
  providerId: INVIDIOUS_PROVIDER_ID,
  now: () => "2026-11-04T12:00:00.000Z",
};

const BASE_INPUT: ProviderResolveInput = {
  intent: "play",
  allowedRuntimes: ["direct-http"],
  mediaKind: "video",
  title: {
    id: toYoutubeVideoCatalogId("dQw4w9WgXcQ"),
    kind: "video",
    title: "Rick Astley - Never Gonna Give You Up",
    externalIds: { youtubeId: "dQw4w9WgXcQ" },
  },
  preferredSubtitleLanguage: "en",
};

describe("invidiousProviderModule", () => {
  test("manifest declares correct video capabilities and identity", () => {
    expect(invidiousManifest.id).toBe(INVIDIOUS_PROVIDER_ID);
    expect(invidiousManifest.mediaKinds).toContain("video");
    expect(invidiousManifest.capabilities).toContain("source-resolve");
    expect(invidiousManifest.capabilities).toContain("subtitle-resolve");
    expect(invidiousManifest.capabilities).toContain("episode-list");
    expect(invidiousManifest.capabilities).toContain("search");
    expect(invidiousProviderModule.providerId).toBe(INVIDIOUS_PROVIDER_ID);
  });

  test("rejects non-video media kinds with unsupported-title", async () => {
    const input: ProviderResolveInput = {
      ...BASE_INPUT,
      mediaKind: "anime",
    };
    const result = await resolveInvidious(input, TEST_CONTEXT);
    expect(result.status).toBe("exhausted");
    expect(result.failures.some((f) => f.code === "unsupported-title")).toBe(true);
  });

  test("rejects missing video id with missing-input", async () => {
    const input: ProviderResolveInput = {
      ...BASE_INPUT,
      title: {
        id: "invidious:custom:none",
        kind: "video",
        title: "No ID",
      },
    };
    const result = await resolveInvidious(input, TEST_CONTEXT);
    expect(result.status).toBe("exhausted");
    expect(result.failures.some((f) => f.code === "missing-input")).toBe(true);
  });
});
