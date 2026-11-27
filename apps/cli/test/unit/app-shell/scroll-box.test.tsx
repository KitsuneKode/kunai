import { expect, test } from "bun:test";

import { DetailsSheet } from "@/app-shell/details-sheet-ui";
import { buildDetailsSheet } from "@/app-shell/details-sheet.model";
import { ScrollBox } from "@/app-shell/primitives/ScrollBox";
import { Text, useInput } from "ink";
import React, { act } from "react";

import { stripAnsi } from "../../harness/render-capture";
import { renderWithPointer } from "../../support/pointer-render";

const settle = () =>
  act(async () => {
    await Promise.resolve();
  });

// The details sheet had no scrolling: on a short terminal its lower sections
// were cut off. ScrollBox windows it and scrolls by key and by wheel.
test("ScrollBox shows a window of its content and scrolls by key and wheel", async () => {
  const handle = renderWithPointer(
    <ScrollBox id="scroll" height={3}>
      {Array.from({ length: 8 }, (_, index) => (
        <Text key={index}>{`line ${index}`}</Text>
      ))}
    </ScrollBox>,
    { columns: 40, rows: 20 },
  );
  try {
    await settle();
    expect(stripAnsi(handle.lastFrame())).toContain("line 0");
    expect(stripAnsi(handle.lastFrame())).not.toContain("line 3");
    expect(stripAnsi(handle.lastFrame())).toContain("▼");

    await act(async () => {
      handle.stdin.enqueue("\x1b[B");
    });
    expect(stripAnsi(handle.lastFrame())).not.toContain("line 0");
    expect(stripAnsi(handle.lastFrame())).toContain("line 3");

    handle.wheel("scroll", "down");
    await settle();
    expect(stripAnsi(handle.lastFrame())).toContain("line 5");
  } finally {
    handle.unmount();
  }
});

function KeyLog({ keys }: { readonly keys: string[] }) {
  useInput((input, key) => {
    keys.push(key.return ? "enter" : key.escape ? "esc" : input);
  });
  return null;
}

test("the details sheet's action chips press their keys", async () => {
  const keys: string[] = [];
  const handle = renderWithPointer(
    <>
      <KeyLog keys={keys} />
      <DetailsSheet
        model={buildDetailsSheet({
          seed: { title: "Show", type: "series" },
          detail: null,
          history: null,
          availability: null,
        })}
        seasonsExpanded={false}
        width={90}
      />
    </>,
    { columns: 100, rows: 40 },
  );
  try {
    await settle();
    handle.click("details-sheet:action:q");
    handle.click("details-sheet:action:w");
    expect(keys).toEqual(["q", "w"]);
    expect(stripAnsi(handle.lastFrame())).not.toContain("+ queue");
  } finally {
    handle.unmount();
  }
});

test("the details sheet drops its poster and shows fetch failure copy at 40 columns", async () => {
  const handle = renderWithPointer(
    <DetailsSheet
      model={buildDetailsSheet({
        seed: { title: "Show", type: "series" },
        detail: null,
        history: null,
        availability: null,
        detailError: "Could not load season and episode details",
      })}
      seasonsExpanded={false}
      width={36}
    />,
    { columns: 40, rows: 30 },
  );
  try {
    await settle();
    const frame = stripAnsi(handle.lastFrame());
    expect(frame.replaceAll(/\s+/g, " ")).toContain("Could not load season and episode details");
    expect(frame.split("\n").some((line) => /^\s{7}S\s*$/.test(line))).toBe(false);
  } finally {
    handle.unmount();
  }
});
