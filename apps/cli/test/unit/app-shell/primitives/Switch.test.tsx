import { describe, expect, test } from "bun:test";

import { BooleanSwitch } from "@/app-shell/primitives/Switch";
import React from "react";

import { captureFrame } from "../../../harness/render-capture";

describe("Switch primitive", () => {
  test("boolean switch reserves width for on and off states", () => {
    const onFrame = captureFrame(<BooleanSwitch on />);
    const offFrame = captureFrame(<BooleanSwitch on={false} />);
    expect(onFrame).toContain("on");
    expect(offFrame).toContain("off");
    expect(onFrame).toMatch(/●/);
    expect(offFrame).toMatch(/○/);
  });
});
