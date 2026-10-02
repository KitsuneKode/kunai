import { expect, test } from "bun:test";

import type { BrowseShellOption } from "@/app-shell/types";
import { useResultNarrow, type ResultNarrowEsc } from "@/app-shell/use-result-narrow";
import { Text, useInput } from "ink";
import React, { act } from "react";

import { render } from "../../harness/render-capture";

const ESC = String.fromCharCode(27);

function makeOptions(count: number): readonly BrowseShellOption<string>[] {
  return Array.from({ length: count }, (_, index) => ({
    value: `opt-${index}`,
    label: index === 0 ? "Frieren" : `Result ${index}`,
  }));
}

const TWO_OPTIONS = makeOptions(2);
const MANY_OPTIONS = makeOptions(20);

function Probe({
  options = TWO_OPTIONS,
  query = "",
  searchState = "ready",
  isCalendarView = false,
  ultraCompact = false,
  filterFocused = false,
  onEsc,
}: {
  readonly options?: readonly BrowseShellOption<string>[];
  readonly query?: string;
  readonly searchState?: "idle" | "loading" | "ready" | "error";
  readonly isCalendarView?: boolean;
  readonly ultraCompact?: boolean;
  readonly filterFocused?: boolean;
  readonly onEsc?: (layer: ResultNarrowEsc) => void;
}) {
  const narrow = useResultNarrow({ options, query, searchState, isCalendarView, ultraCompact });
  useInput((input, key) => {
    // Real keystrokes drive hook actions exactly the way the shell's handlers
    // do: `n` types a needle, `f` is the Ctrl+F open, Esc consults the layer.
    if (input === "n") narrow.type("frieren");
    if (input === "f") narrow.open();
    if (input === "c") narrow.clearNarrow();
    if (input === "x") narrow.clearAll();
    if (input === "b") narrow.setBadges(["local year:2024"]);
    if (key.escape) {
      onEsc?.(narrow.escape({ filterFocused, queryNonEmpty: query.trim().length > 0 }));
    }
  });
  return (
    <Text>
      {`value=${narrow.value} mode=${narrow.modeOpen ? 1 : 0} bar=${narrow.showBar ? 1 : 0} shown=${narrow.narrowedOptions.length} chips=${narrow.structuredFilterChips.length} badges=${narrow.badges.join("+")}`}
    </Text>
  );
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

async function pressEscape(handle: ReturnType<typeof render>): Promise<void> {
  await act(async () => {
    handle.stdin.enqueue([ESC]);
    // Ink defers a lone ESC briefly to disambiguate escape sequences.
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
}

test("typing narrows the loaded option set and opens filter mode", async () => {
  const handle = render(<Probe />);
  try {
    expect(handle.lastFrame()).toContain("value= mode=0 bar=0 shown=2");
    await press(handle, ["n"]);
    expect(handle.lastFrame()).toContain("value=frieren mode=1 bar=0 shown=1");
  } finally {
    handle.unmount();
  }
});

test("filter bar stays hidden under the minimum-count gate but records mode", async () => {
  const handle = render(<Probe options={TWO_OPTIONS} />);
  try {
    expect(handle.lastFrame()).toContain("bar=0");
    await press(handle, ["f"]);
    expect(handle.lastFrame()).toContain("mode=1 bar=0");
  } finally {
    handle.unmount();
  }
});

test("filter bar shows once the result set clears the minimum", async () => {
  const handle = render(<Probe options={MANY_OPTIONS} />);
  try {
    expect(handle.lastFrame()).toContain("bar=0 shown=20");
    await press(handle, ["f"]);
    expect(handle.lastFrame()).toContain("mode=1 bar=1");
  } finally {
    handle.unmount();
  }
});

test("calendar view never earns the local filter bar", async () => {
  const handle = render(<Probe options={MANY_OPTIONS} isCalendarView />);
  try {
    await press(handle, ["n"]);
    expect(handle.lastFrame()).toContain("value=frieren mode=1 bar=0");
  } finally {
    handle.unmount();
  }
});

test("Esc with an open or typed narrow is consumed inside the hook", async () => {
  const layers: ResultNarrowEsc[] = [];
  const handle = render(<Probe onEsc={(layer) => layers.push(layer)} />);
  try {
    await press(handle, ["n"]);
    expect(handle.lastFrame()).toContain("value=frieren mode=1");

    await pressEscape(handle);
    expect(layers).toEqual([{ layer: "narrow" }]);
    expect(handle.lastFrame()).toContain("value= mode=0 bar=0 shown=2");
  } finally {
    handle.unmount();
  }
});

test("Esc on a chip-bearing query returns the stripped plain query", async () => {
  const layers: ResultNarrowEsc[] = [];
  const handle = render(
    <Probe query="isekai mode:anime year:2024" onEsc={(layer) => layers.push(layer)} />,
  );
  try {
    expect(handle.lastFrame()).toContain("chips=2");
    await pressEscape(handle);
    expect(layers).toEqual([{ layer: "chips", plainQuery: "isekai" }]);
  } finally {
    handle.unmount();
  }
});

test("Esc falls through to query, then cancel, once narrow and chips are empty", async () => {
  const layers: ResultNarrowEsc[] = [];
  const handle = render(<Probe query="isekai" onEsc={(layer) => layers.push(layer)} />);
  try {
    await pressEscape(handle);
    expect(layers).toEqual([{ layer: "query" }]);
  } finally {
    handle.unmount();
  }

  const emptyLayers: ResultNarrowEsc[] = [];
  const empty = render(<Probe onEsc={(layer) => emptyLayers.push(layer)} />);
  try {
    await pressEscape(empty);
    expect(emptyLayers).toEqual([{ layer: "cancel" }]);
  } finally {
    empty.unmount();
  }
});

test("narrow layer wins over chips when the field is focused", async () => {
  const layers: ResultNarrowEsc[] = [];
  const handle = render(
    <Probe query="mode:anime" filterFocused onEsc={(layer) => layers.push(layer)} />,
  );
  try {
    await pressEscape(handle);
    // Focused-but-empty narrow still intercepts before the chips layer.
    expect(layers).toEqual([{ layer: "narrow" }]);
  } finally {
    handle.unmount();
  }
});

test("clearNarrow drops the typed filter but keeps provider badges", async () => {
  const handle = render(<Probe />);
  try {
    await press(handle, ["b"]);
    await press(handle, ["n"]);
    expect(handle.lastFrame()).toContain("badges=local year:2024");

    await press(handle, ["c"]);
    expect(handle.lastFrame()).toContain(
      "value= mode=0 bar=0 shown=2 chips=0 badges=local year:2024",
    );
  } finally {
    handle.unmount();
  }
});

test("clearAll resets the whole cluster including badges", async () => {
  const handle = render(<Probe />);
  try {
    await press(handle, ["b"]);
    await press(handle, ["n"]);
    await press(handle, ["x"]);
    expect(handle.lastFrame()).toContain("value= mode=0 bar=0 shown=2 chips=0 badges=");
  } finally {
    handle.unmount();
  }
});
