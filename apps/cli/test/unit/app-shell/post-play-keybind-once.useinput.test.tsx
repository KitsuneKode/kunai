import { describe, expect, test } from "bun:test";

import type { ResolvedAppCommand } from "@/app-shell/commands";
import { ShellFrame } from "@/app-shell/shell-frame";
import type { FooterAction, ShellAction } from "@/app-shell/types";
import { Text } from "ink";
import React from "react";

import { render } from "../../harness/render-capture";

/**
 * Post-play / playback ShellFrame ownership: footer accelerators must fire once.
 * Before the fix, ShellFrame resolved the footer letter AND forwarded it to
 * onUnhandledInput, so `o`/`r`/`n` opened tracks / replayed / continued twice —
 * the classic "keybind does not trigger in one go" report.
 */

const COMMANDS: readonly ResolvedAppCommand[] = [
  { id: "source", label: "Source", aliases: [], description: "Pick source", enabled: true },
];

const POST_PLAY_FOOTER: readonly FooterAction[] = [
  { key: "n", label: "continue", action: "next", primary: true },
  { key: "o", label: "source", action: "source" },
  { key: "r", label: "replay", action: "replay" },
  { key: "m", label: "menu", action: "menu" },
  { key: "/", label: "commands", action: "command-mode" },
];

describe("post-play ShellFrame keybinds fire once", () => {
  test("footer accelerators resolve exactly once and are not re-delivered as unhandled", () => {
    const resolved: ShellAction[] = [];
    const unhandled: string[] = [];
    const handle = render(
      <ShellFrame
        eyebrow="post-play"
        title="Show"
        subtitle="post-play"
        footerTask="Post-play"
        footerActions={POST_PLAY_FOOTER}
        commands={COMMANDS}
        escapeAction="back-to-results"
        onUnhandledInput={(input) => unhandled.push(input)}
        onResolve={(action) => resolved.push(action)}
      >
        <Text>post-play</Text>
      </ShellFrame>,
      { columns: 100 },
    );

    handle.stdin.enqueue("o");
    handle.stdin.enqueue("r");
    handle.stdin.enqueue("n");

    expect(resolved).toEqual(["source", "replay", "next"]);
    expect(unhandled).toEqual([]);
    handle.unmount();
  });

  test("action-list navigation keys still reach onUnhandledInput", () => {
    const unhandled: string[] = [];
    const handle = render(
      <ShellFrame
        eyebrow="post-play"
        title="Show"
        subtitle="post-play"
        footerTask="Post-play"
        footerActions={POST_PLAY_FOOTER}
        commands={COMMANDS}
        escapeAction="back-to-results"
        onUnhandledInput={(input) => unhandled.push(input)}
        onResolve={() => {}}
      >
        <Text>post-play</Text>
      </ShellFrame>,
      { columns: 100 },
    );

    handle.stdin.enqueue("j");
    handle.stdin.enqueue("k");
    handle.stdin.enqueue("1");

    expect(unhandled).toEqual(["j", "k", "1"]);
    handle.unmount();
  });
});
