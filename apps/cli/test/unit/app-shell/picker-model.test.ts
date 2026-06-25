import { describe, expect, test } from "bun:test";

import {
  buildCommandPickerModel,
  getCommandAutocompleteTarget,
  getHighlightedCommand,
} from "@/app-shell/shell-command-model";
import type { ResolvedAppCommand } from "@/domain/session/command-registry";
import {
  buildPickerModel,
  movePickerModelSelection,
  selectPickerModelValue,
} from "@/domain/session/picker-model";

const commands: readonly ResolvedAppCommand[] = [
  {
    id: "filters",
    label: "Search Filters",
    aliases: ["filters"],
    description: "Show supported search filter syntax",
    enabled: true,
  },
  {
    id: "setup",
    label: "Setup Wizard",
    aliases: ["setup"],
    description: "Configure Kunai",
    enabled: true,
  },
  {
    id: "download",
    label: "Download",
    aliases: ["download"],
    description: "Queue current item",
    enabled: true,
  },
  {
    id: "history",
    label: "History",
    aliases: ["history"],
    description: "Open history",
    enabled: true,
  },
];

describe("picker model", () => {
  test("orders grouped rows and selectable options from the same model", () => {
    const model = buildPickerModel({
      selectedIndex: 0,
      groupOrder: ["context", "global"],
      groupLabels: { context: "Context", global: "Global" },
      options: [
        { id: "setup", value: "setup", label: "Setup", group: "global" },
        { id: "download", value: "download", label: "Download", group: "context" },
      ],
    });

    expect(model.options.map((option) => option.value)).toEqual(["download", "setup"]);
    expect(model.rows.map((row) => (row.type === "group" ? row.label : row.option.value))).toEqual([
      "Context",
      "download",
      "Global",
      "setup",
    ]);
    expect(selectPickerModelValue(model)).toBe("download");
  });

  test("moves selection inside selectable options only", () => {
    const model = buildPickerModel({
      selectedIndex: 0,
      options: [
        { id: "a", value: "a", label: "A" },
        { id: "b", value: "b", label: "B" },
      ],
    });

    expect(movePickerModelSelection(model, 1)).toBe(1);
    expect(movePickerModelSelection(model, -1)).toBe(1);
  });
});

describe("command picker model", () => {
  test("keeps first visible grouped command as the selected command", () => {
    const model = buildCommandPickerModel("", commands, 0);

    expect(model.options.map((option) => option.value)).toEqual([
      "download",
      "filters",
      "setup",
      "history",
    ]);
    expect(model.rows[0]).toMatchObject({ type: "group", label: "Context" });
    expect(model.rows[1]).toMatchObject({
      type: "item",
      option: expect.objectContaining({ value: "download" }),
      selected: true,
    });
    expect(getHighlightedCommand("", commands, 0)?.id).toBe("download");
  });

  test("filtered commands keep matching order without grouping", () => {
    const model = buildCommandPickerModel("hist", commands, 0);

    expect(model.options.map((option) => option.value)[0]).toBe("history");
    expect(model.rows[0]).toMatchObject({
      type: "item",
      option: expect.objectContaining({ value: "history" }),
      selected: true,
    });
    expect(getHighlightedCommand("hist", commands, 0)?.id).toBe("history");
  });

  test("filtered commands rank alias and label matches above fuzzy description matches", () => {
    const model = buildCommandPickerModel("his", commands, 0);

    expect(model.options[0]?.value).toBe("history");
    expect(getHighlightedCommand("his", commands, 0)?.id).toBe("history");
  });

  test("tab completion completes the current best match before cycling", () => {
    const calendarCommand: ResolvedAppCommand = {
      id: "calendar",
      label: "Release Calendar",
      aliases: ["calendar", "schedule"],
      description: "Anime and series release schedule",
      enabled: true,
    };
    const playlistCommand: ResolvedAppCommand = {
      id: "playlists",
      label: "Playlists",
      aliases: ["playlists", "playlist"],
      description: "Manage durable playlists",
      enabled: true,
    };

    expect(getCommandAutocompleteTarget("cal", [playlistCommand, calendarCommand], 0)?.id).toBe(
      "calendar",
    );
  });

  test("primary command prefixes beat shorter secondary aliases", () => {
    const settingsCommand: ResolvedAppCommand = {
      id: "settings",
      label: "Settings",
      aliases: ["settings", "config", "prefs"],
      description: "Open settings",
      enabled: true,
    };
    const continueCommand: ResolvedAppCommand = {
      id: "continue",
      label: "Continue Watching",
      aliases: ["continue", "c"],
      description: "Open unfinished and recent watch progress",
      enabled: true,
    };

    const model = buildCommandPickerModel("/con", [settingsCommand, continueCommand], 0);

    expect(model.options[0]?.value).toBe("continue");
    expect(getCommandAutocompleteTarget("/con", [settingsCommand, continueCommand], 0)?.id).toBe(
      "continue",
    );
  });
});
