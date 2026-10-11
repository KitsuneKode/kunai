import { describe, expect, test } from "bun:test";

import { resolveDesignTokens } from "@kunai/design";

/**
 * Text tiers are held to APCA lightness contrast, not WCAG alone: on a dark ground a tier can clear
 * 4.5:1 and still be barely readable (the old `muted` was 5.9:1 and |Lc| 41). The targets are the
 * body-text floor (75), label text (60), and hints and pending steps (45).
 */
const TARGETS = { textDim: 75, muted: 60, dim: 45 } as const;
const TIERS = ["textDim", "muted", "dim"] as const;
/** Colored status text is held to the label floor, like the accent, warn and info it sits beside. */
const STATUS_TEXT_TARGET = 60;
const STATUS_TEXT = ["dangerText", "milestoneText"] as const;

// APCA-W3 0.0.98G-4g (SA98G), the algorithm `apca-w3` implements. Only light-on-dark is needed here.
function luminance(hex: string): number {
  const channel = (offset: number) =>
    (Number.parseInt(hex.slice(offset, offset + 2), 16) / 255) ** 2.4;
  return 0.2126729 * channel(1) + 0.7151522 * channel(3) + 0.072175 * channel(5);
}

function lc(foreground: string, background: string): number {
  // eslint-disable-next-line approx-constant -- APCA's published soft-clamp exponent, not √2; Math.SQRT2 would drift from apca-w3
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

  // The ground a row is actually painted on: canvas, panel, and `accentFill`, which is what every
  // selected row, tab and picker option uses (the one `surfaceActive` consumer is a single card).
  const grounds = { canvas: tokens.bg, panel: tokens.surface, "selected row": tokens.accentFill };

  for (const tier of TIERS) {
    test(`${tier} reaches its Lc target on every ground`, () => {
      for (const [name, ground] of Object.entries(grounds)) {
        expect(lc(tokens[tier], ground), `${tier} on ${name}`).toBeGreaterThanOrEqual(
          TARGETS[tier],
        );
      }
    });
  }

  for (const role of STATUS_TEXT) {
    test(`${role} reaches Lc ${STATUS_TEXT_TARGET} on every ground`, () => {
      for (const [name, ground] of Object.entries(grounds)) {
        expect(lc(tokens[role], ground), `${role} on ${name}`).toBeGreaterThanOrEqual(
          STATUS_TEXT_TARGET,
        );
      }
    });
  }

  test("the ramp keeps its order: text, textDim, muted, dim", () => {
    const ladder = [tokens.text, tokens.textDim, tokens.muted, tokens.dim].map((hex) =>
      lc(hex, tokens.bg),
    );
    expect(ladder).toEqual([...ladder].sort((a, b) => b - a));
  });
});
