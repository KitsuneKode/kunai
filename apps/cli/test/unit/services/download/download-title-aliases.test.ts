import { describe, expect, test } from "bun:test";

import { downloadTitleAliases } from "@/services/download/DownloadService";

describe("downloadTitleAliases", () => {
  test("indexes every catalog id the title arrived with", () => {
    // The raw alias id is what matters: ("tmdb", "1339713") is what lets a
    // later lookup on the bare id "1339713" reach the canonical "tmdb:1339713".
    expect(
      downloadTitleAliases({ id: "1339713", externalIds: { tmdbId: "1339713" } }, "videasy"),
    ).toEqual([{ ns: "tmdb", id: "1339713" }]);
  });

  test("indexes an opaque provider-native id under its provider namespace", () => {
    expect(
      downloadTitleAliases({ id: "ReooPAxPMsHM4KPMY", externalIds: undefined }, "allmanga"),
    ).toEqual([{ ns: "provider:allmanga", id: "ReooPAxPMsHM4KPMY" }]);
  });

  test("does not launder a numeric catalog id into a provider alias", () => {
    // A bare numeric id is a catalog id, not an opaque provider handle;
    // indexing it under `provider:` would collide across providers.
    expect(downloadTitleAliases({ id: "21", externalIds: { malId: "21" } }, "allmanga")).toEqual([
      { ns: "mal", id: "21" },
    ]);
  });

  test("answers empty for a title carrying nothing indexable", () => {
    expect(downloadTitleAliases({ id: "1339713", externalIds: undefined }, "videasy")).toEqual([]);
  });
});
