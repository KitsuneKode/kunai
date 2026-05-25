import { describe, expect, test } from "bun:test";

import {
  anyTrackSelectable,
  buildTrackCapabilities,
  buildTrackPanelRows,
  decodeTrackSelection,
  encodeTrackSelection,
  initialSelectableIndexForSection,
  selectableCapabilityAt,
  selectableTrackCount,
} from "@/domain/playback/track-capabilities";
import type {
  PlaybackQualityOptionView,
  PlaybackSourceGroupView,
  PlaybackSourceInventoryView,
  PlaybackSubtitleOptionView,
} from "@/services/playback/PlaybackSourceInventoryView";
import type { ProviderId } from "@kunai/types";

const PROVIDER = "vidking" as ProviderId;

function sourceGroup(over: Partial<PlaybackSourceGroupView>): PlaybackSourceGroupView {
  return {
    id: "src-1",
    label: "mb-flix",
    state: "available",
    providerId: PROVIDER,
    sourceIds: ["s1"],
    streamIds: ["st1"],
    nativeLabels: [],
    audioLanguages: [],
    subtitleLanguages: [],
    candidateCount: 1,
    hints: [],
    ...over,
  };
}

function quality(over: Partial<PlaybackQualityOptionView>): PlaybackQualityOptionView {
  return {
    id: "q-1080",
    label: "1080p",
    state: "available",
    sourceIds: ["s1"],
    streamIds: ["st1"],
    candidateCount: 1,
    restartRequired: false,
    hints: [],
    ...over,
  };
}

function subtitle(over: Partial<PlaybackSubtitleOptionView>): PlaybackSubtitleOptionView {
  return {
    id: "sub-en",
    label: "English",
    state: "available",
    delivery: "external",
    nativeLabels: [],
    sourceIds: ["s1"],
    streamIds: ["st1"],
    subtitleIds: ["su1"],
    candidateCount: 1,
    restartRequired: false,
    ...over,
  };
}

function view(over: Partial<PlaybackSourceInventoryView>): PlaybackSourceInventoryView {
  return {
    providerId: PROVIDER,
    status: "resolved",
    sourceGroups: [],
    languageOptions: [],
    qualityOptions: [],
    subtitleOptions: [],
    recoveryActions: [],
    warnings: [],
    ...over,
  };
}

describe("buildTrackCapabilities", () => {
  test("returns nothing for a missing view", () => {
    expect(buildTrackCapabilities(null)).toEqual([]);
    expect(buildTrackCapabilities(undefined)).toEqual([]);
  });

  test("groups rows into ordered sections and skips empty sections", () => {
    const groups = buildTrackCapabilities(
      view({
        sourceGroups: [
          sourceGroup({ state: "selected" }),
          sourceGroup({ id: "src-2", label: "mirror" }),
        ],
        qualityOptions: [quality({ state: "selected" }), quality({ id: "q-720", label: "720p" })],
      }),
    );
    expect(groups.map((g) => g.section)).toEqual(["source", "quality"]);
    expect(groups[0]?.title).toBe("Source");
  });

  test("marks the current row selected and only switchable alternatives enabled", () => {
    const [source] = buildTrackCapabilities(
      view({
        sourceGroups: [
          sourceGroup({ id: "a", state: "selected" }),
          sourceGroup({ id: "b", state: "available" }),
        ],
      }),
    );
    const current = source?.rows.find((r) => r.value === "a");
    const alt = source?.rows.find((r) => r.value === "b");
    expect(current?.selected).toBe(true);
    expect(current?.enabled).toBe(false); // current is a fact, not a switch target
    expect(alt?.enabled).toBe(true);
    expect(source?.selectable).toBe(true);
  });

  test("a single-option section is not selectable (renders as facts)", () => {
    const [source] = buildTrackCapabilities(
      view({ sourceGroups: [sourceGroup({ state: "selected" })] }),
    );
    expect(source?.selectable).toBe(false);
    expect(source?.rows[0]?.enabled).toBe(false);
  });

  test("maps inventory state to risk", () => {
    const [source] = buildTrackCapabilities(
      view({
        sourceGroups: [
          sourceGroup({ id: "f", state: "failed" }),
          sourceGroup({ id: "s", state: "skipped" }),
          sourceGroup({ id: "d", state: "disabled", disabledReason: "geo-blocked" }),
        ],
      }),
    );
    expect(source?.rows.find((r) => r.value === "f")?.risk).toBe("failed");
    expect(source?.rows.find((r) => r.value === "s")?.risk).toBe("fallback");
    const disabled = source?.rows.find((r) => r.value === "d");
    expect(disabled?.risk).toBe("unavailable");
    expect(disabled?.reason).toBe("geo-blocked");
  });

  test("subtitles are informational unless the backend exposes a pre-play choice", () => {
    const informational = buildTrackCapabilities(
      view({ subtitleOptions: [subtitle({ restartRequired: false })] }),
    )[0];
    expect(informational?.selectable).toBe(false);
    expect(informational?.rows[0]?.enabled).toBe(false);
    expect(informational?.rows[0]?.reason).toContain("mpv");

    const preplay = buildTrackCapabilities(
      view({ subtitleOptions: [subtitle({ restartRequired: true, state: "available" })] }),
    )[0];
    expect(preplay?.rows[0]?.enabled).toBe(true);
    expect(preplay?.selectable).toBe(true);
  });
});

