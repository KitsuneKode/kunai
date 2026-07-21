import { describe, expect, test } from "bun:test";

import { classifyProviderFailure } from "@/domain/provider/ProviderFailureClassifier";

describe("ProviderFailureClassifier", () => {
  test("classifies timeout as automatic fallback", () => {
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
  });

  test("classifies blocked providers as guided action", () => {
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
  });

  test("does not auto fallback user cancellation or missing runtime", () => {
    expect(classifyProviderFailure(new Error("Provider resolve aborted"))).toMatchObject({
      failureClass: "user-cancelled",
      fallbackPolicy: "no-fallback",
    });

    expect(
      classifyProviderFailure({
        providerId: "mpv",
        code: "runtime-missing",
        message: "mpv is not installed",
        retryable: false,
      }),
    ).toMatchObject({
      failureClass: "runtime-missing",
      fallbackPolicy: "no-fallback",
    });
  });

  test("maps empty or not-found provider results to provider-empty", () => {
    expect(
      classifyProviderFailure({
        providerId: "rivestream",
        code: "not-found",
        message: "No playable stream returned",
        retryable: true,
      }),
    ).toMatchObject({
      failureClass: "provider-empty",
      fallbackPolicy: "auto-fallback",
    });
  });

  test("HTTP 503 remains provider-local network failure", () => {
    expect(
      classifyProviderFailure({
        providerId: "vidking",
        code: "network-error",
        message: "HTTP 503 Service Unavailable",
        retryable: true,
        status: 503,
      }),
    ).toMatchObject({
      failureClass: "network",
      fallbackPolicy: "auto-fallback",
    });
  });

  test("ENOTFOUND classifies as offline with no-fallback", () => {
    expect(
      classifyProviderFailure({
        providerId: "vidking",
        code: "network-error",
        message: "getaddrinfo ENOTFOUND api.example.test",
        retryable: true,
      }),
    ).toMatchObject({
      failureClass: "offline",
      fallbackPolicy: "no-fallback",
      retryable: false,
    });
  });
});
