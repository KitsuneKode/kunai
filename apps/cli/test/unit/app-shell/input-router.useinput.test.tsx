import { describe, expect, test } from "bun:test";

import { isHardGlobalQuit, routeShellInput, type ShellInputRoute } from "@/app-shell/input-router";
import { Text, useInput } from "ink";
import React from "react";

import { render } from "../../harness/render-capture";

/**
 * Tiny Ink surface that wires the pure `routeShellInput` reducer into a
 * real `useInput` hook, captures the last route, and renders it as text.
 * This is the bridge test: it proves the harness can drive `useInput` AND
 * that a pure reducer + `useInput` integration behaves the way callers
 * expect (no swallowed keys, correct owner/command resolution).
 *
 * `requestHardExit` is intentionally NOT wired (the real `ShellFrame` does
 * on Ctrl+C) so a misrouted Ctrl+C doesn't kill the test process.
 */
function RoutedInput({
  context,
  onRoute,
}: {
  context: Parameters<typeof routeShellInput>[2];
  onRoute: (route: ShellInputRoute, input: string) => void;
}) {
  useInput((input, key) => {
    const route = routeShellInput(input, key, context);
    onRoute(route, input);
  });
  return <Text>routed</Text>;
}

describe("useInput wiring + input-router integration", () => {
  test("ctrl-c is hard-global quit and bypasses the rest of the routing tree", () => {
    const seen: Array<{ route: ShellInputRoute; input: string }> = [];
    const handle = render(
      <RoutedInput
        context={{ commandPaletteOpen: true, modalOpen: true, textInputFocused: true }}
        onRoute={(route, input) => seen.push({ route, input })}
      />,
      { columns: 100 },
    );
    handle.stdin.enqueue("c\u0003"); // c then Ctrl-C as a separate keystroke
    // Actually: the canonical Ctrl+C keystroke is \x03 by itself (input "" + key.ctrl).
    // The input char is the key after Ctrl is held. The router checks
    // `input === "c" && key.ctrl` OR `input === "\x03"`. Let's send \x03:
    handle.stdin.enqueue("\u0003");
    expect(seen.length).toBeGreaterThanOrEqual(1);
    const lastHard = seen.find((s) => s.route.owner === "hard-global");
    expect(lastHard).toBeDefined();
    expect(lastHard?.route.command).toBe("quit");
    handle.unmount();
  });

  test("slash in command-palette context routes to palette owner", () => {
    const seen: ShellInputRoute[] = [];
    const handle = render(
      <RoutedInput context={{ commandPaletteOpen: true }} onRoute={(route) => seen.push(route)} />,
      { columns: 100 },
    );
    handle.stdin.enqueue("/");
    expect(seen[0]).toEqual({ owner: "command-palette", command: null });
    handle.unmount();
  });

  test("slash in text-input context opens the command palette", () => {
    const seen: ShellInputRoute[] = [];
    const handle = render(
      <RoutedInput context={{ textInputFocused: true }} onRoute={(route) => seen.push(route)} />,
      { columns: 100 },
    );
    handle.stdin.enqueue("/");
    expect(seen[0]).toEqual({ owner: "text-input", command: "open-command-palette" });
    handle.unmount();
  });

  test("plain letter on a bare surface falls through to surface owner with no command", () => {
    const seen: ShellInputRoute[] = [];
    const handle = render(<RoutedInput context={{}} onRoute={(route) => seen.push(route)} />, {
      columns: 100,
    });
    handle.stdin.enqueue("a");
    expect(seen[0]).toEqual({ owner: "surface", command: null });
    handle.unmount();
  });

  test("isHardGlobalQuit is a stable predicate the router can compose with", () => {
    // Sanity-check the predicate the useInput handler relies on. This
    // catches accidental changes to the hard-quit key chord.
    expect(isHardGlobalQuit("c", { ctrl: true })).toBe(true);
    expect(isHardGlobalQuit("\u0003", {})).toBe(true);
    expect(isHardGlobalQuit("c", {})).toBe(false);
    expect(isHardGlobalQuit("q", { ctrl: true })).toBe(false);
  });

  test("no spurious frames are committed after a keypress with no state change", () => {
    // The routed component renders a static <Text>routed</Text>, so a
    // keystroke that does not affect the rendered output should NOT
    // produce a new commit. This guards against the bug class where a
    // `useInput` handler accidentally calls a setter on every keypress.
    const handle = render(<RoutedInput context={{}} onRoute={() => {}} />, { columns: 100 });
    const before = handle.frames.length;
    handle.stdin.enqueue("a");
    handle.stdin.enqueue("b");
    handle.stdin.enqueue("c");
    expect(handle.frames.length).toBe(before);
    handle.unmount();
  });
});
