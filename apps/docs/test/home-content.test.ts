import { describe, expect, test } from "bun:test";

import { homeFlow, homeHero, homeProof, homeSections } from "../lib/home-content";

describe("docs home content", () => {
  test("keeps install, runtime feedback, and maintenance entry points visible", () => {
    expect(homeHero.primaryCta.href).toBe("/docs");
    expect(homeHero.installCommands).toContain("bun install -g @kitsunekode/kunai");

    const links = homeSections.flatMap((section) => section.items.map((item) => item.href));
    expect(links).toContain("/docs/users/runtime-feedback");
    expect(links).toContain("/docs/developer/docs-maintenance");
  });

  test("keeps recovery, provider truth, and privacy promises on the home page", () => {
    expect(homeFlow.map((step) => step.title)).toContain("Recover without guessing");
    expect(homeProof.map((item) => item.value)).toContain("redacted");
    expect(homeHero.description).toContain("provider churn");
  });
});