describe("track selection encoding", () => {
  test("round-trips section and value, including values containing colons", () => {
    const encoded = encodeTrackSelection("subtitle", "https://cdn/sub.vtt?x=1");
    const decoded = decodeTrackSelection(encoded);
    expect(decoded).toEqual({ section: "subtitle", value: "https://cdn/sub.vtt?x=1" });
  });

  test("rejects malformed or unknown-section payloads", () => {
    expect(decodeTrackSelection("no-delimiter")).toBeNull();
    expect(decodeTrackSelection(encodeTrackSelection("source", ""))).toBeNull();
    expect(decodeTrackSelection("bogusvalue")).toBeNull();
  });
});

describe("track panel rows + navigation", () => {
  const groups = buildTrackCapabilities(
    view({
      sourceGroups: [
        sourceGroup({ id: "a", state: "selected" }),
        sourceGroup({ id: "b", state: "available" }),
        sourceGroup({ id: "c", state: "failed" }),
      ],
      qualityOptions: [
        quality({ id: "q1080", state: "selected" }),
        quality({ id: "q720", label: "720p", state: "available" }),
      ],
    }),
  );

  test("flattens into headers + rows with contiguous selectable indices", () => {
    const rows = buildTrackPanelRows(groups);
    expect(rows.filter((r) => r.kind === "header").map((r) => r.group.section)).toEqual([
      "source",
      "quality",
    ]);
    const selectable = rows.filter((r) => r.kind === "row" && r.selectableIndex !== undefined);
    // b (source) + q720 (quality) are the only switchable rows.
    expect(selectable.map((r) => (r.kind === "row" ? r.selectableIndex : -1))).toEqual([0, 1]);
    expect(selectableTrackCount(groups)).toBe(2);
    expect(anyTrackSelectable(groups)).toBe(true);
  });

  test("deep-links to the first switchable row of a section", () => {
    expect(initialSelectableIndexForSection(groups, "source")).toBe(0);
    expect(initialSelectableIndexForSection(groups, "quality")).toBe(1);
    expect(initialSelectableIndexForSection(groups, "audio")).toBe(0);
    expect(initialSelectableIndexForSection(groups)).toBe(0);
  });

  test("resolves the capability at a selectable index", () => {
    expect(selectableCapabilityAt(groups, 0)?.value).toBe("b");
    expect(selectableCapabilityAt(groups, 1)?.value).toBe("q720");
    expect(selectableCapabilityAt(groups, 2)).toBeNull();
  });

  test("a fact-only inventory has no selectable rows", () => {
    const factGroups = buildTrackCapabilities(
      view({ sourceGroups: [sourceGroup({ state: "selected" })] }),
    );
    expect(anyTrackSelectable(factGroups)).toBe(false);
    expect(selectableCapabilityAt(factGroups, 0)).toBeNull();
  });
});
