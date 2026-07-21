import { describe, expect, test } from "bun:test";

import {
  parseBrowseFilterQuery,
  processBrowseSearchResults,
  reconcileBrowseSearchFilterBadges,
} from "@/app-shell/browse-filters";
import {
  browseLibraryFilterAvailability,
  buildLocalFilterFacts,
} from "@/app/search/browse-local-filter-facts";

describe("library filter facts", () => {
  test("downloaded filter uses structured facts, not detail substrings", () => {
    const options = [
      {
        value: "a",
        label: "Has word downloaded in overview only",
        detail: "downloaded somewhere in text",
        previewMeta: ["Series"],
        localFilterFacts: { mediaType: "series" as const, downloaded: false },
      },
      {
        value: "b",
        label: "Actually offline",
        previewMeta: ["Series"],
        localFilterFacts: { mediaType: "series" as const, downloaded: true },
      },
    ];

    const processed = processBrowseSearchResults(
      {
        options: options as any,
        upstreamFilterBadges: ["type series"],
        localFilterBadges: [],
        unsupportedFilterBadges: ["downloaded true"],
      },
      parseBrowseFilterQuery("downloaded:true"),
    );
    expect(processed.options.map((o) => o.value)).toEqual(["b"]);
    expect(processed.localFilterBadges).toContain("downloaded true");
    expect(processed.unsupportedFilterBadges).not.toContain("downloaded true");
  });

  test("reconcileBrowseSearchFilterBadges promotes library keys when facts exist", () => {
    const reconciled = reconcileBrowseSearchFilterBadges(
      parseBrowseFilterQuery("downloaded:true").filters,
      [
        {
          value: "offline",
          label: "Offline title",
          localFilterFacts: { downloaded: true },
        },
      ] as any,
      {
        upstreamFilterBadges: [],
        localFilterBadges: [],
        unsupportedFilterBadges: ["downloaded true"],
      },
    );
    expect(reconciled.localFilterBadges).toEqual(["downloaded true"]);
    expect(reconciled.unsupportedFilterBadges).toEqual([]);
  });

  test("buildLocalFilterFacts maps history + offline badges", () => {
    const facts = buildLocalFilterFacts({
      result: {
        type: "series",
        year: "2024",
      },
      historyEntry: {
        titleId: "t1",
        positionSeconds: 120,
        durationSeconds: 1400,
        completed: false,
      } as any,
      enrichmentBadges: [{ label: "downloaded", tone: "success" }],
    });
    expect(facts).toMatchObject({
      downloaded: true,
      watched: "watching",
    });
  });

  test("browseLibraryFilterAvailability gates release chips on calendar context", () => {
    expect(
      browseLibraryFilterAvailability({
        downloadsEnabled: false,
        calendarReleaseContext: true,
      }),
    ).toMatchObject({
      watched: true,
      downloaded: false,
      release: true,
    });
    expect(
      browseLibraryFilterAvailability({
        downloadsEnabled: true,
        calendarReleaseContext: false,
      }),
    ).toMatchObject({
      watched: true,
      downloaded: true,
      release: false,
    });
  });
});
