import { describe, expect, test } from "bun:test";

import { applyBrowseResultFilters, parseBrowseFilterQuery } from "@/app-shell/browse-filters";
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

    const filtered = applyBrowseResultFilters(
      options as any,
      parseBrowseFilterQuery("downloaded:true").filters,
    );
    expect(filtered.map((o) => o.value)).toEqual(["b"]);
  });

  test("buildLocalFilterFacts maps history + offline badges", () => {
    const facts = buildLocalFilterFacts({
      result: {
        type: "series",
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

  test("browseLibraryFilterAvailability hides offline chips when downloads disabled", () => {
    expect(
      browseLibraryFilterAvailability({ downloadsEnabled: false, sessionMode: "anime" }),
    ).toMatchObject({
      watched: true,
      downloaded: false,
      release: true,
    });
    expect(
      browseLibraryFilterAvailability({ downloadsEnabled: true, sessionMode: "youtube" }),
    ).toMatchObject({
      watched: true,
      downloaded: true,
      release: false,
    });
  });
});
