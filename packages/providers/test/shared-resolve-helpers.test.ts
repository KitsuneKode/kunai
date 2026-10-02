import { describe, expect, test } from "bun:test";

import { providerHttpErrorForStatus } from "@kunai/types";

import { classifyProviderFetchFailure } from "../src/shared/resolve-helpers.ts";

describe("classifyProviderFetchFailure", () => {
  test("a typed HTTP error keeps its status-derived code instead of flattening", () => {
    expect(
      classifyProviderFetchFailure(
        providerHttpErrorForStatus({
          status: 429,
          message: "AnimeGG throttled",
        }),
      ),
    ).toEqual({ code: "rate-limited", retryable: true });
    expect(
      classifyProviderFetchFailure(
        providerHttpErrorForStatus({
          status: 403,
          message: "edge refused",
        }),
      ),
    ).toEqual({ code: "blocked", retryable: false });
    expect(
      classifyProviderFetchFailure(
        providerHttpErrorForStatus({
          status: 503,
          message: "origin down",
        }),
      ),
    ).toEqual({ code: "provider-unavailable", retryable: true });
  });

  test("a timeout-named error reads as a retryable timeout", () => {
    const timeout = new Error("request timed out");
    timeout.name = "TimeoutError";
    expect(classifyProviderFetchFailure(timeout)).toEqual({
      code: "timeout",
      retryable: true,
    });
  });

  test("an untyped error stays a retryable network failure", () => {
    expect(classifyProviderFetchFailure(new Error("socket hangup"))).toEqual({
      code: "network-error",
      retryable: true,
    });
    expect(classifyProviderFetchFailure(undefined)).toEqual({
      code: "network-error",
      retryable: true,
    });
  });
});
