import { describe, expect, test } from "bun:test";

import { classifyYoutubeMetadataFailure } from "../../src/youtube/metadata-failure";

describe("youtube metadata failure classification", () => {
  test.each([
    [
      "ERROR: [youtube] abc: Private video. Sign in if you've been granted access to this video",
      "not-found",
      "private",
    ],
    [
      "ERROR: [youtube] abc: Video unavailable. This video has been removed by the uploader",
      "not-found",
      "removed",
    ],
    [
      "ERROR: [youtube] abc: Join this channel to get access to members-only content",
      "blocked",
      "members-only",
    ],
    [
      "ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.",
      "blocked",
      "age-restricted",
    ],
    [
      "ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies-from-browser",
      "blocked",
      "not a bot",
    ],
    [
      "ERROR: [youtube] abc: Video unavailable. The uploader has not made this video available in your country",
      "blocked",
      "your country",
    ],
  ])("%s is terminal", (stderr, code, fragment) => {
    const classified = classifyYoutubeMetadataFailure(new Error(stderr));
    expect(classified.terminal).toBe(true);
    expect(classified.code).toBe(code as never);
    expect(classified.message.toLowerCase()).toContain(fragment.toLowerCase());
  });

  test("a geo-block behind the generic 'Video unavailable' prefix keeps its real reason", () => {
    // yt-dlp prefixes several distinct refusals with "Video unavailable"; the
    // generic removed/unavailable rule must not swallow the specific one.
    const classified = classifyYoutubeMetadataFailure(
      new Error(
        "ERROR: Video unavailable. This video contains content from SME, who has blocked it in your country",
      ),
    );
    expect(classified.message).toContain("not available in your country");
  });

  test.each([
    ["ERROR: unable to download webpage: HTTP Error 503: Service Unavailable", "network-error"],
    ["ERROR: HTTP Error 429: Too Many Requests", "rate-limited"],
    ["yt-dlp timed out after 45000ms", "timeout"],
  ])("%s stays transient", (stderr, code) => {
    const classified = classifyYoutubeMetadataFailure(new Error(stderr));
    expect(classified.terminal).toBe(false);
    expect(classified.code).toBe(code as never);
  });

  test("real yt-dlp output for a missing video is terminal", () => {
    // Captured verbatim from `yt-dlp -J` against a non-existent id (2026-08-24),
    // so the rule is pinned to what yt-dlp actually prints, not a guess at it.
    const classified = classifyYoutubeMetadataFailure(
      new Error("ERROR: [youtube] XXXXXXXXXXX: Video unavailable"),
    );
    expect(classified.terminal).toBe(true);
    expect(classified.code).toBe("not-found");
  });

  test("an unrecognised failure stays transient rather than guessing", () => {
    const classified = classifyYoutubeMetadataFailure(new Error("ERROR: something entirely new"));
    expect(classified.terminal).toBe(false);
    expect(classified.code).toBe("parse-failed");
    expect(classified.message).toContain("something entirely new");
  });

  test("a non-Error rejection does not crash the classifier", () => {
    expect(classifyYoutubeMetadataFailure(undefined).terminal).toBe(false);
    expect(classifyYoutubeMetadataFailure("boom").message).toContain("boom");
  });
});
