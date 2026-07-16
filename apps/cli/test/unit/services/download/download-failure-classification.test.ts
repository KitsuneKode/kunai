import { describe, expect, test } from "bun:test";

import { analyzeDownloadFailure } from "@/services/download/DownloadService";

describe("download failure classification", () => {
  test("retries rate limits and request timeouts", () => {
    expect(analyzeDownloadFailure("HTTP Error 429: Too Many Requests")).toEqual({
      failureKind: "http-client",
      retryable: true,
    });
    expect(analyzeDownloadFailure("HTTP Error 408: Request Timeout")).toEqual({
      failureKind: "http-client",
      retryable: true,
    });
    expect(analyzeDownloadFailure("Too Many Requests")).toEqual({
      failureKind: "http-client",
      retryable: true,
    });
  });

  test("preserves bounded classifications for hard client and server errors", () => {
    expect(analyzeDownloadFailure("HTTP Error 403: Forbidden")).toEqual({
      failureKind: "http-auth",
      retryable: false,
    });
    expect(analyzeDownloadFailure("HTTP Error 404: Not Found")).toEqual({
      failureKind: "http-client",
      retryable: false,
    });
    expect(analyzeDownloadFailure("HTTP Error 500: Internal Server Error")).toEqual({
      failureKind: "http-server",
      retryable: true,
    });
  });
});
