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

test("detectGeoBlockedProviderResponse does not match the module name as a provider id", () => {
  // The provider id is "allanime" (ALLANIME_PROVIDER_ID); "allmanga" is only
  // the module directory. Suggesting relay on the module name fires for a
  // provider id that can never occur.
  expect(
    detectGeoBlockedProviderResponse({
      providerId: "allmanga",
      status: 200,
      body: '{"message":"NEED_CAPTCHA"}',
    }),
  ).toEqual({
    blocked: true,
    reason: "need-captcha",
    relaySuggested: false,
  });
});
