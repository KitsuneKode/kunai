import { describe, expect, test } from "bun:test";

import {
  buildPreviewRailModelFromBrowseOption,
  filterBrowseOptionsByResultFilter,
} from "@/app-shell/browse-preview-rail";
import type { BrowseShellOption } from "@/app-shell/types";

describe("buildPreviewRailModelFromBrowseOption", () => {
  test("uses title weight and omits provider-only facts from the rail", () => {
    const option: BrowseShellOption<string> = {
      value: "demo",
      label: "Demon Slayer (2019)",
      previewTitle: "Demon Slayer",
      previewMeta: ["Series", "2019"],
      previewBadge: "resume",
      previewBody: "A young swordsman joins the demon slayer corps.",
      previewNote: "Press Enter to open this title.",
      previewFacts: [
        { label: "Local progress", detail: "S01E03 · 40%", tone: "warning" },
        { label: "Metadata source", detail: "provider response", tone: "neutral" },
      ],
    };

    const model = buildPreviewRailModelFromBrowseOption(option, "none");
    expect(model?.title).toBe("Demon Slayer");
    expect(model?.subtitle).toContain("2019");
    expect(model?.facts.some((fact) => fact.label === "Metadata source")).toBe(false);
    expect(model?.facts.find((fact) => fact.label === "Status")?.value).toBe("resume");
  });
});

describe("filterBrowseOptionsByResultFilter", () => {
  test("narrows visible rows without mutating the source list", () => {
    const options: BrowseShellOption<string>[] = [
      { value: "1", label: "Frieren", previewTitle: "Frieren" },
      { value: "2", label: "Chainsaw Man", previewTitle: "Chainsaw Man" },
    ];
    const filtered = filterBrowseOptionsByResultFilter(options, "frieren");
    expect(filtered).toHaveLength(1);
    expect(options).toHaveLength(2);
  });
});
