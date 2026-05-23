import { describe, expect, test } from "bun:test";

import { buildTrackCapabilities } from "@/domain/playback/track-capabilities";
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
