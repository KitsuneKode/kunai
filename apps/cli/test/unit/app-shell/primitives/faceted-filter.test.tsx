import { describe, expect, test } from "bun:test";

import {
  buildStreamFacetedCategories,
  clearAllFacets,
  clearCategoryFacets,
  createInitialFacetedFilterState,
  filterCategoriesByQuery,
  formatFacetCategoryBadge,
  getActiveFacetCounts,
  isFacetOptionSelected,
  toggleFacetOption,
  type FacetedFilterCategory,
} from "@/app-shell/primitives/faceted-filter.model";
import { FacetedFilterModal } from "@/app-shell/primitives/FacetedFilterModal";
import { FacetedFilterPills } from "@/app-shell/primitives/FacetedFilterPills";
import React from "react";

import { captureFrame } from "../../../harness/render-capture";

const SAMPLE_CATEGORIES: readonly FacetedFilterCategory<string>[] = [
  {
    id: "quality",
    title: "Quality",
    options: [
      { value: "1080p", label: "1080p", count: 4 },
      { value: "720p", label: "720p", count: 2 },
      { value: "480p", label: "480p", count: 1 },
    ],
  },
  {
    id: "audio",
    title: "Audio",
    options: [
      { value: "ja", label: "Japanese", count: 5 },
      { value: "en", label: "English", count: 2 },
    ],
  },
];

