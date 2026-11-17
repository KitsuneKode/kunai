import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { ClaudeTabRow } from "@/app-shell/primitives/ClaudeTabRow";
import {
  primeShellColorEnvironment,
  resetTerminalColorLevelCacheForTests,
} from "@/app-shell/shell-color";
import { ShellFrame } from "@/app-shell/shell-frame";
import React from "react";

import { render } from "../../harness/render-capture";

/** Foreground/background colour SGR — bold/underline (non-colour) are allowed. */
const ESC = String.fromCharCode(27);
const SGR_COLOR = new RegExp(
  `${ESC}\\[(?:[0-9;]*(?:3[0-9]|4[0-9]|9[0-9])|38;[0-9;]*m|48;[0-9;]*m)`,
);

describe("NO_COLOR shell rendering", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;
    resetTerminalColorLevelCacheForTests();
    primeShellColorEnvironment();
  });

  afterEach(() => {
    process.env = { ...saved };
    resetTerminalColorLevelCacheForTests();
  });

  test("active tabs keep a structural marker without colour SGR", () => {
    const handle = render(
      <ClaudeTabRow labels={["Browse", "Queue"]} activeIndex={0} maxWidth={40} />,
      {
        columns: 40,
        rows: 8,
      },
    );
    try {
      const raw = handle.lastFrame();
      expect(raw).not.toMatch(SGR_COLOR);
      expect(raw).toMatch(/\[ ?Browse ?\]/);
    } finally {
      handle.unmount();
    }
  });

  test("shell frame omits background colour SGR", () => {
    const handle = render(
      <ShellFrame
        eyebrow=""
        title="Title"
        subtitle="Subtitle"
        footerTask="task"
        footerActions={[]}
        commands={[]}
        onResolve={() => {}}
      >
        <React.Fragment />
      </ShellFrame>,
      { columns: 60, rows: 12 },
    );
    try {
      const raw = handle.lastFrame();
      expect(raw).not.toMatch(SGR_COLOR);
      expect(raw).toContain("Title");
    } finally {
      handle.unmount();
    }
  });
});
