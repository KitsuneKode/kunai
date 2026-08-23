import { describe, expect, test } from "bun:test";

import { isValidElement } from "react";

import { baseOptions } from "../lib/layout.shared";

describe("docs shell", () => {
  test("keeps stable product navigation for the generated docs app", () => {
    const options = baseOptions();
    const links = options.links ?? [];

    expect(isValidElement(options.nav?.title)).toBe(true);
    expect(options.nav?.url).toBe("/");
    // `githubUrl` must stay unset. fumadocs expands it into an icon link item
    // that renders in the docs sidebar, where GithubStarCta already lives — the
    // two stacked as a bare unlabelled pill above a labelled one. The star CTAs
    // are the GitHub entry points now, and they carry the count.
    expect(options.githubUrl).toBeUndefined();
    expect(links.some((link) => "url" in link && link.url?.includes("github.com"))).toBe(false);

    expect(links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "Overview",
          url: "/docs",
          active: "url",
        }),
        expect.objectContaining({
          text: "Guides",
          url: "/docs/users",
          active: "nested-url",
        }),
        expect.objectContaining({
          text: "Debug",
          url: "/docs/developer",
        }),
        expect.objectContaining({
          text: "Releases",
          url: "/releases",
        }),
        expect.objectContaining({
          text: "Feedback",
          url: "/feedback",
        }),
        expect.objectContaining({
          text: "Analytics",
          url: "/analytics",
        }),
      ]),
    );
  });
});
