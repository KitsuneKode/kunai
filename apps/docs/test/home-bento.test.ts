import { describe, expect, test } from "bun:test";

import { codeMetadata } from "../lib/code-metadata";
import {
  BENTO_MODES,
  CONTINUE_ITEMS,
  cycleMode,
  DEFAULT_BENTO_MODE,
  RECOVERY_STEPS,
  recoveryStep,
  servesMode,
  type BentoProvider,
} from "../lib/home-bento";

const providers: readonly BentoProvider[] = codeMetadata.providers.map((provider) => ({
  id: provider.id,
  name: provider.displayName,
  domain: provider.domain,
  kinds: provider.mediaKinds,
}));

function command(id: string) {
  return codeMetadata.commands.find((candidate) => candidate.id === id);
}

describe("bento modes", () => {
  test("are the CLI's three, in the order Tab cycles them", () => {
    expect(BENTO_MODES.map((mode) => mode.id)).toEqual(["series", "anime", "youtube"]);
    // The CLI's own words for the toggle, so the page cannot drift from it.
    expect(command("toggle-mode")?.description).toContain("series, anime, then YouTube");
  });

  test("each mode's command and jump alias exist in the generated CLI metadata", () => {
    for (const mode of BENTO_MODES) {
      const found = command(mode.commandId);
      expect(found).toBeDefined();
      expect(found?.aliases).toContain(mode.alias);
    }
  });

  test("the section opens on the mode Tab starts from", () => {
    expect(BENTO_MODES[0]?.id).toBe(DEFAULT_BENTO_MODE);
  });
});

describe("which providers serve which mode", () => {
  test("every production provider is searched by at least one mode", () => {
    // A provider no mode reaches would be dimmed in every view: a lie that it is unused.
    for (const provider of providers) {
      expect(BENTO_MODES.some((mode) => servesMode(provider, mode))).toBe(true);
    }
  });

  test("series and anime do not share a provider, and series is not searched in YouTube mode", () => {
    const [series, anime, youtube] = BENTO_MODES;
    for (const provider of providers) {
      const hits = [series, anime, youtube].filter((mode) => mode && servesMode(provider, mode));
      expect(hits.length).toBe(1);
    }
  });

  test("the counts add up to the whole list", () => {
    const counts = BENTO_MODES.map(
      (mode) => providers.filter((provider) => servesMode(provider, mode)).length,
    );
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(providers.length);
    expect(counts.every((count) => count > 0)).toBe(true);
  });
});

describe("cycleMode", () => {
  test("goes forward in Tab order and wraps", () => {
    expect(cycleMode("series")).toBe("anime");
    expect(cycleMode("anime")).toBe("youtube");
    expect(cycleMode("youtube")).toBe("series");
  });

  test("goes back for Shift+Tab and wraps", () => {
    expect(cycleMode("series", -1)).toBe("youtube");
    expect(cycleMode("anime", -1)).toBe("series");
  });
});

describe("recovery walkthrough", () => {
  test("covers the documented order: recover, then fallback, then diagnostics", () => {
    expect(RECOVERY_STEPS.map((step) => step.commandId)).toEqual([
      "recover",
      "fallback",
      "diagnostics",
    ]);
  });

  test("each step is a real command with that alias", () => {
    for (const step of RECOVERY_STEPS) {
      expect(command(step.commandId)?.aliases).toContain(step.alias);
    }
  });

  test("the fallback shortcut it names is the real one", () => {
    const shortcut = codeMetadata.shortcuts.find((candidate) => candidate.id === "player-fallback");
    expect(shortcut?.keys).toContain("F");
    expect(recoveryStep("fallback").summary).toContain("Shift+F");
  });

  test("every step ends in an outcome and names no provider", () => {
    for (const step of RECOVERY_STEPS) {
      expect(step.lines.length).toBeGreaterThanOrEqual(3);
      for (const provider of providers) {
        for (const line of step.lines) expect(line).not.toContain(provider.name);
      }
    }
  });

  test("an unknown command falls back to the first step instead of throwing", () => {
    expect(recoveryStep("nope").commandId).toBe("recover");
  });
});

describe("continue watching", () => {
  test("every way back in is a real command with that alias", () => {
    for (const item of CONTINUE_ITEMS) {
      expect(command(item.commandId)?.aliases).toContain(item.alias);
    }
  });

  test("names the four things the tile promises", () => {
    expect(CONTINUE_ITEMS.map((item) => item.label)).toEqual([
      "History",
      "Release calendar",
      "Recommendations",
      "Offline downloads",
    ]);
  });
});
