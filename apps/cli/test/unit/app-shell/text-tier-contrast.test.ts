import { describe, expect, test } from "bun:test";

import { resolveDesignTokens } from "@kunai/design";

/**
 * Text tiers are held to APCA lightness contrast, not WCAG alone: on a dark ground a tier can clear
 * 4.5:1 and still be barely readable (the old `muted` was 5.9:1 and |Lc| 41). The targets are the
 * body-text floor (75), label text (60), and hints and pending steps (45).
 */
const TARGETS = { textDim: 75, muted: 60, dim: 45 } as const;

// APCA-W3 0.0.98G-4g (SA98G), the algorithm `apca-w3` implements. Only light-on-dark is needed here.
function luminance(hex: string): number {
  const channel = (offset: number) =>
    (Number.parseInt(hex.slice(offset, offset + 2), 16) / 255) ** 2.4;
  return 0.2126729 * channel(1) + 0.7151522 * channel(3) + 0.072175 * channel(5);
}

function lc(foreground: string, background: string): number {
  const clamp = (y: number) => (y > 0.022 ? y : y + (0.022 - y) ** 1.414);
  const text = clamp(luminance(foreground));
  const ground = clamp(luminance(background));
  if (Math.abs(ground - text) < 0.0005) return 0;
  const sapc = (ground ** 0.65 - text ** 0.62) * 1.14;
  return sapc > -0.1 ? 0 : Math.abs((sapc + 0.027) * 100);
}

describe("lc", () => {
  // Reference values measured with apca-w3 for the Sakura canvas (#100b0f).
  test.each([
    ["#bcafbe", 61.0],
    ["#a292a5", 45.9],
    ["#665b69", 19.7],
  ])("agrees with apca-w3 for %s on the canvas", (foreground, expected) => {
    expect(lc(foreground, "#100b0f")).toBeCloseTo(expected, 0);
  });
});

describe.each(["truecolor", "256"] as const)("text tiers at %s color", (level) => {
  const tokens = resolveDesignTokens(level);

  test.each(Object.entries(TARGETS))(
    "%s reaches Lc %d on the canvas and the panel",
    (tier, minimum) => {
      const foreground = tokens[tier as keyof typeof TARGETS];
      expect(lc(foreground, tokens.bg)).toBeGreaterThanOrEqual(minimum);
      expect(lc(foreground, tokens.surface)).toBeGreaterThanOrEqual(minimum);
    },
  );

  test("the ramp keeps its order: text, textDim, muted, dim", () => {
    const ladder = [tokens.text, tokens.textDim, tokens.muted, tokens.dim].map((hex) =>
      lc(hex, tokens.bg),
    );
    expect(ladder).toEqual([...ladder].sort((a, b) => b - a));
  });
});
