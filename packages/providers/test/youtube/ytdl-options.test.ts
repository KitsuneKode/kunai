import { describe, expect, test } from "bun:test";

import {
  buildYoutubeMpvScriptOpts,
  buildYoutubeMpvYtdlRawOptions,
  buildYoutubeYtdlCliArgs,
  joinMpvScriptOpts,
  joinMpvYtdlRawOptions,
  parseYoutubePlayerClients,
  withYoutubePlayerClient,
  appendYoutubePoToken,
} from "@kunai/providers/youtube";

describe("youtube ytdl options", () => {
  // yt-dlp strips the `IE_KEY:` prefix exactly once and splits the rest on `;`, so a
  // second `youtube:` becomes part of the key name and the value is never read. These
  // assertions are what stop the token from silently going nowhere.
  test("appendYoutubePoToken keeps one extractor prefix and scopes the token to the lane", () => {
    expect(appendYoutubePoToken("youtube:player_client=mweb", "abcd")).toBe(
      "youtube:player_client=mweb;po_token=mweb.gvs+abcd",
    );
    // An explicit CLIENT.CONTEXT+TOKEN from the user is passed through untouched.
    expect(appendYoutubePoToken("youtube:player_client=mweb", "ios.gvs+abcd")).toBe(
      "youtube:player_client=mweb;po_token=ios.gvs+abcd",
    );
    expect(appendYoutubePoToken(undefined, "abcd")).toBe("youtube:po_token=web.gvs+abcd");
    expect(appendYoutubePoToken("", "abcd")).toBe("youtube:po_token=web.gvs+abcd");
    expect(appendYoutubePoToken("youtube:player_client=mweb", undefined)).toBe(
      "youtube:player_client=mweb",
    );
  });

  test("appendYoutubePoToken never appends a second po_token", () => {
    // The dedupe guard has to see a correctly-formed value, which is the shape that
    // has no `youtube:` in front of the key.
    expect(appendYoutubePoToken("youtube:player_client=web;po_token=web.gvs+old", "new")).toBe(
      "youtube:player_client=web;po_token=web.gvs+old",
    );
  });

  test("a po_token survives the per-lane player_client rewrite", () => {
    const lane = withYoutubePlayerClient("youtube:player_client=visionos,web", "web");
    expect(appendYoutubePoToken(lane, "tok")).toBe(
      "youtube:player_client=web;po_token=web.gvs+tok",
    );
  });

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

    expect(joined).toBe(
      "sponsorblock-remove=%13%sponsor,intro,no-live-from-start=,sub-langs=%3%all",
    );
  });

  test("appends PO token to extractor-args", () => {
    const args = buildYoutubeYtdlCliArgs({
      extractorArgs: "youtube:player_client=web",
      poToken: "web+testToken123",
    });
    expect(args).toContain("--extractor-args");
    expect(args).toContain("youtube:player_client=web;po_token=web+testToken123");

    const raw = buildYoutubeMpvYtdlRawOptions({
      poToken: "testToken456",
    });
    const value = "youtube:po_token=web.gvs+testToken456";
    expect(raw).toContain(`extractor-args=%${value.length}%${value}`);
  });

  test("buildYoutubeMpvScriptOpts disables ytdlautoformat overrides", () => {
    expect(buildYoutubeMpvScriptOpts()).toBe("ytdlautoformat-domains=");
    expect(joinMpvScriptOpts("foo=bar", buildYoutubeMpvScriptOpts())).toBe(
      "foo=bar,ytdlautoformat-domains=",
    );
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

  test("forwards subtitle language preference to yt-dlp all-tracks embed", () => {
    const args = buildYoutubeYtdlCliArgs({ subtitleLanguage: "en" });
    expect(args).toContain("--sub-langs");
    expect(args).toContain("all");

    const joined = joinMpvYtdlRawOptions(buildYoutubeMpvYtdlRawOptions({ subtitleLanguage: "en" }));
    expect(joined).toContain("sub-langs=%3%all");
  });

  test("skips sub-langs when subtitles are disabled", () => {
    const args = buildYoutubeYtdlCliArgs({ subtitleLanguage: "none" });
    expect(args).not.toContain("--sub-langs");
  });

  test("parseYoutubePlayerClients reads the requested clients in order", () => {
    expect(parseYoutubePlayerClients("youtube:player_client=mweb,tv_simply")).toEqual([
      "mweb",
      "tv_simply",
    ]);
    expect(parseYoutubePlayerClients("youtube:player_client=mweb,mweb")).toEqual(["mweb"]);
    expect(parseYoutubePlayerClients("youtube:skip=hls")).toEqual([]);
    expect(parseYoutubePlayerClients(undefined)).toEqual([]);
  });

  test("withYoutubePlayerClient narrows to one client and keeps other keys", () => {
    expect(withYoutubePlayerClient("youtube:player_client=mweb,tv_simply", "tv_simply")).toBe(
      "youtube:player_client=tv_simply",
    );
    // A user's unrelated extractor args must survive the rewrite.
    expect(withYoutubePlayerClient("youtube:skip=hls", "mweb")).toBe(
      "youtube:skip=hls;player_client=mweb",
    );
    expect(withYoutubePlayerClient(undefined, "mweb")).toBe("youtube:player_client=mweb");
    expect(withYoutubePlayerClient("", "mweb")).toBe("youtube:player_client=mweb");
  });

  test("a multi-client extractor-args value reaches both yt-dlp and mpv intact", () => {
    const extractorArgs = "youtube:player_client=mweb,tv_simply";

    const args = buildYoutubeYtdlCliArgs({ extractorArgs });
    expect(args).toContain("--extractor-args");
    expect(args).toContain(extractorArgs);

    // mpv sub-option values are length-prefixed; a miscount silently truncates the
    // client list back toward yt-dlp's own default, which is the 403-ing one.
    const joined = joinMpvYtdlRawOptions(buildYoutubeMpvYtdlRawOptions({ extractorArgs }));
    expect(joined).toContain(`extractor-args=%${extractorArgs.length}%${extractorArgs}`);
  });
});
