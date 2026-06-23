import { describe, expect, test } from "bun:test";

import { codeMetadata } from "../lib/code-metadata";
import { docNavEntries, homeSectionsFromNav } from "../lib/doc-navigation";
import { homeFlow, homeHero, homeProof } from "../lib/home-content";

describe("docs home content", () => {
  test("keeps install, runtime feedback, and maintenance entry points visible", () => {
    expect(homeHero.primaryCta.href).toBe("/docs");
    expect(homeHero.installCommands).toContain("bun install -g @kitsunekode/kunai");

    const links = homeSectionsFromNav().flatMap((section) =>
      section.items.map((item) => item.href),
    );
    expect(links).toContain("/docs/users/runtime-feedback");
    expect(links).toContain("/docs/developer/docs-maintenance");
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

  test("keeps recovery, provider truth, and privacy promises on the home page", () => {
    expect(homeFlow.map((step) => step.title)).toContain("Recover without guessing");
    expect(homeProof.map((item) => item.value)).toContain("redacted");
    expect(homeHero.description).toContain("provider churn");
  });

  test("provider count in highlights matches codegen", () => {
    const highlight = homeFlow.find((step) => step.title === "Resolve with evidence");
    expect(highlight).toBeDefined();
    expect(codeMetadata.providerIds.length).toBeGreaterThan(0);
  });
});
