import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";

import { BrowseShell } from "@/app-shell/browse-shell";
import { render as inkRender, Box, Text, useInput } from "ink";
import { act, useRef } from "react";

import { MouseSplitStdin } from "../../../../src/app-shell/mouse/mouse-stdin";
import {
  MouseDispatcher,
  MouseDispatchProvider,
  useMouseRegion,
} from "../../../../src/app-shell/mouse/MouseRegions";
// Named import for the side effect: the module sets IS_REACT_ACT_ENVIRONMENT
// before act() is first called, so state updates flush inside act() bounds.
import { CAPTURE_WIDTHS } from "../../../harness/render-capture";

class FakeSource extends EventEmitter {
  isTTY = true;
  private queue: string[] = [];
  feed(data: string): void {
    this.queue.push(data);
    this.emit("readable");
  }
  read(): string | null {
    return this.queue.shift() ?? null;
  }
  setEncoding(): void {}
  setRawMode(): void {}
  ref(): void {}
  unref(): void {}
  pause(): void {}
  resume(): void {}
}

class FakeStdout extends EventEmitter {
  readonly frames: string[] = [];
  isTTY = true;
  constructor(
    public columns = CAPTURE_WIDTHS.medium,
    public rows = 45,
  ) {
    super();
  }
  write = (frame: string): boolean => {
    this.frames.push(frame);
    return true;
  };
}

type LogEntry = readonly [string, ...unknown[]];

function makeProbe(log: LogEntry[]) {
  const keys: string[] = [];
  function Probe() {
    const ref = useRef(null);
    useMouseRegion(ref, "probe", {
      onClick: (event) => log.push(["click", event.x, event.y]),
      onWheel: (direction, event) => log.push(["wheel", direction, event.y]),
    });
    useInput((input) => {
      keys.push(input);
    });
    return (
      <Box ref={ref} width={10} height={3}>
        <Text>row</Text>
      </Box>
    );
  }
  return { Probe, keys };
}

function mountWithMouse(node: React.ReactElement) {
  const source = new FakeSource();
  const dispatcher = new MouseDispatcher();
  const proxy = new MouseSplitStdin(source, dispatcher, { write: () => {} });
  proxy.attach();
  const stdout = new FakeStdout();
  let instance: { unmount(): void };
  act(() => {
    instance = inkRender(
      <MouseDispatchProvider dispatcher={dispatcher}>{node}</MouseDispatchProvider>,
      {
        stdout: stdout as unknown as NodeJS.WriteStream,
        stdin: proxy as unknown as NodeJS.ReadStream,
        debug: true,
        exitOnCtrlC: false,
        patchConsole: false,
        interactive: true,
      },
    );
  });
  return {
    source,
    dispatcher,
    proxy,
    stdout,
    lastFrame: () => stdout.frames.at(-1) ?? "",
    /** Raw SGR click (press + release) at a terminal cell. */
    click: (x: number, y: number) => {
      act(() => {
        source.feed(`\x1b[<0;${x};${y}M\x1b[<0;${x};${y}m`);
      });
    },
    unmount: () => {
      act(() => instance.unmount());
      proxy.detach();
    },
  };
}

