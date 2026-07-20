import { describe, expect, test } from "bun:test";

import { MiniPosterTile } from "@/app-shell/primitives/MiniPosterTile";
import React from "react";

import { captureFrame } from "../../harness/render-capture";

describe("MiniPosterTile", () => {
  test("falls back to initials when url missing", () => {
    const frame = captureFrame(<MiniPosterTile title="Anime Title" enabled cols={4} rows={2} />, {
      columns: 80,
    });
    expect(frame).toContain("AT");
  });

  test("renders without throwing when url is undefined and enabled is true", () => {
    expect(() =>
      captureFrame(<MiniPosterTile title="Demo Title" enabled cols={4} rows={2} />, {
        columns: 80,
      }),
    ).not.toThrow();
  });
});
