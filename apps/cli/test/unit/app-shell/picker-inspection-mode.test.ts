import { describe, expect, test } from "bun:test";

import { createPickerState } from "@/app-shell/picker-controller";
import { resolvePickerInspectionMode } from "@/app-shell/picker-overlay";

describe("resolvePickerInspectionMode", () => {
  test("renders a single provider-exposed option as a fact row", () => {
    const state = createPickerState({
      id: "quality",
      title: "Choose quality",
      subtitle: "1 quality option available",
      options: [{ value: "auto", label: "Auto", detail: "adaptive provider default" }],
    });

    expect(resolvePickerInspectionMode(state)).toEqual({
      kind: "fact",
      title: "Auto",
      detail: "adaptive provider default",
    });
  });

  test("renders single audio and hardsub capabilities as facts", () => {
    const audio = createPickerState({
      id: "audio",
      title: "Choose audio",
      subtitle: "1 audio option available",
      options: [{ value: "ja", label: "Japanese", badge: "provider default" }],
    });
    const hardsub = createPickerState({
      id: "hardsub",
      title: "Choose hardsub",
      subtitle: "1 hardsub option available",
      options: [{ value: "none", label: "No hardsub", detail: "soft subtitles available" }],
    });

    expect(resolvePickerInspectionMode(audio)).toEqual({
      kind: "fact",
      title: "Japanese",
      detail: "provider default",
    });
    expect(resolvePickerInspectionMode(hardsub)).toEqual({
      kind: "fact",
      title: "No hardsub",
      detail: "soft subtitles available",
    });
  });

  test("keeps unavailable source state explicit with recovery copy", () => {
    const state = createPickerState({
      id: "source",
      title: "Choose source",
      subtitle: "0 sources available",
      options: [],
      emptyMessage: "Provider did not expose alternate sources",
    });

    const mode = resolvePickerInspectionMode(state);

    expect(mode.kind).toBe("unavailable");
    if (mode.kind !== "unavailable") throw new Error("expected unavailable mode");
    expect(mode.model.kind).toBe("error");
    expect(mode.model.title).toBe("Source unavailable");
    expect(mode.model.detail).toContain("Provider did not expose alternate sources");
    expect(mode.model.detail).toContain("recover playback");
    expect(mode.model.actions?.[0]).toMatchObject({ id: "recover", tone: "danger" });
  });

  test("keeps unavailable hardsub state explicit without implying source recovery", () => {
    const state = createPickerState({
      id: "hardsub",
      title: "Choose hardsub",
      subtitle: "0 hardsub options available",
      options: [],
      emptyMessage: "Provider did not expose burned-in subtitle variants",
    });

    const mode = resolvePickerInspectionMode(state);

    expect(mode.kind).toBe("unavailable");
    if (mode.kind !== "unavailable") throw new Error("expected unavailable mode");
    expect(mode.model.title).toBe("Hardsub unavailable");
    expect(mode.model.detail).toContain("Provider did not expose burned-in subtitle variants");
    expect(mode.model.detail).toContain("continue with the current stream defaults");
    expect(mode.model.detail).not.toContain("provider fallback");
  });

  test("distinguishes filtered-empty rows from unavailable capability", () => {
    const state = createPickerState({
      id: "subtitle",
      title: "Choose subtitles",
      subtitle: "2 tracks available",
      filterQuery: "spanish",
      options: [
        { value: "en", label: "English", detail: "external" },
        { value: "ja", label: "Japanese", detail: "embedded" },
      ],
      emptyMessage: "No matching subtitle tracks",
    });

    const mode = resolvePickerInspectionMode(state);

    expect(mode.kind).toBe("unavailable");
    if (mode.kind !== "unavailable") throw new Error("expected unavailable mode");
    expect(mode.model.kind).toBe("empty");
    expect(mode.model.title).toBe("No matching capability");
    expect(mode.model.actions?.[0]).toMatchObject({ id: "clear-filter", shortcut: "esc" });
  });
});
