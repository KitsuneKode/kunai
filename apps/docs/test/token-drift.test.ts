import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../../..");
const TOKENS_CSS = path.join(ROOT, "apps/docs/app/styles/tokens.css");
const DESIGN_TOKENS = path.join(ROOT, "packages/design/src/tokens.ts");

const EXPECTED_HEX = {
  "--color-fd-background": "#100b0f",
  "--color-fd-card": "#1c1620",
  "--color-fd-primary": "#ff8fb0",
  // Text and control-edge tokens that carry a contrast floor (4.5:1 / 3:1). A silent
  // drift between the CLI palette and the docs would break the floor on one side.
  "--color-fd-muted-foreground": "#beb1c0",
  "--kunai-line-control": "#786782",
  "--kunai-ok": "#54d6a0",
  "--kunai-warning": "#f59a3c",
  "--kunai-danger": "#ff5d5d",
} as const;

function readCssVar(css: string, name: string): string | null {
  const match = css.match(
    new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*([^;]+);`),
  );
  return match?.[1]?.trim() ?? null;
}

describe("docs design token drift", () => {
  test("tokens.css maps core Ember Dusk values from @kunai/design", () => {
    const tokensCss = fs.readFileSync(TOKENS_CSS, "utf-8");
    const designTs = fs.readFileSync(DESIGN_TOKENS, "utf-8");

    for (const [cssVar, hex] of Object.entries(EXPECTED_HEX)) {
      expect(readCssVar(tokensCss, cssVar)).toBe(hex);
      expect(designTs.toLowerCase()).toContain(hex.toLowerCase());
    }
  });
});
