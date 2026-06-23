import { expect, test } from "bun:test";

import { detectGeoBlockedProviderResponse } from "../src/detect-geo-block";

test("detectGeoBlockedProviderResponse recognizes AllAnime NEED_CAPTCHA responses", () => {
  expect(
    detectGeoBlockedProviderResponse({
      providerId: "allanime",
      upstreamUrl: "https://api.allanime.day/api",
      status: 200,
      body: '{"message":"NEED_CAPTCHA"}',
    }),
  ).toEqual({
    blocked: true,
    reason: "need-captcha",
    relaySuggested: true,
  });
});

test("detectGeoBlockedProviderResponse does not suggest relay broadly", () => {
  expect(
    detectGeoBlockedProviderResponse({
      providerId: "miruro",
      status: 403,
      body: "cf-turnstile",
    }),
  ).toEqual({
    blocked: true,
    reason: "turnstile",
    relaySuggested: false,
  });
});

test("detectGeoBlockedProviderResponse ignores ordinary provider failures", () => {
  expect(
    detectGeoBlockedProviderResponse({
      providerId: "allanime",
      status: 500,
      body: "upstream unavailable",
    }),
  ).toEqual({ blocked: false, relaySuggested: false });
});
