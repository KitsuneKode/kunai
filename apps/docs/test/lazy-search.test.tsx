import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";

import { LazySearchDialog } from "../components/search/lazy-search-dialog";

const APP_ROOT = path.resolve(import.meta.dir, "..");

describe("lazy search dialog", () => {
  test("renders nothing until search has been opened, so no dialog code ships with the page", () => {
    const html = renderToStaticMarkup(<LazySearchDialog open={false} onOpenChange={() => {}} />);
    expect(html).toBe("");
  });

  test("the root layout never imports the heavy dialog directly", () => {
    // The dialog pulls in the search client and Orama (~265 KB of JavaScript). Imported
    // from the layout it is downloaded and parsed by every page before a key is pressed.
    // Keep it behind LazySearchDialog; if this fails, search went eager again.
    const layout = fs.readFileSync(path.join(APP_ROOT, "app/layout.tsx"), "utf-8");
    expect(layout).not.toMatch(/from\s+"@\/components\/search\/kunai-search-dialog"/);
    expect(layout).toContain("LazySearchDialog");
  });

  test("the lazy wrapper imports the dialog dynamically and not at module top level", () => {
    const lazy = fs.readFileSync(
      path.join(APP_ROOT, "components/search/lazy-search-dialog.tsx"),
      "utf-8",
    );
    expect(lazy).not.toMatch(/^import .* from "\.\/kunai-search-dialog"/m);
    expect(lazy).toContain('import("./kunai-search-dialog")');
  });
});
