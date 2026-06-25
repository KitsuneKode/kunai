import { describe, expect, test } from "bun:test";

import { buildYoutubeYtdlProfile } from "../../src/youtube/ytdl-profile";

describe("buildYoutubeYtdlProfile", () => {
  test("builds 1080p DASH format selector for playback", () => {
    const profile = buildYoutubeYtdlProfile({ qualityLabel: "1080p" });
    expect(profile.formatSelector).toContain("bestvideo[height<=1080]");
    expect(profile.mpvFormat).toBe(profile.formatSelector);
    expect(profile.mpvScriptOpts).toBe("ytdlautoformat-domains=");
  });

  test("adds cookies and download merge flags", () => {
    const profile = buildYoutubeYtdlProfile({
      qualityLabel: "720p",
      cookiesFromBrowser: "firefox",
      cookiesFile: "/tmp/cookies.txt",
      extractorArgs: "youtube:player_client=android",
      sponsorblockRemove: "sponsor",
      forDownload: true,
    });
    expect(profile.cliArgs).toEqual(
      expect.arrayContaining([
        "--cookies-from-browser",
        "firefox",
        "--cookies",
        "/tmp/cookies.txt",
        "--extractor-args",
        "youtube:player_client=android",
        "--sponsorblock-remove",
        "sponsor",
        "--merge-output-format",
        "mp4",
        "--write-subs",
        "--write-auto-subs",
      ]),
    );
    expect(profile.formatSelector).toContain("bestvideo[height<=720]");
    expect(profile.mpvRawOptions).toContain("cookies-from-browser");
  });

  test("uses live playback format when stream is live", () => {
    const profile = buildYoutubeYtdlProfile({ isLive: true, qualityLabel: "1080p" });
    expect(profile.formatSelector).toBe("bv*+ba/b");
    expect(profile.cliArgs).toContain("--no-live-from-start");
  });
});
