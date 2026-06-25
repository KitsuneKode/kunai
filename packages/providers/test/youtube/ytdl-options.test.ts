import { describe, expect, test } from "bun:test";

import {
  buildYoutubeMpvYtdlRawOptions,
  buildYoutubeYtdlCliArgs,
  joinMpvYtdlRawOptions,
} from "@kunai/providers/youtube";

describe("youtube ytdl options", () => {
  test("buildYoutubeYtdlCliArgs includes sponsorblock and cookies", () => {
    const args = buildYoutubeYtdlCliArgs({
      cookiesFromBrowser: "chrome",
      sponsorblockRemove: "sponsor,intro",
      isLive: true,
    });

    expect(args).toContain("--cookies-from-browser");
    expect(args).toContain("chrome");
    expect(args).toContain("--sponsorblock-remove");
    expect(args).toContain("sponsor,intro");
    expect(args).toContain("--no-live-from-start");
    expect(args).not.toContain("--live-from-start");
  });

  test("buildYoutubeMpvYtdlRawOptions joins for mpv", () => {
    const joined = joinMpvYtdlRawOptions(
      buildYoutubeMpvYtdlRawOptions({
        sponsorblockRemove: "sponsor,intro",
        isLive: true,
      }),
    );

    expect(joined).toBe("sponsorblock-remove=%13%sponsor,intro,live-from-start=no");
  });

  test("buildYoutubeMpvYtdlRawOptions forwards cookies and extractor args", () => {
    const joined = joinMpvYtdlRawOptions(
      buildYoutubeMpvYtdlRawOptions({
        cookiesFromBrowser: "chrome",
        cookiesFile: "/tmp/cookies.txt",
        extractorArgs: "youtube:player_client=android",
      }),
    );

    expect(joined).toContain("cookies-from-browser=%6%chrome");
    expect(joined).toContain("cookies=%16%/tmp/cookies.txt");
    expect(joined).toContain("extractor-args=%29%youtube:player_client=android");
  });
});
