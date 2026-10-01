import { expect, test } from "bun:test";

import { requestBrowseIdleContextRefresh } from "@/app-shell/browse-idle-context";
import type { BrowseIdleContext } from "@/app-shell/types";
import { useIdleSurface, type IdleSurfaceMove } from "@/app-shell/use-idle-surface";
import { Text, useInput } from "ink";
import React, { act } from "react";

import { render } from "../../harness/render-capture";

const ESC = String.fromCharCode(27);
const DOWN = `${ESC}[B`;
const UP = `${ESC}[A`;

const TWO_ROW_CONTEXT: BrowseIdleContext = {
  continueWatching: { title: "Frieren", ep: "E12", titleId: "frieren", mediaKind: "series" },
  playlistNext: { title: "Solo Leveling", ep: "S02E04", titleId: "solo", mediaKind: "series" },
  todayReleaseCount: 0,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function Probe({
  context,
  load,
  idleFocused = true,
  onMove,
  onAction,
}: {
  readonly context?: BrowseIdleContext;
  readonly load?: () => Promise<BrowseIdleContext | undefined>;
  readonly idleFocused?: boolean;
  readonly onMove?: (move: IdleSurfaceMove) => void;
  readonly onAction?: (action: string) => void;
}) {
  const idle = useIdleSurface({ initial: context, load, idleFocused });
  useInput((_input, key) => {
    if (key.downArrow) onMove?.(idle.moveDown());
    if (key.upArrow) onMove?.(idle.moveUp());
    if (key.return) {
      const action = idle.selectedRowAction();
      if (action) onAction?.(action);
    }
  });
  return (
    <Text>
      {`status=${idle.status} idx=${idle.selectedIndex} rows=${idle.model?.rows.length ?? 0} hint=${idle.showLoadingHint ? 1 : 0} menu=${idle.menuReady ? 1 : 0}`}
    </Text>
  );
}

async function settle(ms = 5): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

// Each key is its own chunk and its own act(): a burst inside one act() gets
// React-batched, and the next key's handler would see the pre-batch state.
async function press(handle: ReturnType<typeof render>, keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    await act(async () => {
      handle.stdin.enqueue([key]);
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

test("loader resolves into ready rows", async () => {
  const gate = deferred<BrowseIdleContext | undefined>();
  // Stable function identity — a per-render loader re-fires the load effect.
  const load = () => gate.promise;
  const handle = render(<Probe load={load} />);
  expect(handle.lastFrame()).toContain("status=loading");

  await act(async () => {
    gate.resolve(TWO_ROW_CONTEXT);
    await gate.promise;
  });
  await settle();
  expect(handle.lastFrame()).toContain("status=ready");
  expect(handle.lastFrame()).toContain("rows=2");
});

test("the loading hint only earns a render after its beat", async () => {
  const gate = deferred<BrowseIdleContext | undefined>();
  const load = () => gate.promise;
  const handle = render(<Probe load={load} />);
  expect(handle.lastFrame()).toContain("hint=0");
  // Past the 150ms beat while the promise is still pending.
  await settle(220);
  expect(handle.lastFrame()).toContain("hint=1");

  await act(async () => {
    gate.resolve(TWO_ROW_CONTEXT);
  });
  await settle();
  expect(handle.lastFrame()).toContain("hint=0");
});

test("down past the last row exits to the query and resets the index", async () => {
  const moves: IdleSurfaceMove[] = [];
  const handle = render(<Probe context={TWO_ROW_CONTEXT} onMove={(move) => moves.push(move)} />);
  await press(handle, [DOWN]);
  expect(handle.lastFrame()).toContain("idx=1");
  expect(moves).toEqual(["moved"]);

  await press(handle, [DOWN]);
  expect(moves).toEqual(["moved", "exit-to-query"]);
  expect(handle.lastFrame()).toContain("idx=0");
});

test("down on an empty surface still exits to the query", async () => {
  const moves: IdleSurfaceMove[] = [];
  const handle = render(<Probe onMove={(move) => moves.push(move)} />);
  expect(handle.lastFrame()).toContain("rows=0");
  await press(handle, [DOWN]);
  expect(moves).toEqual(["exit-to-query"]);
});

test("up from the first row escapes the surface", async () => {
  const moves: IdleSurfaceMove[] = [];
  const handle = render(<Probe context={TWO_ROW_CONTEXT} onMove={(move) => moves.push(move)} />);
  await press(handle, [DOWN]);
  await press(handle, [UP]);
  expect(moves).toEqual(["moved", "moved"]);

  await press(handle, [UP]);
  expect(moves).toEqual(["moved", "moved", "escape"]);
});

test("Enter resolves the focused row's shell action", async () => {
  const actions: string[] = [];
  const handle = render(
    <Probe context={TWO_ROW_CONTEXT} onAction={(action) => actions.push(action)} />,
  );
  await press(handle, ["\r"]);
  expect(actions).toEqual(["resume-continue-watching"]);
});

test("menu readiness follows the focused row's title, not just focus", async () => {
  const handle = render(<Probe context={TWO_ROW_CONTEXT} />);
  // "continue" row has a titleId — menu-ready.
  expect(handle.lastFrame()).toContain("menu=1");
  // An unfocused surface is never menu-ready even on a title row.
  const blurred = render(<Probe context={TWO_ROW_CONTEXT} idleFocused={false} />);
  await settle();
  expect(blurred.lastFrame()).toContain("menu=0");
});

test("post-history refresh swaps context without touching selection", async () => {
  let served = TWO_ROW_CONTEXT;
  const moves: IdleSurfaceMove[] = [];
  const load = () => Promise.resolve(served);
  const handle = render(<Probe load={load} onMove={(move) => moves.push(move)} />);
  await settle();
  expect(handle.lastFrame()).toContain("rows=2");

  await press(handle, [DOWN]);
  expect(moves).toEqual(["moved"]);
  expect(handle.lastFrame()).toContain("idx=1");

  served = { ...TWO_ROW_CONTEXT, todayReleaseCount: 3, todayReleaseTitleCount: 2 };
  await act(async () => {
    requestBrowseIdleContextRefresh();
    await Promise.resolve();
  });
  await settle();
  expect(handle.lastFrame()).toContain("rows=3");
  expect(handle.lastFrame()).toContain("idx=1");
});
