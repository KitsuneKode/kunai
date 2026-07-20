import { describe, expect, test } from "bun:test";

import {
  decideSoftFallbackOnResolve,
  decideSoftFallbackPromote,
} from "@/domain/playback/soft-fallback-preference-policy";

test("soft hop sets session soft only", () => {
  expect(
    decideSoftFallbackOnResolve({
      configuredProviderId: "allanime",
      resolvedProviderId: "miruro",
    }),
  ).toEqual({ kind: "session-soft-hop", providerId: "miruro" });
});

test("same provider is no-hop", () => {
  expect(
    decideSoftFallbackOnResolve({
      configuredProviderId: "allanime",
      resolvedProviderId: "allanime",
    }),
  ).toEqual({ kind: "no-hop" });
});

test("promote only after engage on soft winner", () => {
  expect(
    decideSoftFallbackPromote({
      sessionSoftProviderId: "miruro",
      configuredProviderId: "allanime",
      engaged: false,
      canonicalTitleId: "anilist:1",
    }),
  ).toEqual({ kind: "leave-durable-unchanged" });

  expect(
    decideSoftFallbackPromote({
      sessionSoftProviderId: "miruro",
      configuredProviderId: "allanime",
      engaged: true,
      canonicalTitleId: "anilist:1",
    }),
  ).toEqual({
    kind: "promote-durable",
    providerId: "miruro",
    canonicalTitleId: "anilist:1",
  });
});
