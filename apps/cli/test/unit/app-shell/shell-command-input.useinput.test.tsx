import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BrowseShell } from "@/app-shell/browse-shell";
import { useShellInput } from "@/app-shell/shell-command-input";
import type { FooterAction, ShellAction } from "@/app-shell/types";
import type { ResolvedAppCommand } from "@/domain/session/command-registry";
import { kunaiConfigDir } from "@/infra/storage/kunai-paths";
import { flushSearchHistory } from "@/services/persistence/search-history";
import { Text } from "ink";
import React, { useEffect, useState } from "react";
import { act } from "react";

import { render } from "../../harness/render-capture";
import { applyStorageRootEnv } from "../../helpers/storage-env";

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

test.each(["packets", "drain"])("latest shared palette draft submits in one %s", (delivery) => {
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
      if (delivery === "drain") handle.stdin.enqueue(["settings", "\r"]);
      else {
        handle.stdin.enqueue("settings");
        handle.stdin.enqueue("\r");
      }
    });
    expect(seen).toEqual(["settings"]);
  } finally {
    handle.unmount();
  }
});

test.each(["packets", "drain"])(
  "Browse submits the complete search text in one %s",
  async (delivery) => {
    // Enter saves the submitted query to search history. It must land in a
    // throwaway profile: this test wrote "Odyssey" into the developer's real
    // search-history-series.json on every run.
    const sandbox = mkdtempSync(join(tmpdir(), "kunai-shell-command-input-"));
    const restoreEnv = applyStorageRootEnv(sandbox);
    const historyFile = join(kunaiConfigDir(), "search-history-series.json");
    expect(historyFile.startsWith(sandbox)).toBe(true);
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
        if (delivery === "drain") handle.stdin.enqueue(["Odyssey", "\r"]);
        else {
          handle.stdin.enqueue("Odyssey");
          handle.stdin.enqueue("\r");
        }
      });
      expect(seen).toEqual(["Odyssey"]);
      // Wait for the writer while the sandbox is still applied, or the save
      // resolves its path after the restore and lands in the real profile.
      await flushSearchHistory();
      expect(JSON.parse(readFileSync(historyFile, "utf8"))).toEqual(["Odyssey"]);
    } finally {
      handle.unmount();
      restoreEnv();
      rmSync(sandbox, { recursive: true, force: true });
    }
  },
);

test.each(["packets", "drain"])("Browse palette submits its newest draft in one %s", (delivery) => {
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
      if (delivery === "drain") handle.stdin.enqueue(["settings", "\r"]);
      else {
        handle.stdin.enqueue("settings");
        handle.stdin.enqueue("\r");
      }
    });
    expect(seen).toEqual(["settings"]);
  } finally {
    handle.unmount();
  }
});
