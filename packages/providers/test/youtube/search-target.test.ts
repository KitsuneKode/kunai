import { describe, expect, test } from "bun:test";

import { mapYtDlpLiveStatus, youtubeSearchTarget } from "../../src/youtube/direct";

describe("youtubeSearchTarget", () => {
  test("an ordinary query uses ytsearch", () => {
    expect(youtubeSearchTarget("lofi beats", undefined)).toBe("ytsearch12:lofi beats");
    expect(youtubeSearchTarget("lofi beats", "video")).toBe("ytsearch12:lofi beats");
    expect(youtubeSearchTarget("lofi beats", "playlist")).toBe("ytsearch12:lofi beats");
    expect(youtubeSearchTarget("lofi beats", "channel")).toBe("ytsearch12:lofi beats");
  });

  test("a Shorts query uses YouTube's own Shorts filter instead", () => {
    // `ytsearch:` runs the ordinary search, which excludes Shorts outright: a probe of
    // `ytsearch12:cooking` returned twelve entries and not one carried a Shorts signal,
    // so `type:short` could only filter itself down to nothing. The results page with
    // `sp=EgIYAQ%3D%3D` is the filter YouTube itself uses.
    const target = youtubeSearchTarget("cooking", "short");
    expect(target).toBe("https://www.youtube.com/results?search_query=cooking&sp=EgIYAQ%3D%3D");
    expect(target.startsWith("ytsearch")).toBe(false);
  });

  test("a Shorts query is percent-encoded, so spaces and symbols cannot break the URL", () => {
    expect(youtubeSearchTarget("air fryer & rice", "short")).toBe(
      "https://www.youtube.com/results?search_query=air%20fryer%20%26%20rice&sp=EgIYAQ%3D%3D",
    );
  });
});

describe("mapYtDlpLiveStatus", () => {
  test("maps yt-dlp's closed live_status vocabulary", () => {
    // Both call sites pass raw `live_status` straight from `yt-dlp -J`, whose values
    // are exactly these. Bare "live"/"upcoming" come from the Invidious and Piped
    // mappers and are handled there, so accepting them here would be unreachable.
    expect(mapYtDlpLiveStatus(undefined, "is_live")).toBe("live");
    expect(mapYtDlpLiveStatus(undefined, "is_upcoming")).toBe("upcoming");
    expect(mapYtDlpLiveStatus(undefined, "was_live")).toBe("post_live");
    expect(mapYtDlpLiveStatus(undefined, "post_live")).toBe("post_live");
    expect(mapYtDlpLiveStatus(undefined, "not_live")).toBe("none");
    expect(mapYtDlpLiveStatus(undefined, undefined)).toBe("none");
  });

  test("the boolean is_live flag alone still reports live", () => {
    // `--flat-playlist` entries can carry `is_live` without a `live_status`.
    expect(mapYtDlpLiveStatus(true, undefined)).toBe("live");
    expect(mapYtDlpLiveStatus(false, undefined)).toBe("none");
  });

  test("casing and surrounding whitespace do not change the answer", () => {
    expect(mapYtDlpLiveStatus(undefined, "  IS_LIVE  ")).toBe("live");
  });
});
