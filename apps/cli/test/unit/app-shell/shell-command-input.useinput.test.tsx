import { describe, expect, test } from "bun:test";

import { BrowseShell } from "@/app-shell/browse-shell";
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
  commands = COMMANDS,
}: {
  readonly commands?: readonly ResolvedAppCommand[];
  readonly onResolve: (action: ShellAction) => void;
  readonly exposeSetLocked: (setLocked: (locked: boolean) => void) => void;
}) {
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    exposeSetLocked(setLocked);
  }, [exposeSetLocked]);

  const { commandMode } = useShellInput({
    footerActions: FOOTER_ACTIONS,
    commands,
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

test("text and Enter received before a React commit resolve the latest palette draft", () => {
  const seen: ShellAction[] = [];
  const commands: readonly ResolvedAppCommand[] = [
    { id: "sync", label: "Sync", aliases: ["sync"], description: "Sync accounts", enabled: true },
    {
      id: "settings",
      label: "Settings",
      aliases: ["settings"],
      description: "Settings",
      enabled: true,
    },
  ];
  const handle = render(
    <ShellInputProbe
      commands={commands}
      onResolve={(action) => seen.push(action)}
      exposeSetLocked={() => {}}
    />,
  );
  try {
    handle.stdin.enqueue("/");
    act(() => {
      handle.stdin.enqueue("settings");
      handle.stdin.enqueue("\r");
    });
    expect(seen).toEqual(["settings"]);
  } finally {
    handle.unmount();
  }
});

test("Browse submits the complete search text when text and Enter share a commit", async () => {
  const seen: string[] = [];
  const handle = render(
    <BrowseShell
      mode="series"
      provider="vidlink"
      placeholder="Search"
      commands={[]}
      onSearch={async (query) => {
        seen.push(query);
        return { options: [], subtitle: "" };
      }}
      onResolve={() => {}}
      onSubmit={() => {}}
      onCancel={() => {}}
    />,
  );
  try {
    await act(async () => {
      handle.stdin.enqueue("Odyssey");
      handle.stdin.enqueue("\r");
    });
    expect(seen).toEqual(["Odyssey"]);
  } finally {
    handle.unmount();
  }
});

test("Browse palette submits its newest draft before a React commit", () => {
  const seen: ShellAction[] = [];
  const commands: readonly ResolvedAppCommand[] = [
    { id: "sync", label: "Sync", aliases: ["sync"], description: "Sync", enabled: true },
    {
      id: "settings",
      label: "Settings",
      aliases: ["settings"],
      description: "Settings",
      enabled: true,
    },
  ];
  const handle = render(
    <BrowseShell
      mode="series"
      provider="vidlink"
      placeholder="Search"
      commands={commands}
      onSearch={async () => ({ options: [], subtitle: "" })}
      onResolve={(action) => seen.push(action)}
      onSubmit={() => {}}
      onCancel={() => {}}
    />,
  );
  try {
    handle.stdin.enqueue("/");
    act(() => {
      handle.stdin.enqueue("settings");
      handle.stdin.enqueue("\r");
    });
    expect(seen).toEqual(["settings"]);
  } finally {
    handle.unmount();
  }
});