describe("Faceted Filter Model", () => {
  test("initializes empty and with seed selections", () => {
    const emptyState = createInitialFacetedFilterState();
    expect(emptyState.selected.size).toBe(0);

    const seededState = createInitialFacetedFilterState({
      quality: ["1080p", "720p"],
      audio: ["ja"],
    });
    expect(isFacetOptionSelected(seededState, "quality", "1080p")).toBe(true);
    expect(isFacetOptionSelected(seededState, "quality", "720p")).toBe(true);
    expect(isFacetOptionSelected(seededState, "quality", "480p")).toBe(false);
    expect(isFacetOptionSelected(seededState, "audio", "ja")).toBe(true);
  });

  test("toggles options immutably and handles singleSelect mode", () => {
    let state = createInitialFacetedFilterState();
    state = toggleFacetOption(state, "quality", "1080p");
    expect(isFacetOptionSelected(state, "quality", "1080p")).toBe(true);

    state = toggleFacetOption(state, "quality", "720p");
    expect(isFacetOptionSelected(state, "quality", "1080p")).toBe(true);
    expect(isFacetOptionSelected(state, "quality", "720p")).toBe(true);

    // Toggle off
    state = toggleFacetOption(state, "quality", "1080p");
    expect(isFacetOptionSelected(state, "quality", "1080p")).toBe(false);
    expect(isFacetOptionSelected(state, "quality", "720p")).toBe(true);

    // Single select mode
    let singleState = createInitialFacetedFilterState();
    singleState = toggleFacetOption(singleState, "provider", "vidrock", true);
    expect(isFacetOptionSelected(singleState, "provider", "vidrock")).toBe(true);

    singleState = toggleFacetOption(singleState, "provider", "movy", true);
    expect(isFacetOptionSelected(singleState, "provider", "vidrock")).toBe(false);
    expect(isFacetOptionSelected(singleState, "provider", "movy")).toBe(true);
  });

  test("clears category and all facets", () => {
    let state = createInitialFacetedFilterState({
      quality: ["1080p"],
      audio: ["ja"],
    });

    state = clearCategoryFacets(state, "quality");
    expect(isFacetOptionSelected(state, "quality", "1080p")).toBe(false);
    expect(isFacetOptionSelected(state, "audio", "ja")).toBe(true);

    state = clearAllFacets(state);
    expect(state.selected.size).toBe(0);
  });

  test("calculates active facet counts accurately", () => {
    const state = createInitialFacetedFilterState({
      quality: ["1080p", "720p"],
      audio: ["ja"],
    });
    const { total, byCategory } = getActiveFacetCounts(state);
    expect(total).toBe(3);
    expect(byCategory.get("quality")).toBe(2);
    expect(byCategory.get("audio")).toBe(1);
  });

  test("formats facet badge matching shadcn rules", () => {
    const category = SAMPLE_CATEGORIES[0]!;

    expect(formatFacetCategoryBadge(category, new Set())).toBe("");
    expect(formatFacetCategoryBadge(category, new Set(["1080p"]))).toBe("1080p");
    expect(formatFacetCategoryBadge(category, new Set(["1080p", "720p"]))).toBe("1080p, 720p");
    expect(formatFacetCategoryBadge(category, new Set(["1080p", "720p", "480p"]))).toBe(
      "3 selected",
    );
  });

  test("filters categories and options by search query", () => {
    const result = filterCategoriesByQuery(SAMPLE_CATEGORIES, "japan");
    expect(result.length).toBe(1);
    expect(result[0]?.id).toBe("audio");
    expect(result[0]?.options.length).toBe(1);
    expect(result[0]?.options[0]?.value).toBe("ja");

    const emptyResult = filterCategoriesByQuery(SAMPLE_CATEGORIES, "nonexistent");
    expect(emptyResult.length).toBe(0);
  });

  test("buildStreamFacetedCategories extracts accurate live counts", () => {
    const streams = [
      { qualityLabel: "1080p", audioLanguages: ["ja"], providerId: "vidrock", protocol: "hls" },
      { qualityLabel: "1080p", audioLanguages: ["en"], providerId: "vidrock", protocol: "hls" },
      { qualityLabel: "720p", audioLanguages: ["ja"], providerId: "movy", protocol: "mp4" },
    ];

    const categories = buildStreamFacetedCategories(streams);
    const qCat = categories.find((c) => c.id === "quality");
    expect(qCat).toBeDefined();
    expect(qCat?.options.find((o) => o.value === "1080p")?.count).toBe(2);
    expect(qCat?.options.find((o) => o.value === "720p")?.count).toBe(1);

    const aCat = categories.find((c) => c.id === "audio");
    expect(aCat).toBeDefined();
    expect(aCat?.options.find((o) => o.value === "ja")?.count).toBe(2);
    expect(aCat?.options.find((o) => o.value === "en")?.count).toBe(1);

    const pCat = categories.find((c) => c.id === "provider");
    expect(pCat).toBeDefined();
    expect(pCat?.options.find((o) => o.value === "vidrock")?.count).toBe(2);
    expect(pCat?.options.find((o) => o.value === "movy")?.count).toBe(1);
  });
});

describe("Faceted Filter Ink Components", () => {
  test("renders FacetedFilterPills with badge counters", async () => {
    const state = createInitialFacetedFilterState({
      quality: ["1080p", "720p"],
    });

    const frame = await captureFrame(
      <FacetedFilterPills
        categories={SAMPLE_CATEGORIES}
        state={state}
        onClearCategory={() => {}}
        onClearAll={() => {}}
      />,
    );

    expect(frame).toContain("Filter (2)");
    expect(frame).toContain("Quality: 1080p, 720p");
    expect(frame).toContain("[Clear all]");
  });

  test("renders FacetedFilterModal with grouped options and live counts", async () => {
    const state = createInitialFacetedFilterState({
      quality: ["1080p"],
    });

    const frame = await captureFrame(
      <FacetedFilterModal
        categories={SAMPLE_CATEGORIES}
        state={state}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(frame).toContain("Filter options");
    expect(frame).toContain("QUALITY");
    expect(frame).toContain("[✓] 1080p");
    expect(frame).toContain("(4)");
    expect(frame).toContain("[ ] 720p");
    expect(frame).toContain("(2)");
    expect(frame).toContain("AUDIO");
    expect(frame).toContain("Space: toggle");
  });
});
