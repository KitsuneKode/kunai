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
          text: "Guides",
          url: "/docs/users/getting-started",
        }),
        expect.objectContaining({
          text: "Debugging",
          url: "/docs/developer/debugging-workflow",
        }),
      ]),
    );
  });
});
