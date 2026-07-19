import { expect, test } from "bun:test";

import {
  firstSelectableRowIndex,
  moveSelectedIndex,
  resolveSelectableRowIndex,
} from "@/app-shell/settings/navigation";
import type {
  BuiltSettingsPage,
  BuiltSettingsRow,
  SettingRowDef,
} from "@/app-shell/settings/types";

function row(def: SettingRowDef): BuiltSettingsRow {
  return { def, label: def.label, valueSummary: "", detail: undefined };
}

function pageOf(defs: SettingRowDef[]): BuiltSettingsPage {
  const rows = defs.map(row);
  return {
    title: "Settings",
    subtitle: "",
    rows,
    rowById: new Map(rows.filter((r) => r.def.kind !== "section").map((r) => [r.def.id, r])),
    defById: new Map(defs.filter((d) => d.kind !== "section").map((d) => [d.id, d])),
  };
}

const section: SettingRowDef = {
  kind: "section",
  id: "section:general",
  label: "General",
  layout: "standard",
};

const first: SettingRowDef = {
  kind: "boolean",
  id: "alpha",
  label: "Alpha",
  read: () => true,
  write: (config) => config,
};

const second: SettingRowDef = {
  kind: "boolean",
  id: "beta",
  label: "Beta",
  read: () => false,
  write: (config) => config,
};

test("firstSelectableRowIndex skips the section header", () => {
  const page = pageOf([section, first, second]);
  expect(firstSelectableRowIndex(page)).toBe(1);
  expect(resolveSelectableRowIndex(page, 0)).toBe(1);
  expect(resolveSelectableRowIndex(page, 1)).toBe(1);
});

test("moveSelectedIndex from section header lands on the first setting", () => {
  const page = pageOf([section, first, second]);
  expect(moveSelectedIndex(page, 0, 1)).toBe(1);
});