describe("useMouseRegion through real Ink render", () => {
  test("a press+release inside the measured rect fires onClick", () => {
    const log: LogEntry[] = [];
    const { Probe } = makeProbe(log);
    const { source, unmount } = mountWithMouse(<Probe />);
    // Region: terminal cols 1-10, rows 1-3. Click at (4,2).
    act(() => {
      source.feed("\x1b[<0;4;2M");
      source.feed("\x1b[<0;4;2m");
    });
    expect(log).toEqual([["click", 4, 2]]);
    unmount();
  });

  test("clicks outside the rect and release-only events do not click", () => {
    const log: LogEntry[] = [];
    const { Probe } = makeProbe(log);
    const { source, unmount } = mountWithMouse(<Probe />);
    act(() => {
      source.feed("\x1b[<0;40;20M\x1b[<0;40;20m"); // far outside
      source.feed("\x1b[<0;4;2m"); // release without press
    });
    expect(log).toEqual([]);
    unmount();
  });

  test("mouse bytes never reach useInput; keyboard bytes still do", () => {
    const log: LogEntry[] = [];
    const { Probe, keys } = makeProbe(log);
    const { source, unmount } = mountWithMouse(<Probe />);
    act(() => {
      source.feed("\x1b[<64;5;2M"); // wheel-up inside region
      source.feed("j");
      source.feed("\x1b[A"); // arrow-up escape sequence
    });
    expect(log).toEqual([["wheel", "up", 2]]);
    // Ink's keypress parser splits the arrow sequence into a synthetic name —
    // the exact input value matters less than "no SGR garbage leaked".
    expect(keys).not.toContain("\x1b[<64;5;2M");
    expect(keys.join("")).toContain("j");
    unmount();
  });

  test("press inside + release outside is not a click; wheel routes by position", () => {
    const log: LogEntry[] = [];
    const { Probe } = makeProbe(log);
    const { source, unmount } = mountWithMouse(<Probe />);
    act(() => {
      source.feed("\x1b[<0;4;2M"); // press inside
      source.feed("\x1b[<0;4;40m"); // release outside → no click
      source.feed("\x1b[<65;4;2M"); // wheel-down inside
    });
    expect(log).toEqual([["wheel", "down", 2]]);
    unmount();
  });

  test("unmounted regions stop receiving events", () => {
    const log: LogEntry[] = [];
    const { Probe } = makeProbe(log);
    const { source, dispatcher, unmount } = mountWithMouse(<Probe />);
    expect(dispatcher.size).toBe(1);
    unmount();
    expect(dispatcher.size).toBe(0);
    source.feed("\x1b[<0;4;2M\x1b[<0;4;2m");
    expect(log).toEqual([]);
  });
});

