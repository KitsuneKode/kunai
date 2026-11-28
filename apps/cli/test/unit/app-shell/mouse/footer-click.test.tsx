import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";

import { footerKeySequence } from "@/app-shell/mouse/footer-key-sequence";
import { MouseSplitStdin } from "@/app-shell/mouse/mouse-stdin";
import { PickRow, rowKeySequence } from "@/app-shell/mouse/PickRow";
import { ShellFooter } from "@/app-shell/shell-primitives";
import { Text, useInput } from "ink";
import React, { act } from "react";

import { renderWithPointer } from "../../../support/pointer-render";

describe("footerKeySequence", () => {
  test("maps unambiguous key hints to the keystroke they name", () => {
    expect(footerKeySequence("enter")).toBe("\r");
    expect(footerKeySequence("↵")).toBe("\r");
    expect(footerKeySequence("esc")).toBe("\x1b");
    expect(footerKeySequence("r")).toBe("r");
    expect(footerKeySequence("⇧F")).toBe("F");
    expect(footerKeySequence("ctrl+a")).toBe("\x01");
    expect(footerKeySequence("n / N")).toBe("n");
    expect(footerKeySequence("↓")).toBe("\x1b[B");
  });

  test("leaves pairs, words and typed commands display-only", () => {
    expect(footerKeySequence("↑↓")).toBeNull();
    expect(footerKeySequence("year")).toBeNull();
    expect(footerKeySequence("/provider")).toBeNull();
  });
});

test("injected keys reach Ink's reader as typed bytes", () => {
  const source = Object.assign(new EventEmitter(), {
    read: () => null,
    setEncoding: () => {},
  });
  const stdin = new MouseSplitStdin(source, null, { write: () => {} });
  let readable = 0;
  stdin.on("readable", () => {
    readable += 1;
  });
  stdin.inject("q");
  expect(readable).toBe(1);
  expect(stdin.read()).toBe("q");
  stdin.detach();
  stdin.inject("x");
  expect(stdin.read()).toBeNull();
});

function KeyLog({ keys }: { readonly keys: string[] }) {
  useInput((input, key) => {
    keys.push(
      key.return
        ? "enter"
        : key.escape
          ? "esc"
          : key.upArrow
            ? "up"
            : key.downArrow
              ? "down"
              : input,
    );
  });
  return null;
}

test("clicking a footer hint presses its key; destructive hints stay keyboard-only", async () => {
  const keys: string[] = [];
  const handle = renderWithPointer(
    <>
      <KeyLog keys={keys} />
      <ShellFooter
        taskLabel="Test"
        actions={[
          { key: "r", label: "refresh" },
          { key: "enter", label: "open" },
          { key: "x", label: "delete" },
        ]}
      />
    </>,
    { columns: 100, rows: 20 },
  );
  try {
    await act(async () => {
      await Promise.resolve();
    });
    const ids = handle.dispatcher.debugRegions().map((region) => region.id);
    const chip = (label: string) => ids.find((id) => id.endsWith(`:${label}`));
    handle.click(chip("refresh") ?? "missing");
    handle.click(chip("open") ?? "missing");
    expect(keys).toEqual(["r", "enter"]);
    // The delete chip is not an active click target.
    const deleteId = chip("delete");
    if (deleteId) handle.click(deleteId);
    expect(keys).toEqual(["r", "enter"]);
  } finally {
    handle.unmount();
  }
});

test("clicking explicitly confirmed destructive footer chips injects y and Escape bytes", async () => {
  const keys: string[] = [];
  const handle = renderWithPointer(
    <>
      <KeyLog keys={keys} />
      <ShellFooter
        taskLabel="Confirm"
        actions={[
          { key: "y", label: "delete", allowMouseDestructive: true },
          { key: "esc", label: "cancel", allowMouseDestructive: true },
        ]}
      />
    </>,
    { columns: 100, rows: 20 },
  );
  try {
    await act(async () => {
      await Promise.resolve();
    });
    const injected: string[] = [];
    const pressKey = handle.dispatcher.pressKey;
    handle.dispatcher.pressKey = (keysToInject) => {
      injected.push(keysToInject);
      pressKey?.(keysToInject);
    };
    const ids = handle.dispatcher.debugRegions().map((region) => region.id);
    const chip = (label: string) => ids.find((id) => id.endsWith(`:${label}`));
    handle.click(chip("delete") ?? "missing");
    handle.click(chip("cancel") ?? "missing");
    expect(injected).toEqual(["y", "\x1b"]);
    expect(keys).toEqual(["y"]);
  } finally {
    handle.unmount();
  }
});

test("a row hint presses the row's own letter, not Enter", () => {
  expect(rowKeySequence("↵ n")).toBe("n");
  expect(rowKeySequence("d")).toBe("d");
  expect(rowKeySequence("enter")).toBe("\r");
});

test("PickRow: a click selects with arrows, a second click activates", async () => {
  const keys: string[] = [];
  const rows = ["one", "two", "three"];
  const handle = renderWithPointer(
    <>
      <KeyLog keys={keys} />
      {rows.map((row, index) => (
        <PickRow key={row} id={`pick:${row}`} index={index} selectedIndex={0}>
          <Text>{row}</Text>
        </PickRow>
      ))}
    </>,
    { columns: 40, rows: 10 },
  );
  try {
    await act(async () => {
      await Promise.resolve();
    });
    handle.click("pick:three");
    expect(keys).toEqual(["down", "down"]);
    keys.length = 0;
    handle.click("pick:one");
    expect(keys).toEqual(["enter"]);
  } finally {
    handle.unmount();
  }
});
