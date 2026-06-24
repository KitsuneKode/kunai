import { expect, test } from "bun:test";

import { classifyProviderFailure } from "../src/provider-failure-classifier";

test("shared provider failure taxonomy maps codes and HTTP status consistently", () => {
  expect(
    classifyProviderFailure({
      providerId: "vidking",
      code: "timeout",
      message: "Provider did not return a stream within 15s",
      retryable: true,
    }),
  ).toMatchObject({
    failureClass: "timeout",
    fallbackPolicy: "auto-fallback",
    retryable: true,
  });

  expect(
    classifyProviderFailure({
      providerId: "allmanga",
      code: "blocked",
      message: "Provider returned 403",
      retryable: false,
    }),
  ).toMatchObject({
    failureClass: "blocked",
    fallbackPolicy: "guided-action",
    retryable: false,
  });

  expect(
    classifyProviderFailure({
      providerId: "rivestream",
      status: 404,
      message: "HTTP 404",
    }),
  ).toMatchObject({
    failureClass: "provider-empty",
    fallbackPolicy: "auto-fallback",
  });
});
