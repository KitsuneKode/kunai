import { describe, expect, test } from "bun:test";

import { buildYoutubeYtdlProfile } from "../../src/youtube/ytdl-profile";

describe("buildYoutubeYtdlProfile", () => {
  test("builds 1080p DASH format selector for playback", () => {
    const profile = buildYoutubeYtdlProfile({ qualityLabel: "1080p" });
    expect(profile.formatSelector).toContain("bv*[height<=1080][aspect_ratio>=1]");
    expect(profile.formatSelector).toContain("bv*[width<=1080][aspect_ratio<1]");
    expect(profile.mpvFormat).toBe(profile.formatSelector);
    expect(profile.mpvScriptOpts).toBe("ytdlautoformat-domains=");
  });

  test("adds cookies and download merge flags without requesting discarded yt-dlp subtitles", () => {
    const profile = buildYoutubeYtdlProfile({
      qualityLabel: "720p",
      cookiesFromBrowser: "firefox",
      cookiesFile: "/tmp/cookies.txt",
      extractorArgs: "youtube:player_client=android",
      sponsorblockRemove: "sponsor",
      subtitleLanguage: "en",
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
      ]),
    );
    // DownloadService fetches the chosen subtitle sidecar directly and deletes
    // yt-dlp's staging dir; passing --write-subs/--sub-langs all fetched ~940
    // discarded subtitle files before byte 1 of video and aborted on a single 429.
    expect(profile.cliArgs).not.toContain("--write-subs");
    expect(profile.cliArgs).not.toContain("--write-auto-subs");
    expect(profile.cliArgs).not.toContain("--sub-langs");
    expect(profile.formatSelector).toContain("bv*[height<=720][aspect_ratio>=1]");
    expect(profile.mpvRawOptions).toContain("cookies-from-browser");
  });

  test("downloads with unset quality keep highest-available selector and honor audio language", () => {
    const bestDownload = buildYoutubeYtdlProfile({ forDownload: true });
    expect(bestDownload.formatSelector).toBe("bv*+ba/b/ba");

    const jpDownload = buildYoutubeYtdlProfile({
      forDownload: true,
      qualityLabel: "1080p",
      audioLanguage: "ja",
    });
    expect(jpDownload.formatSelector).toContain("+(ba[language^=ja]/ba)/");
  });

  test("uses live playback format when stream is live", () => {
    const profile = buildYoutubeYtdlProfile({ isLive: true, qualityLabel: "1080p" });
    expect(profile.formatSelector).toBe("bv*+ba/b/ba");
    expect(profile.cliArgs).toContain("--no-live-from-start");
  });
});
