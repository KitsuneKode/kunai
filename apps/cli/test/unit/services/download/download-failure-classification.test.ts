import { describe, expect, test } from "bun:test";

import { analyzeDownloadFailure } from "@/services/download/DownloadService";

describe("download failure classification", () => {
  test("classifies an artifact probe deadline separately from corrupt media", () => {
    expect(
      analyzeDownloadFailure("artifact-validation-timeout: ffprobe exceeded 30000ms deadline"),
    ).toEqual({
      failureKind: "artifact-timeout",
      retryable: false,
    });
  });

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

/**
 * A full disk is the one failure where retrying is actively harmful: every
 * attempt re-downloads the whole file from zero, fails at the same byte, and
 * spends a provider request to do it. Before this classification it landed in
 * the `unknown` bucket, which is `retryable: true`, so it burned the entire
 * `maxAttempts` budget against a disk that was still full.
 *
 * yt-dlp's stderr reaches `analyzeDownloadFailure` verbatim —
 * `runYtDlpProcess` keeps the *tail* of the stream (`appendBoundedText` slices
 * `-maxBytes`), which is where a fatal write error lands — so these are the
 * real strings, not paraphrases.
 */
describe("disk exhaustion", () => {
  test("classifies the POSIX write failure yt-dlp and ffmpeg emit", () => {
    expect(
      analyzeDownloadFailure("ERROR: unable to write data: [Errno 28] No space left on device"),
    ).toEqual({ failureKind: "disk-full", retryable: false });
    expect(analyzeDownloadFailure("av_interleaved_write_frame(): No space left on device")).toEqual(
      { failureKind: "disk-full", retryable: false },
    );
  });

  test("classifies the Node and Windows spellings", () => {
    // Sidecar and artwork writes go through node:fs, which prefixes the code.
    expect(analyzeDownloadFailure("ENOSPC: no space left on device, write")).toEqual({
      failureKind: "disk-full",
      retryable: false,
    });
    // Windows never says "No space left on device"; a Windows-only spelling is
    // the difference between this working on one platform and on three.
    expect(analyzeDownloadFailure("[WinError 112] There is not enough space on the disk")).toEqual({
      failureKind: "disk-full",
      retryable: false,
    });
  });

  test("classifies an exhausted quota as the same condition", () => {
    // EDQUOT is a full disk from the writer's point of view: same cause, same
    // remedy, and the same reason not to retry.
    expect(analyzeDownloadFailure("OSError: [Errno 122] Disk quota exceeded")).toEqual({
      failureKind: "disk-full",
      retryable: false,
    });
  });

  test("our own artifact markers outrank scraped vendor text", () => {
    // The `artifact-*` prefixes are constructed in DownloadService itself and
    // carry deliberate terminal semantics. The disk phrases are unstructured
    // text scraped from yt-dlp, ffmpeg or the OS. If a stray "no space left on
    // device" rode along in an artifact-validation message, letting it win
    // would silently re-route our own classification into the pause lane and
    // make a corrupt artifact look like a recoverable storage condition.
    expect(
      analyzeDownloadFailure("artifact-invalid: ffprobe rejected output; No space left on device"),
    ).toEqual({ failureKind: "artifact-invalid", retryable: false });
    expect(
      analyzeDownloadFailure(
        "artifact-validation-timeout: ffprobe exceeded 30000ms; no space left on device",
      ),
    ).toEqual({ failureKind: "artifact-timeout", retryable: false });
  });

  test("a self-abort caused by the disk filling is classified as the disk", () => {
    // A user-initiated cancel never reaches the classifier — `processNextQueued`
    // checks `activeProcesses`/`cancellationRequests` first — so this string
    // only arises when yt-dlp aborts itself over the write failure. The cause
    // is the disk, and the disk is what the user has to act on.
    expect(
      analyzeDownloadFailure(
        "ERROR: unable to write data; download aborted: [Errno 28] No space left on device",
      ),
    ).toEqual({ failureKind: "disk-full", retryable: false });
  });

  test("does not claim unrelated failures that merely mention space or disk", () => {
    expect(analyzeDownloadFailure("HTTP Error 500: disk backend unavailable")).toEqual({
      failureKind: "http-server",
      retryable: true,
    });
  });
});
