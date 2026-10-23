import { expect, test } from "bun:test";

import { fallbackCommandState } from "@/app-shell/shell-command-model";
import { CommandPalette } from "@/app-shell/shell-command-ui";
import React from "react";

import { renderWithPointer } from "../../support/pointer-render";

test("palette pointer focuses before activation and disabled rows never activate", () => {
  const events: string[] = [];
  const commands = fallbackCommandState(["filters", "settings"]).map((command) => ({
    ...command,
    enabled: command.id !== "settings",
    reason: command.id === "settings" ? "Busy" : undefined,
  }));
  const pointer = {
    select: (index: number) => events.push(`focus:${index}`),
    activate: (index: number) => events.push(`run:${index}`),
    close: () => events.push("back"),
  };
  const h = renderWithPointer(
    <CommandPalette input="" commands={commands} highlightedIndex={1} pointer={pointer} />,
    { columns: 100 },
  );
  try {
    h.click("palette:command:filters");
    expect(events).toEqual(["focus:0"]);
    h.rerender(
      <CommandPalette input="" commands={commands} highlightedIndex={0} pointer={pointer} />,
    );
    h.click("palette:command:filters");
    expect(events).toEqual(["focus:0", "run:0"]);
    h.rerender(
      <CommandPalette
        input="settings"
        commands={commands}
        highlightedIndex={0}
        pointer={pointer}
      />,
    );
    h.click("palette:command:settings");
    expect(events).toEqual(["focus:0", "run:0", "focus:0"]);
    h.click("palette:back");
    expect(events.at(-1)).toBe("back");
  } finally {
    h.unmount();
  }
});

test("Browse palette clicks run the same filtered command and close the palette", async () => {
  const { BrowseShell } = await import("@/app-shell/browse-shell");
  const resolved: string[] = [];
  const commands = fallbackCommandState(["settings", "filters"]);
  const h = renderWithPointer(
    <BrowseShell
      mode="series"
      provider="smoke"
      placeholder="Search"
      commands={commands}
      onSearch={async () => ({ options: [], subtitle: "" })}
      onResolve={(action) => resolved.push(action)}
      onSubmit={() => {}}
      onCancel={() => {}}
    />,
    { columns: 100, rows: 30 },
  );
  try {
    h.stdin.enqueue("/");
    h.stdin.enqueue("s");
    h.click("palette:command:settings");
    expect(resolved).toEqual(["settings"]);
    expect(h.dispatcher.debugRegions().some((row) => row.id.startsWith("palette:command:"))).toBe(
      false,
    );
  } finally {
    h.unmount();
  }
});

test("Now Playing Share uses the real command callback and yields to the palette", async () => {
  const { LoadingShell } = await import("@/app-shell/loading-shell");
  const calls: string[] = [];
  const commands = fallbackCommandState(["share"]);
  const h = renderWithPointer(
    <LoadingShell
      state={{
        title: "Smoke Movie",
        operation: "playing",
        commands,
        onCommandAction: (action) => calls.push(action),
      }}
    />,
    { columns: 100, rows: 30 },
  );
  try {
    h.click("playback:share");
    expect(calls).toEqual(["share"]);
    h.stdin.enqueue("/");
    expect(h.dispatcher.debugRegions().some((row) => row.id === "playback:share")).toBe(false);
    h.click("palette:back");
    h.click("playback:share");
    expect(calls).toEqual(["share", "share"]);
  } finally {
    h.unmount();
  }
});
