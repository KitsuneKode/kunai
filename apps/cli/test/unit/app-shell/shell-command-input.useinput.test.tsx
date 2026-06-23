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
];

function ShellInputProbe({
  onResolve,
  exposeSetLocked,
}: {
  readonly onResolve: (action: ShellAction) => void;
  readonly exposeSetLocked: (setLocked: (locked: boolean) => void) => void;
}) {
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    exposeSetLocked(setLocked);
  }, [exposeSetLocked]);

  const { commandMode } = useShellInput({
    footerActions: FOOTER_ACTIONS,
    commands: COMMANDS,
    disabled: locked,
    onResolve,
  });

  return <Text>{`${locked ? "locked" : "unlocked"}:${commandMode ? "command" : "normal"}`}</Text>;
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
});
