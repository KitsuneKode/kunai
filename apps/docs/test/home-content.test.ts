import { describe, expect, test } from "bun:test";

import { homeHero, homeSections } from "../lib/home-content";

describe("docs home content", () => {
  test("keeps install, runtime feedback, and maintenance entry points visible", () => {
    expect(homeHero.primaryCta.href).toBe("/docs/users/getting-started");
    expect(homeHero.installCommands).toContain("bun install -g @kitsunekode/kunai");

    const links = homeSections.flatMap((section) => section.items.map((item) => item.href));
    expect(links).toContain("/docs/users/runtime-feedback");
    expect(links).toContain("/docs/developer/docs-maintenance");
  });
});
