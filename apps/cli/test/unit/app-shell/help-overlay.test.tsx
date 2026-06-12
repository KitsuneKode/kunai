import { describe, expect, test } from "bun:test";

import { KEYBINDINGS, helpSections } from "@/app-shell/keybindings";
import { buildHelpTabRows, HELP_TABS, helpTabRows } from "@/app-shell/root-overlay-shell";
import React from "react";

import { captureFrame } from "../../harness/render-capture";

// Minimal Ink surface that renders the same {key, desc} rows HelpShell uses.
// Lets the test assert the registry-driven content via captureFrame without
// instantiating the full HelpShell (which needs a Container and overlay
// state context). This is the "no-drift" contract from keybindings.ts:7-9.
function HelpSurface({ tab }: { tab: string }) {
  const rows = buildHelpTabRows(tab);
  return React.createElement(
    "ink-box",
    { flexDirection: "column" },
    ...rows.map((row) =>
      React.createElement(
        "ink-box",
        { key: row.key, flexDirection: "row" },
        React.createElement("ink-text", { key: "k" }, row.key),
        React.createElement("ink-text", { key: "d" }, row.desc),
      ),
    ),
  );
}

describe("help overlay is registry-driven (P0-5)", () => {
  test("HELP_TABS equals the registry's groups, in registry order", () => {
    const registryGroups = helpSections().map((section) => section.group);
    // HELP_TABS is built from helpSections() at module load. The order and
    // contents must match exactly.
    expect([...HELP_TABS]).toEqual(registryGroups);
  });

  test("every live (non-helpOnly) binding label is in some help section", () => {
    const liveBindings = KEYBINDINGS.filter((binding) => !binding.helpOnly);
    const seenLabels = new Set<string>();
    for (const section of helpSections()) {
      for (const item of section.items) {
        seenLabels.add(item.label);
      }
    }
    for (const binding of liveBindings) {
      expect(seenLabels.has(binding.label)).toBe(true);
    }
  });

  test("every binding label is reachable through the rendered help tabs", () => {
    // Render every tab and collect the labels that actually appear. The
    // promise from keybindings.ts:7-9 is "what is documented can never
    // drift from the keys that are actually bound." This test makes that
    // promise a hard guarantee.
    const rendered = new Set<string>();
    for (const tab of HELP_TABS) {
      const frame = captureFrame(React.createElement(HelpSurface, { tab }), { columns: 140 });
      for (const binding of KEYBINDINGS) {
        if (frame.includes(binding.label)) rendered.add(binding.label);
      }
    }
    const missing = KEYBINDINGS.filter(
      (binding) => !binding.helpOnly && !rendered.has(binding.label),
    );
    expect(missing.map((b) => `${b.id}: ${b.label}`)).toEqual([]);
  });

  test("no tab contains the pre-fix hard-coded /discover lie", () => {
    // The pre-fix HELP_TAB_ROWS listed "/discover: recommendations" while
    // the live /discover command routes to a flat search-results list. The
    // registry-derived rows must not repeat that misleading copy.
    for (const tab of HELP_TABS) {
      const rows = helpTabRows(tab);
      for (const row of rows) {
        expect(`${row.key} ${row.desc}`).not.toContain("/discover: recommendations");
      }
    }
  });

  test("binding keys are unique within a section", () => {
    for (const section of helpSections()) {
      const keys = section.items.map((item) => item.keys);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  test("helpTabRows is total over HELP_TABS (every tab has at least one row)", () => {
    for (const tab of HELP_TABS) {
      const rows = helpTabRows(tab);
      // Every group in the registry has at least one binding, so every
      // tab must have at least one row. If a future binding is added with
      // a new group but no bindings in it, this will fail loudly.
      expect(rows.length).toBeGreaterThan(0);
    }
  });
});
