import { describe, expect, test } from "bun:test";

import { usesProviderNativeEpisodeCatalog } from "@/domain/media/provider-native-episodes";

describe("usesProviderNativeEpisodeCatalog", () => {
  test("treats youtube channels and playlists as provider-native catalogs", () => {
    expect(usesProviderNativeEpisodeCatalog("youtube", "youtube-channel:UC123")).toBe(true);
    expect(usesProviderNativeEpisodeCatalog("youtube", "youtube-playlist:PL123")).toBe(true);
    expect(usesProviderNativeEpisodeCatalog("youtube", "youtube:dQw4w9WgXcQ")).toBe(false);
    expect(usesProviderNativeEpisodeCatalog("series", "youtube-channel:UC123")).toBe(false);
  });
});
