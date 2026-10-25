import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { TerminalCommandPalette } from "../components/home/terminal-command-palette";
import type { HomeCommandMetadata } from "../components/home/types";

function markup(commands: readonly HomeCommandMetadata[]) {
  return renderToStaticMarkup(
    <TerminalCommandPalette
      open
      commands={commands}
      selectedIndex={0}
      searchQuery="missing"
      inputRef={{ current: null }}
      onSearchChange={() => {}}
      onSelectIndex={() => {}}
      onRun={() => {}}
    />,
  );
}

test("empty palette retains its combobox and announces no matches outside the listbox", () => {
  const html = markup([]);
  expect(html).toContain('role="combobox"');
  expect(html).not.toContain("aria-activedescendant=");
  expect(html).toMatch(/<span[^>]*role="status"[^>]*>No matching commands<\/span>/);
  const list = html.match(/<span[^>]*role="listbox"[^>]*>(.*?)<\/span>/s)?.[1];
  expect(list).toBe("");
});

test("palette options use virtual focus from the query input", () => {
  const html = markup([{ id: "help", label: "Help", description: "Show commands" }]);
  expect(html).toContain('aria-activedescendant="palette-cmd-help"');
  expect(html).toContain('role="option"');
  expect(html).toContain('tabindex="-1"');
  expect(html).not.toContain("No matching commands");
});
