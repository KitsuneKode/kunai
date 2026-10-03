import { describe, expect, test } from "bun:test";

import { useShellInput } from "@/app-shell/shell-command-input";
import type { FooterAction, ShellAction } from "@/app-shell/types";
import type { ResolvedAppCommand } from "@/domain/session/command-registry";
import { Text } from "ink";
import React, { useEffect, useState } from "react";
import { act } from "react";

import { render } from "../../harness/render-capture";

const FOOTER_ACTIONS: readonly FooterAction[] = [
  { key: "/", label: "commands", action: "command-mode" },
  { key: "o", label: "source", action: "source" },
];

const COMMANDS: readonly ResolvedAppCommand[] = [
  {
    id: "source",
    label: "Source",
    aliases: ["source"],
    description: "Open source picker",
    enabled: true,
  },
  {
    id: "watchlist",
    label: "Watchlist",
    aliases: ["watchlist"],
    description: "Open watchlist",
    enabled: false,
    reason: "sign in first",
  },
];

function ShellInputProbe({
  onResolve,
  exposeSetLocked,
  slashHandledExternally = false,
}: {
  readonly onResolve: (action: ShellAction) => void;
  readonly exposeSetLocked: (setLocked: (locked: boolean) => void) => void;
  readonly slashHandledExternally?: boolean;
}) {
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    exposeSetLocked(setLocked);
  }, [exposeSetLocked]);

  const { commandMode, paletteNotice } = useShellInput({
    footerActions: FOOTER_ACTIONS,
    commands: COMMANDS,
    disabled: locked,
    slashHandledExternally,
    onResolve,
  });

  return (
    <Text>
      {`${locked ? "locked" : "unlocked"}:${commandMode ? "command" : "normal"}`}
      {paletteNotice ? `|${paletteNotice}` : ""}
    </Text>
  );
}

describe("useShellInput command mode lock transitions", () => {
  test("clears command mode when input becomes locked so the next unlocked shortcut is not swallowed", () => {
    const seen: ShellAction[] = [];
    let setLocked: (locked: boolean) => void = () => {};
    const handle = render(
      <ShellInputProbe
        onResolve={(action) => seen.push(action)}
        exposeSetLocked={(setter) => {
          setLocked = setter;
        }}
      />,
    );

    handle.stdin.enqueue("/");
    expect(handle.lastFrame()).toContain("unlocked:command");

    act(() => {
      setLocked(true);
    });
    expect(handle.lastFrame()).toContain("locked:normal");

    act(() => {
      setLocked(false);
    });
    handle.stdin.enqueue("o");

    expect(seen).toEqual(["source"]);
    handle.unmount();
  });

  test("Enter on a disabled command names the refusal until the next keypress", () => {
    const seen: ShellAction[] = [];
    const handle = render(
      <ShellInputProbe onResolve={(action) => seen.push(action)} exposeSetLocked={() => {}} />,
    );

    handle.stdin.enqueue("/");
    handle.stdin.enqueue("watchlist");
    handle.stdin.enqueue("\r");
    expect(handle.lastFrame()).toContain("can't run — sign in first");
    expect(seen).toEqual([]);

    handle.stdin.enqueue("x");
    expect(handle.lastFrame()).not.toContain("can't run");

    handle.unmount();
  });

  test("Enter on an enabled command resolves and exits command mode", () => {
    const seen: ShellAction[] = [];
    const handle = render(
      <ShellInputProbe onResolve={(action) => seen.push(action)} exposeSetLocked={() => {}} />,
    );

    handle.stdin.enqueue("/");
    handle.stdin.enqueue("source");
    handle.stdin.enqueue("\r");
    expect(seen).toEqual(["source"]);
    expect(handle.lastFrame()).toContain("unlocked:normal");

    // The next shortcut reaches the surface — the palette is not still eating keys.
    handle.stdin.enqueue("o");
    expect(seen).toEqual(["source", "source"]);

    handle.unmount();
  });

  test("Enter with no matching command says so", () => {
    const handle = render(<ShellInputProbe onResolve={() => {}} exposeSetLocked={() => {}} />);

    handle.stdin.enqueue("/");
    handle.stdin.enqueue("zzz");
    handle.stdin.enqueue("\r");
    expect(handle.lastFrame()).toContain("no command matches that");

    handle.unmount();
  });

  test("slashHandledExternally keeps / with the surface instead of opening the palette", () => {
    const seen: ShellAction[] = [];
    const handle = render(
      <ShellInputProbe
        onResolve={(action) => seen.push(action)}
        exposeSetLocked={() => {}}
        slashHandledExternally
      />,
    );

    // Both `/` entry points — the router's open-command-palette command and a
    // command-mode footer action — must yield when the surface owns the key.
    // Settings uses `/` as its search prefix; without this the palette opened
    // while the settings query also swallowed the slash.
    handle.stdin.enqueue("/");
    expect(handle.lastFrame()).toContain("unlocked:normal");
    expect(seen).toEqual([]);

    // Other footer keys still work under the flag.
    handle.stdin.enqueue("o");
    expect(seen).toEqual(["source"]);

    handle.unmount();
  });
});
