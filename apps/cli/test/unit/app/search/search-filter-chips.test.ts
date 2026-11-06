import { describe, expect, test } from "bun:test";

import type { BrowseLibraryFilterAvailability } from "@/app/search/browse-local-filter-facts";
import {
  buildSearchFilterChipOptions,
  isFilterChipActive,
  toggleSearchFilterChip,
} from "@/app/search/search-filter-chips";
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
    expect(youtube).toContain("type:live");
    expect(youtube).toContain("type:short");
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

  test("surfaces audio and subtitles language chips", () => {
    const opts = values("anime");
    expect(opts).toContain("audio:en");
    expect(opts).toContain("audio:ja");
    expect(opts).toContain("audio:hi");
    expect(opts).toContain("audio:es");
    expect(opts).toContain("subtitles:en");
    expect(opts).toContain("subtitles:es");
    expect(opts).toContain("subtitles:hi");
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

  test("renders shadcn combobox indicators [✓] and [ ] when currentQuery is supplied", () => {
    const options = buildSearchFilterChipOptions({
      sessionMode: "series",
      library: FULL_LIBRARY,
      currentQuery: "naruto type:movie audio:ja",
    });

    const movieOpt = options.find((o) => o.value === "type:movie");
    expect(movieOpt?.label).toBe("[✓] Type · Movies");
    expect(movieOpt?.detail).toContain("active (select to remove)");

    const seriesOpt = options.find((o) => o.value === "type:series");
    expect(seriesOpt?.label).toBe("[ ] Type · Series");

    const audioJaOpt = options.find((o) => o.value === "audio:ja");
    expect(audioJaOpt?.label).toBe("[✓] Audio · Japanese (Original)");
    expect(audioJaOpt?.detail).toContain("active (select to remove)");

    const audioEnOpt = options.find((o) => o.value === "audio:en");
    expect(audioEnOpt?.label).toBe("[ ] Audio · English (Dub)");
  });
});

describe("isFilterChipActive", () => {
  test("detects active facet tokens in query string", () => {
    expect(isFilterChipActive("naruto type:movie audio:ja", "type:movie")).toBe(true);
    expect(isFilterChipActive("naruto type:movie audio:ja", "type:series")).toBe(false);
    expect(isFilterChipActive("naruto type:movie audio:ja", "audio:ja")).toBe(true);
    expect(isFilterChipActive("naruto type:movie audio:ja", "audio:en")).toBe(false);
    expect(isFilterChipActive("", "type:movie")).toBe(false);
  });
});

describe("toggleSearchFilterChip", () => {
  test("removes an active member of a comma-separated genre facet", () => {
    const query = "naruto genre:action,comedy";
    expect(isFilterChipActive(query, "genre:action")).toBe(true);
    const toggled = toggleSearchFilterChip(query, "genre:action");
    expect(toggled).toBe("naruto genre:comedy");
    expect(isFilterChipActive(toggled, "genre:action")).toBe(false);
    expect(toggleSearchFilterChip(toggled, "genre:comedy")).toBe("naruto");
  });
  test("appends chip to empty query", () => {
    expect(toggleSearchFilterChip("", "type:movie")).toBe("type:movie");
  });

  test("appends chip to free text query", () => {
    expect(toggleSearchFilterChip("naruto", "type:movie")).toBe("naruto type:movie");
  });

  test("toggles off when identical facet is already present", () => {
    expect(toggleSearchFilterChip("naruto type:movie", "type:movie")).toBe("naruto");
    expect(toggleSearchFilterChip("type:movie", "type:movie")).toBe("");
  });

  test("replaces exclusive facet value with new value", () => {
    expect(toggleSearchFilterChip("naruto type:movie", "type:series")).toBe("naruto type:series");
    expect(toggleSearchFilterChip("naruto audio:ja", "audio:en")).toBe("naruto audio:en");
    expect(toggleSearchFilterChip("sort:popular", "sort:rating")).toBe("sort:rating");
  });

  test("allows multiple genre facets and toggles each independently", () => {
    const withAction = toggleSearchFilterChip("naruto", "genre:action");
    expect(withAction).toBe("naruto genre:action");
    const withBoth = toggleSearchFilterChip(withAction, "genre:comedy");
    expect(withBoth).toBe("naruto genre:action genre:comedy");
    const removeAction = toggleSearchFilterChip(withBoth, "genre:action");
    expect(removeAction).toBe("naruto genre:comedy");
  });
});
