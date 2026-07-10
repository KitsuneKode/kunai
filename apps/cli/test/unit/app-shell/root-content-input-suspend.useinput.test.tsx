import { describe, expect, test } from "bun:test";

import type { ResolvedAppCommand } from "@/app-shell/commands";
import { RootContentInputGate } from "@/app-shell/RootContentInputGate";
import { ShellFrame } from "@/app-shell/shell-frame";
import type { FooterAction, ShellAction } from "@/app-shell/types";
import { Text } from "ink";
import React from "react";

import { render } from "../../harness/render-capture";

/**
 * When a root overlay covers a kept-mounted browse/post-play session, the
 * session stays in the tree under RootContentInputGate(suspended) so local
 * React state survives — but its useInput must not fire.
 */

const COMMANDS: readonly ResolvedAppCommand[] = [
  { id: "next", label: "Next", aliases: [], description: "Play next", enabled: true },
];

const FOOTER_ACTIONS: readonly FooterAction[] = [
  { key: "g", label: "Go", action: "help" as ShellAction },
];

describe("RootContentInputGate suspends ShellFrame useInput", () => {
  test("suspended: footer letter and ? do not resolve or reach onUnhandledInput", () => {
    const resolved: ShellAction[] = [];
    const unhandled: string[] = [];
    const handle = render(
      <RootContentInputGate suspended>
        <ShellFrame
          eyebrow="test"
          title="Test"
          subtitle="suspended"
          footerTask="Test"
          footerActions={FOOTER_ACTIONS}
          commands={COMMANDS}
          escapeAction="back-to-results"
          onUnhandledInput={(input) => unhandled.push(input)}
          onResolve={(action) => resolved.push(action)}
        >
          <Text>body</Text>
        </ShellFrame>
      </RootContentInputGate>,
      { columns: 100 },
    );

    handle.stdin.enqueue("g");
    handle.stdin.enqueue("?");
    handle.stdin.enqueue("x");

    expect(resolved).toEqual([]);
    expect(unhandled).toEqual([]);
    handle.unmount();
  });

  test("not suspended: footer letter resolves normally", () => {
    const resolved: ShellAction[] = [];
    const handle = render(
      <RootContentInputGate suspended={false}>
        <ShellFrame
          eyebrow="test"
          title="Test"
          subtitle="active"
          footerTask="Test"
          footerActions={FOOTER_ACTIONS}
          commands={COMMANDS}
          escapeAction="back-to-results"
          onResolve={(action) => resolved.push(action)}
        >
          <Text>body</Text>
        </ShellFrame>
      </RootContentInputGate>,
      { columns: 100 },
    );

    handle.stdin.enqueue("g");
    expect(resolved).toEqual(["help"]);
    handle.unmount();
  });
});
