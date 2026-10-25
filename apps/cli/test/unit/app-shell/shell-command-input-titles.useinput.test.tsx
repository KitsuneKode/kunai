import { describe, expect, test } from "bun:test";

import type { ResolvedAppCommand } from "@/app-shell/commands";
import { useShellInput } from "@/app-shell/shell-command-input";
import type { FooterAction, ShellAction } from "@/app-shell/types";
import type { LocalTitleEntry } from "@/domain/palette/local-title-index";
import { Text } from "ink";
import React, { act } from "react";

import { render, type RenderHandle } from "../../harness/render-capture";

const FOOTER_ACTIONS: readonly FooterAction[] = [
  { key: "/", label: "commands", action: "command-mode" },
];

const COMMANDS: readonly ResolvedAppCommand[] = [
  {
    id: "trending",
    label: "Trending",
    aliases: ["trending"],
    description: "What's popular now",
    enabled: true,
  },
];

const TITLE_ENTRIES: readonly LocalTitleEntry[] = [
  {
    titleId: "dune-1984",
    mediaKind: "movie",
    title: "Dune",
    source: "history",
    detail: "history",
  },
];

function PaletteProbe({
  onResolve,
  onTitlePick,
  localTitles,
}: {
  readonly onResolve: (action: ShellAction) => void;
  readonly onTitlePick: (entry: LocalTitleEntry) => void;
  readonly localTitles?: () => readonly LocalTitleEntry[];
}) {
  const { commandMode, commandInput, highlightedIndex, titleMatches } = useShellInput({
    footerActions: FOOTER_ACTIONS,
    commands: COMMANDS,
    onResolve,
    localTitles,
    onTitlePick,
  });

  return (
    <Text>
      {`${commandMode ? "open" : "closed"}|${commandInput}|${highlightedIndex}|${
        titleMatches.length
      }`}
    </Text>
  );
}

const enqueueChars = (stdin: { enqueue: (data: string) => void }, text: string) => {
  for (const char of text) stdin.enqueue(char);
};

/** Ink defers a lone ESC briefly to disambiguate it from an escape sequence. */
async function pressEscape(handle: RenderHandle): Promise<void> {
  await act(async () => {
    handle.stdin.enqueue("");
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
}

describe("useShellInput title rows", () => {
  test("Enter on a navigated title row calls onTitlePick, not onResolve", () => {
    const resolved: ShellAction[] = [];
    const picked: string[] = [];
    const handle = render(
      <PaletteProbe
        onResolve={(action) => resolved.push(action)}
        onTitlePick={(entry) => picked.push(entry.titleId)}
        localTitles={() => TITLE_ENTRIES}
      />,
    );

    handle.stdin.enqueue("/");
    enqueueChars(handle.stdin, "du");
    // JUMP TO section live: one title match under the single command row.
    expect(handle.lastFrame()).toContain("|du|0|1");

    handle.stdin.enqueue("\u001b[B"); // ↓ onto the title row
    handle.stdin.enqueue("\r");

    expect(resolved).toEqual([]);
    expect(picked).toEqual(["dune-1984"]);
    // A completed pick clears the draft.
    expect(handle.lastFrame()).toContain("closed||0|");
    handle.unmount();
  });

  test("commands still outrank titles at the default highlight", () => {
    const resolved: ShellAction[] = [];
    const picked: string[] = [];
    const handle = render(
      <PaletteProbe
        onResolve={(action) => resolved.push(action)}
        onTitlePick={(entry) => picked.push(entry.titleId)}
        localTitles={() => TITLE_ENTRIES}
      />,
    );

    handle.stdin.enqueue("/");
    enqueueChars(handle.stdin, "trending");
    handle.stdin.enqueue("\r");

    expect(resolved).toEqual(["trending"]);
    expect(picked).toEqual([]);
    handle.unmount();
  });

  test("Esc preserves the draft; reopening with / resumes it", async () => {
    const handle = render(
      <PaletteProbe
        onResolve={() => {}}
        onTitlePick={() => {}}
        localTitles={() => TITLE_ENTRIES}
      />,
    );

    handle.stdin.enqueue("/");
    enqueueChars(handle.stdin, "du");
    await pressEscape(handle);
    expect(handle.lastFrame()).toContain("closed|du|");

    handle.stdin.enqueue("/");
    expect(handle.lastFrame()).toContain("open|du|0|1");
    handle.unmount();
  });

  test("title matches re-filter per keystroke without re-reading the source", () => {
    let reads = 0;
    const handle = render(
      <PaletteProbe
        onResolve={() => {}}
        onTitlePick={() => {}}
        localTitles={() => {
          reads += 1;
          return TITLE_ENTRIES;
        }}
      />,
    );

    handle.stdin.enqueue("/");
    expect(reads).toBe(1); // collected exactly once, at open

    enqueueChars(handle.stdin, "dune");
    expect(handle.lastFrame()).toContain("|dune|0|1");
    enqueueChars(handle.stdin, "x");
    expect(handle.lastFrame()).toContain("|dunex|0|0");
    expect(reads).toBe(1); // never a per-keystroke storage hit
    handle.unmount();
  });
});