describe("MouseDispatcher", () => {
  test("overlapping regions resolve to the most recently registered", () => {
    const dispatcher = new MouseDispatcher();
    const hits: string[] = [];
    dispatcher.register(
      "under",
      { x: 1, y: 1, width: 50, height: 30 },
      {
        onClick: () => hits.push("under"),
      },
    );
    dispatcher.register(
      "over",
      { x: 5, y: 5, width: 10, height: 5 },
      {
        onClick: () => hits.push("over"),
      },
    );
    dispatcher.dispatch({
      x: 6,
      y: 6,
      button: "left",
      kind: "press",
      ctrl: false,
      shift: false,
      alt: false,
    });
    dispatcher.dispatch({
      x: 6,
      y: 6,
      button: "left",
      kind: "release",
      ctrl: false,
      shift: false,
      alt: false,
    });
    expect(hits).toEqual(["over"]);
  });

  test("a right-button release fires onRightClick, not onClick", () => {
    const dispatcher = new MouseDispatcher();
    const hits: string[] = [];
    dispatcher.register(
      "box",
      { x: 1, y: 1, width: 20, height: 10 },
      {
        onClick: () => hits.push("click"),
        onRightClick: () => hits.push("right"),
      },
    );
    dispatcher.dispatch({
      x: 5,
      y: 5,
      button: "right",
      kind: "press",
      ctrl: false,
      shift: false,
      alt: false,
    });
    dispatcher.dispatch({
      x: 5,
      y: 5,
      button: "right",
      kind: "release",
      ctrl: false,
      shift: false,
      alt: false,
    });
    expect(hits).toEqual(["right"]);
  });

  test("a re-registered region (re-measured) wins over a stale sibling", () => {
    const dispatcher = new MouseDispatcher();
    const hits: string[] = [];
    dispatcher.register(
      "a",
      { x: 1, y: 1, width: 20, height: 10 },
      {
        onClick: () => hits.push("a"),
      },
    );
    dispatcher.register(
      "b",
      { x: 1, y: 1, width: 20, height: 10 },
      {
        onClick: () => hits.push("b"),
      },
    );
    // "a" re-measures (re-registers) → now it is the newest.
    dispatcher.register(
      "a",
      { x: 1, y: 1, width: 20, height: 10 },
      {
        onClick: () => hits.push("a"),
      },
    );
    dispatcher.dispatch({
      x: 5,
      y: 5,
      button: "left",
      kind: "press",
      ctrl: false,
      shift: false,
      alt: false,
    });
    dispatcher.dispatch({
      x: 5,
      y: 5,
      button: "left",
      kind: "release",
      ctrl: false,
      shift: false,
      alt: false,
    });
    expect(hits).toEqual(["a"]);
  });

  test("disabled-looking but registered zero-size rects never hit", () => {
    const dispatcher = new MouseDispatcher();
    const hits: string[] = [];
    dispatcher.register(
      "zero",
      { x: 1, y: 1, width: 0, height: 0 },
      {
        onClick: () => hits.push("zero"),
      },
    );
    const consumed = dispatcher.dispatch({
      x: 1,
      y: 1,
      button: "left",
      kind: "press",
      ctrl: false,
      shift: false,
      alt: false,
    });
    expect(consumed).toBe(false);
    expect(hits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// BrowseShell end-to-end: the real component, real Yoga layout, real SGR bytes.
// Rows register `browse:row:<optionIndex>` regions; we look the rect up from
// the dispatcher (never hardcode coordinates) and feed the cell's bytes in.
// ---------------------------------------------------------------------------

describe("BrowseShell mouse rows", () => {
  function mountBrowse() {
    const submitted: string[] = [];
    const handle = mountWithMouse(
      <BrowseShell
        mode="series"
        provider="vidking"
        placeholder="Search"
        commands={[]}
        initialResults={[
          { value: "first", label: "Alpha One" },
          { value: "second", label: "Beta Two" },
          { value: "third", label: "Gamma Three" },
        ]}
        onSearch={async () => ({ options: [], subtitle: "" })}
        onResolve={() => {}}
        onSubmit={(value) => submitted.push(value as string)}
        onCancel={() => {}}
      />,
    );
    return { ...handle, submitted };
  }

  function rowCenter(dispatcher: MouseDispatcher, index: number) {
    const region = dispatcher.debugRegions().find((r) => r.id === `browse:row:${index}`);
    if (!region) throw new Error(`region browse:row:${index} not registered`);
    return {
      x: region.rect.x + 1,
      y: region.rect.y, // 1-row-tall target
    };
  }

  test("clicking a row selects it; clicking the selected row submits", () => {
    const { dispatcher, click, lastFrame, submitted, unmount } = mountBrowse();
    expect(lastFrame()).toContain("Alpha One");

    // Click row index 1 ("Beta Two") — moves selection, does not submit.
    let cell = rowCenter(dispatcher, 1);
    click(cell.x, cell.y);
    expect(lastFrame()).toContain("▌ Beta Two");
    expect(submitted).toEqual([]);

    // Click the now-selected row — the "click to open" gesture.
    click(cell.x, cell.y);
    expect(submitted).toEqual(["second"]);
    unmount();
  });

  test("wheel ticks over the list move the selection (arrow fallback)", () => {
    const { source, lastFrame, unmount } = mountBrowse();
    expect(lastFrame()).toContain("▌ Alpha One");
    act(() => {
      source.feed("\x1b[<65;10;10M"); // wheel-down over the list area
    });
    expect(lastFrame()).toContain("▌ Beta Two");
    act(() => {
      source.feed("\x1b[<64;10;10M"); // wheel-up
    });
    expect(lastFrame()).toContain("▌ Alpha One");
    unmount();
  });
});
