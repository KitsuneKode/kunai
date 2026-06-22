import { describe, expect, test } from "bun:test";

import { isValidElement } from "react";

import { baseOptions } from "../lib/layout.shared";

describe("docs shell", () => {
  test("keeps stable product navigation for the generated docs app", () => {
    const options = baseOptions();
    const links = options.links ?? [];

    expect(isValidElement(options.nav?.title)).toBe(true);
    expect(options.nav?.url).toBe("/");
    expect(options.githubUrl).toBe("https://github.com/KitsuneKode/kunai");

    expect(links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "Docs",
          url: "/docs",
        }),
        expect.objectContaining({
          text: "Guides",
          url: "/docs/users",
        }),
        expect.objectContaining({
          text: "Debug",
          url: "/docs/developer",
        }),
        expect.objectContaining({
          text: "Releases",
          url: "/releases",
        }),
      ]),
    );
  });
});
