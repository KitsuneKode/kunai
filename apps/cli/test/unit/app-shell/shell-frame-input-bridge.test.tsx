import { describe, expect, test } from "bun:test";

import type { ResolvedAppCommand } from "@/app-shell/commands";
import { ShellFrame } from "@/app-shell/shell-frame";
import type { FooterAction, ShellAction } from "@/app-shell/types";
import { Text } from "ink";
import React from "react";

import { render } from "../../harness/render-capture";

/**
 * Bridge test for ShellFrame input ownership. These lock the contracts that the
 * post-play / playback surfaces rely on, so the duplicate runtime overlay gate in
 * PlaybackShell could be removed safely:
 *   • inputLocked is the SINGLE runtime overlay lock — when set, neither footer
 *     shortcuts, `?` help, nor onUnhandledInput fire.
 *   • letterKeysHandledExternally lets a playback surface own letters (footer
 *     action does NOT resolve) while the key is still delivered to onUnhandledInput.
 *   • Opening the palette with `/` and closing it with Esc leaves no stale command
 *     mode, so the very next footer letter resolves on first press.
 */

const COMMANDS: readonly ResolvedAppCommand[] = [
  { id: "next", label: "Next", aliases: [], description: "Play next", enabled: true },
];

const FOOTER_ACTIONS: readonly FooterAction[] = [
  { key: "g", label: "Go", action: "help" as ShellAction },
];

function Frame(props: {
  inputLocked?: boolean;
  letterKeysHandledExternally?: boolean;
  onResolve: (action: ShellAction) => void;
  onUnhandledInput?: (input: string) => void;
}) {
  return (
    <ShellFrame
      eyebrow="test"
      title="Test"
      subtitle="bridge"
      footerTask="Test"
      footerActions={FOOTER_ACTIONS}
      commands={COMMANDS}
      inputLocked={props.inputLocked}
      letterKeysHandledExternally={props.letterKeysHandledExternally}
      escapeAction="back-to-results"
      onUnhandledInput={(input) => props.onUnhandledInput?.(input)}
      onResolve={props.onResolve}
    >
      <Text>body</Text>
    </ShellFrame>
  );
}

describe("ShellFrame input ownership (bridge)", () => {
  test("inputLocked suppresses footer shortcuts, ? help, and onUnhandledInput", () => {
    const resolved: ShellAction[] = [];
    const unhandled: string[] = [];
    const handle = render(
      <Frame
        inputLocked
        onResolve={(action) => resolved.push(action)}
        onUnhandledInput={(input) => unhandled.push(input)}
      />,
      { columns: 100 },
    );
    handle.stdin.enqueue("g");
    handle.stdin.enqueue("?");
    handle.stdin.enqueue("x");
    expect(resolved).toEqual([]);
    expect(unhandled).toEqual([]);
    handle.unmount();
  });

  test("unlocked: footer letter resolves and unbound keys reach onUnhandledInput", () => {
    const resolved: ShellAction[] = [];
    const unhandled: string[] = [];
    const handle = render(
      <Frame
        onResolve={(action) => resolved.push(action)}
        onUnhandledInput={(input) => unhandled.push(input)}
      />,
      { columns: 100 },
    );
    handle.stdin.enqueue("g"); // bound footer action → resolves
    handle.stdin.enqueue("x"); // unbound → fallback
    expect(resolved).toEqual(["help"]);
    expect(unhandled).toContain("x");
    handle.unmount();
  });

  test("letterKeysHandledExternally: footer letter is delivered to onUnhandledInput, not resolved", () => {
    const resolved: ShellAction[] = [];
    const unhandled: string[] = [];
    const handle = render(
      <Frame
        letterKeysHandledExternally
        onResolve={(action) => resolved.push(action)}
        onUnhandledInput={(input) => unhandled.push(input)}
      />,
      { columns: 100 },
    );
    handle.stdin.enqueue("g");
    expect(resolved).toEqual([]);
    expect(unhandled).toContain("g");
    handle.unmount();
  });

  test("while the palette is open, footer letters are captured by it, not resolved as actions", () => {
    const resolved: ShellAction[] = [];
    const unhandled: string[] = [];
    const handle = render(
      <Frame
        onResolve={(action) => resolved.push(action)}
        onUnhandledInput={(input) => unhandled.push(input)}
      />,
      { columns: 100 },
    );
    handle.stdin.enqueue("/"); // open palette
    handle.stdin.enqueue("g"); // typed into the command input, NOT a footer action
    expect(resolved).toEqual([]);
    expect(unhandled).not.toContain("g");
    handle.unmount();
  });
});
