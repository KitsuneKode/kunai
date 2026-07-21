import { describe, expect, test } from "bun:test";

import type { BrowseLibraryFilterAvailability } from "@/app/search/browse-local-filter-facts";
import { buildSearchFilterChipOptions } from "@/app/search/search-filter-chips";
import type { ShellMode } from "@/domain/types";

const FULL_LIBRARY: BrowseLibraryFilterAvailability = {
  watched: true,
  downloaded: true,
  release: true,
};
const BARE_LIBRARY: BrowseLibraryFilterAvailability = {
  watched: true,
  downloaded: false,
  release: false,
};

function values(sessionMode: ShellMode, library: BrowseLibraryFilterAvailability = FULL_LIBRARY) {
  return buildSearchFilterChipOptions({ sessionMode, library })
    .map((option) => option.value)
    .filter((value): value is string => value !== null);
}

describe("buildSearchFilterChipOptions", () => {
  test("only surfaces YouTube content-shape type facets in YouTube mode", () => {
    const youtube = values("youtube");
    expect(youtube).toContain("type:video");
    expect(youtube).toContain("type:playlist");
    expect(youtube).toContain("type:channel");
    expect(youtube).not.toContain("type:movie");
    expect(youtube).not.toContain("type:series");
  });

  test("only surfaces catalog media types outside YouTube mode", () => {
    const series = values("series");
    expect(series).toContain("type:movie");
    expect(series).toContain("type:series");
    expect(series).not.toContain("type:playlist");
    expect(series).not.toContain("type:video");
    expect(series).not.toContain("type:channel");
  });

  test("omits the cross-mode switch for the mode you are already in", () => {
    expect(values("anime")).not.toContain("mode:anime");
    expect(values("anime")).toContain("mode:youtube");
    expect(values("youtube")).not.toContain("mode:youtube");
    expect(values("youtube")).toContain("mode:anime");
  });

  test("gates library facets on availability", () => {
    const bare = values("series", BARE_LIBRARY);
    expect(bare).not.toContain("downloaded:true");
    expect(bare).not.toContain("release:today");

    const full = values("series", FULL_LIBRARY);
    expect(full).toContain("downloaded:true");
    expect(full).toContain("release:today");
    expect(full).toContain("watched:watching");
  });

  test("always ends with a Cancel option", () => {
    const options = buildSearchFilterChipOptions({ sessionMode: "series", library: BARE_LIBRARY });
    expect(options.at(-1)).toEqual({ value: null, label: "Cancel", detail: "" });
  });
});
