import { describe, expect, test } from "bun:test";

import { codeMetadata } from "../lib/code-metadata";
import { docNavEntries, homeSectionsFromNav } from "../lib/doc-navigation";
import { homeFlow, homeHero, homeHighlights, homeKinds, homeStartCards } from "../lib/home-content";
import { featuredCommands } from "../lib/home-presenters";
import { PREFERRED_INSTALL } from "../lib/install-commands";

describe("docs home content", () => {
  test("keeps install and getting-started entry points visible", () => {
    expect(homeHero.primaryCta.href).toBe("/docs/users/getting-started");
    expect(homeHero.secondaryCta.href).toBe("/docs/users/what-you-can-do");
    expect(homeHero.installCommands).toContain(PREFERRED_INSTALL);

    const startHrefs = homeStartCards.map((card) => card.href);
    expect(startHrefs).toContain("/docs/users/getting-started");
    expect(startHrefs).toContain("/docs/users/troubleshooting");
    expect(startHrefs).toContain("/docs/users/cli-reference");
  });

  test("home nav links are registered in doc-navigation", () => {
    const registryHrefs = new Set(docNavEntries.map((entry) => entry.href));
    const homeHrefs = homeSectionsFromNav().flatMap((section) =>
      section.items.map((item) => item.href),
    );

    for (const href of homeHrefs) {
      expect(registryHrefs.has(href)).toBe(true);
    }
  });

  test("keeps recovery and provider promises in user-facing copy", () => {
    expect(homeFlow.map((step) => step.title)).toContain("Play in mpv");
    expect(homeHighlights.some((item) => item.label === "Recovery built in")).toBe(true);
    expect(homeHero.description).toMatch(/recovery/i);
    expect(homeHero.description).toMatch(/mpv/);
  });

  /**
   * The regression this locks: the hero once described the mechanism without
   * ever naming what Kunai plays. The only page text that said "anime" lived in
   * the terminal simulator, which is client-only and appears after an
   * interaction — so neither a crawler nor a skimming visitor could find it.
   */
  test("hero copy names every catalog mode in server-rendered text", () => {
    const heroText = `${homeHero.title} ${homeHero.description}`.toLowerCase();

    for (const kind of homeKinds) {
      expect(heroText).toContain(kind.toLowerCase());
    }
  });

  test("catalog modes match the shell's Tab order", () => {
    expect(homeKinds).toEqual(["Anime", "Series", "Movies", "YouTube"]);
    expect(homeHero.kindsHint.key).toBe("Tab");
  });

  test("provider count in highlights matches codegen", () => {
    const highlight = homeHighlights.find((item) => item.label === "Direct providers");
    expect(highlight).toBeDefined();
    expect(highlight?.detail).toContain(String(codeMetadata.providerIds.length));
    expect(codeMetadata.providerIds.length).toBeGreaterThan(0);
  });

  test("featured commands resolve from codegen metadata", () => {
    const palette = featuredCommands(codeMetadata.commands);
    expect(palette.some((command) => command.id === "search")).toBe(true);
    expect(palette.some((command) => command.id === "help")).toBe(true);
  });
});
