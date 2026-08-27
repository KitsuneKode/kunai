import { describe, expect, test } from "bun:test";

import { youtubeSearchTarget } from "../../src/youtube/direct";

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
