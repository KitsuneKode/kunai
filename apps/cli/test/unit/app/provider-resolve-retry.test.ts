import { describe, expect, test } from "bun:test";

import {
  ProviderResolveFailureError,
  resolveProviderStreamWithRetries,
} from "@/app/playback/provider-resolve-retry";

describe("resolveProviderStreamWithRetries", () => {
  test("retries recoverable failures and reports retry status", async () => {
    const attempts: number[] = [];
    const failures: string[] = [];
    let calls = 0;

    const stream = await resolveProviderStreamWithRetries({
      providerId: "vidking",
      providerName: "VidKing",
      maxAttempts: 3,
      timeoutMs: 1000,
      retryDelayMs: 0,
      signal: new AbortController().signal,
      onAttempt: (attempt) => attempts.push(attempt.attempt),
      onFailure: (failure) => failures.push(failure.issue),
      resolve: async () => {
        calls++;
        if (calls < 3) {
          throw new ProviderResolveFailureError({
            providerId: "vidking",
            code: "provider-unavailable",
            message: "CDN returned 503",
            retryable: true,
            at: "2026-05-06T00:00:00.000Z",
          });
        }
        return { url: "https://cdn.example/stream.m3u8", timestamp: 1 };
      },
    });

    expect(stream?.url).toBe("https://cdn.example/stream.m3u8");
    expect(attempts).toEqual([1, 2, 3]);
    expect(failures).toEqual([
      "vidking: provider-unavailable - CDN returned 503",
      "vidking: provider-unavailable - CDN returned 503",
    ]);
  });

  test("does not retry non-recoverable failures", async () => {
    let calls = 0;

    await expect(
      resolveProviderStreamWithRetries({
        providerId: "vidking",
        providerName: "VidKing",
        maxAttempts: 3,
        timeoutMs: 1000,
        retryDelayMs: 0,
        signal: new AbortController().signal,
        resolve: async () => {
          calls++;
          throw new ProviderResolveFailureError({
            providerId: "vidking",
            code: "not-found",
            message: "Episode is not available",
            retryable: false,
            at: "2026-05-06T00:00:00.000Z",
          });
        },
      }),
    ).rejects.toThrow("Episode is not available");

    expect(calls).toBe(1);
  });

  test("classifies provider timeouts as retryable provider issues", async () => {
    const failures: string[] = [];

    await expect(
      resolveProviderStreamWithRetries({
        providerId: "vidking",
        providerName: "VidKing",
        maxAttempts: 1,
        timeoutMs: 1,
        retryDelayMs: 0,
        signal: new AbortController().signal,
        onFailure: (failure) => failures.push(failure.issue),
        resolve: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return { url: "https://cdn.example/late.m3u8", timestamp: 1 };
        },
      }),
    ).rejects.toThrow("Provider did not return a stream within 0s");

    expect(failures).toEqual(["vidking: timeout - Provider did not return a stream within 0s"]);
  });
});
