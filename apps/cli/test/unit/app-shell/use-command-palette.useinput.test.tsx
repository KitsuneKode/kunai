import { expect, test } from "bun:test";

import type { ResolvedAppCommand } from "@/app-shell/commands";
import { useCommandPalette } from "@/app-shell/use-command-palette";
import { Text, useInput } from "ink";
import React, { act } from "react";

import { render } from "../../harness/render-capture";

const COMMANDS: readonly ResolvedAppCommand[] = [
  { id: "search", label: "Search", aliases: ["search", "find"], description: "", enabled: true },
  {
    id: "library",
    label: "Library",
    aliases: ["library"],
    description: "",
    enabled: true,
  },
  {
    id: "downloads",
    label: "Downloads",
    aliases: ["downloads"],
    description: "",
    enabled: false,
    reason: "offline",
  },
];

const ESC = String.fromCharCode(27);
const DOWN = `${ESC}[B`;
const UP = `${ESC}[A`;

function Probe({ onResolved }: { onResolved: (id: string) => void }) {
  const palette = useCommandPalette();
  useInput((input, key) => {
    if (palette.open) {
      const result = palette.handleKey(input, key, COMMANDS);
      if (result.kind === "resolved") onResolved(result.command.id);
      return;
    }
    if (input === "/") palette.openPalette();
  });
  return (
    <Text>
      {`open=${palette.open ? 1 : 0} input=${palette.input} idx=${palette.highlightedIndex}`}
      {palette.notice ? ` notice=${palette.notice}` : ""}
    </Text>
  );
}

// Each key is its own chunk and its own act(): a burst inside one act() gets
// React-batched, and the next key's handler would see the pre-batch state.
async function press(
  handle: ReturnType<typeof render>,
  keys: readonly string[],
  settleMs = 5,
): Promise<void> {
  for (const key of keys) {
    await act(async () => {
      handle.stdin.enqueue([key]);
      await new Promise((resolve) => setTimeout(resolve, settleMs));
    });
  }
}

test("closed palette ignores keys; `/` opens it", async () => {
  const resolved: string[] = [];
  const handle = render(<Probe onResolved={(id) => resolved.push(id)} />);

  await press(handle, ["x"]);
  expect(handle.lastFrame()).toContain("open=0");

  await press(handle, ["/"]);
  expect(handle.lastFrame()).toContain("open=1");
});

test("typing edits the query and resets the highlight to the top match", async () => {
  const handle = render(<Probe onResolved={() => {}} />);
  await press(handle, ["/", "l"]);
  expect(handle.lastFrame()).toContain("input=l");
  expect(handle.lastFrame()).toContain("idx=0");

  await press(handle, [DOWN, UP]);
  expect(handle.lastFrame()).toContain("idx=0");
});

test("Enter resolves the highlighted command and the caller decides what it means", async () => {
  const resolved: string[] = [];
  const handle = render(<Probe onResolved={(id) => resolved.push(id)} />);
  await press(handle, ["/", "s", "e", "a", "\r"]);
  expect(resolved).toEqual(["search"]);
});

test("Enter on an enabled command closes the palette", async () => {
  const resolved: string[] = [];
  const handle = render(<Probe onResolved={(id) => resolved.push(id)} />);
  await press(handle, ["/", "s", "e", "a", "\r"]);
  expect(resolved).toEqual(["search"]);
  expect(handle.lastFrame()).toContain("open=0");
  expect(handle.lastFrame()).toContain("input=");
  expect(handle.lastFrame()).not.toContain("input=sea");
});

test("Enter on a disabled command is consumed, not resolved", async () => {
  const resolved: string[] = [];
  const handle = render(<Probe onResolved={(id) => resolved.push(id)} />);
  await press(handle, ["/", "d", "o", "w", "n", "l", "o", "a", "d", "s", "\r"]);
  expect(resolved).toEqual([]);
  expect(handle.lastFrame()).toContain("open=1"); // still open — the keypress was consumed
});

test("Enter on a disabled command names the refusal until the next keypress", async () => {
  const resolved: string[] = [];
  const handle = render(<Probe onResolved={(id) => resolved.push(id)} />);
  await press(handle, ["/", "d", "o", "w", "n", "l", "o", "a", "d", "s", "\r"]);
  expect(resolved).toEqual([]);
  expect(handle.lastFrame()).toContain("notice=can't run — offline");

  // Any other palette keypress dismisses the notice.
  await press(handle, [DOWN]);
  expect(handle.lastFrame()).not.toContain("notice=");
});

test("Enter with no match still answers the keypress", async () => {
  const handle = render(<Probe onResolved={() => {}} />);
  await press(handle, ["/", "z", "z", "z", "\r"]);
  expect(handle.lastFrame()).toContain("notice=no command matches that");
});

test("Tab autocompletes the highlighted command into the query", async () => {
  const handle = render(<Probe onResolved={() => {}} />);
  await press(handle, ["/", "l", "i", "b", "\t"]);
  expect(handle.lastFrame()).toContain("input=library");
});

test("Escape closes the palette and clears the query", async () => {
  const handle = render(<Probe onResolved={() => {}} />);
  await press(handle, ["/", "s", "e", "a"]);
  // Ink defers a lone ESC briefly to disambiguate escape sequences.
  await press(handle, [ESC], 60);
  expect(handle.lastFrame()).toContain("open=0");
});
