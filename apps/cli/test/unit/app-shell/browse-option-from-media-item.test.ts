import { describe, expect, test } from "bun:test";

import { browseOptionFromMediaItem } from "@/app-shell/browse-option-from-media-item";

describe("browseOptionFromMediaItem", () => {
  test("maps series episode identity into browse shell option", () => {
    const option = browseOptionFromMediaItem({
      mediaKind: "series",
      titleId: "tmdb:9",
      title: "Details Target",
      season: 1,
      episode: 3,
    });

    expect(option.label).toBe("Details Target");
    expect(option.detail).toBe("S01E03");
    expect(option.value.id).toBe("tmdb:9");
    expect(option.value.type).toBe("series");
    expect(option.value.title).toBe("Details Target");
  });
});
