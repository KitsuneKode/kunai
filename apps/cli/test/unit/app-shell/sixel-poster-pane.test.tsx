import { describe, expect, test } from "bun:test";

import { PosterOutput } from "@/app-shell/SixelPosterPane";
import React from "react";

import { captureFrame } from "../../harness/render-capture";

describe("PosterOutput", () => {
  test("renders an in-process text poster through Ink Text", () => {
    const placeholder = "▄▀\n▀▄";

    expect(
      captureFrame(<PosterOutput poster={{ kind: "text", placeholder, rows: 2, cols: 2 }} />),
    ).toContain(placeholder);
  });
});
