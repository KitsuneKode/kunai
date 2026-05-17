import { describe, expect, test } from "bun:test";

import { baseOptions } from "../lib/layout.shared";

describe("docs shell", () => {
  test("keeps stable product navigation for the generated docs app", () => {
    expect(baseOptions()).toMatchObject({
      nav: { title: "Kunai Docs", url: "/" },
      links: [
        { text: "Guides", url: "/docs/users/getting-started" },
        { text: "Debugging", url: "/docs/developer/debugging-workflow" },
      ],
    });
  });
});
