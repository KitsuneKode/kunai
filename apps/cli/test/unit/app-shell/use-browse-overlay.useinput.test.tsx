import { expect, test } from "bun:test";

import type { BrowseShellOption } from "@/app-shell/types";
import { useBrowseOverlay, type BrowseOverlayIntent } from "@/app-shell/use-browse-overlay";
import { Text, useInput } from "ink";
import React, { act } from "react";

import { render } from "../../harness/render-capture";

const ESC = String.fromCharCode(27);
const RETURN = "\r";
const DOWN = `${ESC}[B`;

const SELECTED: BrowseShellOption<string> = { value: "sel-1", label: "Frieren" };

function Probe({
  mode = "series",
  selectedOption = SELECTED,
  searchReady = true,
  onIntent,
}: {
  readonly mode?: "series" | "anime" | "youtube";
  readonly selectedOption?: BrowseShellOption<string> | null;
  readonly searchReady?: boolean;
  readonly onIntent?: (intent: BrowseOverlayIntent<string>) => void;
}) {
  const overlay = useBrowseOverlay<string>({ mode });
  useInput((input, key) => {
    // `o` opens the sheet with a "list" stash, `O` with a "query" stash —
    // mirroring the shell passing its live focusZone at open time.
    if (!overlay.current && input === "o") {
      overlay.openDetails(selectedOption ?? undefined, { focusZone: "list" });
      return;
    }
    if (!overlay.current && input === "O") {
      overlay.openDetails(selectedOption ?? undefined, { focusZone: "query" });
      return;
    }
    if (!overlay.current && input === "u") {
      overlay.openDetails(undefined, { focusZone: "list" });
      return;
    }
    onIntent?.(overlay.handleKey(input, key, { selectedOption, searchReady }));
  });
  const current = overlay.current;
  return (
    <Text>
      {`open=${current ? current.type : "none"} title=${current?.title ?? "-"} expanded=${current && current.type === "details" ? (current.seasonsExpanded ? 1 : 0) : "-"} scroll=${current && "scrollIndex" in current ? (current.scrollIndex ?? "-") : "-"}`}
    </Text>
  );
}

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

test("o opens a details overlay seeded from the highlighted option", async () => {
  const handle = render(<Probe />);
  try {
    expect(handle.lastFrame()).toContain("open=none");
    await press(handle, ["o"]);
    expect(handle.lastFrame()).toContain("open=details title=Media dossier");
  } finally {
    handle.unmount();
  }
});

test("openDetails with no option is a no-op", async () => {
  const handle = render(<Probe />);
  try {
    await press(handle, ["u"]);
    expect(handle.lastFrame()).toContain("open=none");
  } finally {
    handle.unmount();
  }
});

test("Esc closes the sheet and returns the stashed focus zone", async () => {
  const intents: BrowseOverlayIntent<string>[] = [];
  const handle = render(<Probe onIntent={(intent) => intents.push(intent)} />);
  try {
    await press(handle, ["o"]);
    expect(handle.lastFrame()).toContain("open=details");

    await pressEscape(handle);
    expect(intents).toEqual([{ kind: "closed", restoreTo: "list" }]);
    expect(handle.lastFrame()).toContain("open=none");
  } finally {
    handle.unmount();
  }
});

test("Esc returns the exact zone stashed at open time", async () => {
  const intents: BrowseOverlayIntent<string>[] = [];
  const handle = render(<Probe onIntent={(intent) => intents.push(intent)} />);
  try {
    await press(handle, ["O"]);
    await pressEscape(handle);
    expect(intents).toEqual([{ kind: "closed", restoreTo: "query" }]);
  } finally {
    handle.unmount();
  }
});

test("Enter submits the highlighted row's value when search is ready", async () => {
  const intents: BrowseOverlayIntent<string>[] = [];
  const handle = render(<Probe onIntent={(intent) => intents.push(intent)} />);
  try {
    await press(handle, ["o"]);
    await press(handle, [RETURN]);
    expect(intents).toEqual([{ kind: "submit", value: "sel-1" }]);
  } finally {
    handle.unmount();
  }
});

test("Enter with search not ready is consumed, not submitted", async () => {
  const intents: BrowseOverlayIntent<string>[] = [];
  const handle = render(<Probe searchReady={false} onIntent={(intent) => intents.push(intent)} />);
  try {
    await press(handle, ["o"]);
    await press(handle, [RETURN]);
    expect(intents).toEqual([{ kind: "consumed" }]);
  } finally {
    handle.unmount();
  }
});

test("s toggles season expansion inside the hook", async () => {
  const intents: BrowseOverlayIntent<string>[] = [];
  const handle = render(<Probe onIntent={(intent) => intents.push(intent)} />);
  try {
    await press(handle, ["o"]);
    expect(handle.lastFrame()).toContain("expanded=0");
    await press(handle, ["s"]);
    expect(handle.lastFrame()).toContain("expanded=1");
    await press(handle, ["s"]);
    expect(handle.lastFrame()).toContain("expanded=0");
    expect(intents).toEqual([{ kind: "consumed" }, { kind: "consumed" }]);
  } finally {
    handle.unmount();
  }
});

test("w/q/d surface the sheet-footer intents for the shell to run", async () => {
  const intents: BrowseOverlayIntent<string>[] = [];
  const handle = render(<Probe onIntent={(intent) => intents.push(intent)} />);
  try {
    await press(handle, ["o"]);
    await press(handle, ["w", "q", "d"]);
    expect(intents).toEqual([{ kind: "watchlist" }, { kind: "queue" }, { kind: "download" }]);
  } finally {
    handle.unmount();
  }
});

test("d is not a download intent while search is not ready", async () => {
  const intents: BrowseOverlayIntent<string>[] = [];
  const handle = render(<Probe searchReady={false} onIntent={(intent) => intents.push(intent)} />);
  try {
    await press(handle, ["o"]);
    await press(handle, ["d"]);
    expect(intents).toEqual([{ kind: "consumed" }]);
  } finally {
    handle.unmount();
  }
});

test("t without a trailer URL is consumed, not a trailer intent", async () => {
  const intents: BrowseOverlayIntent<string>[] = [];
  const handle = render(<Probe onIntent={(intent) => intents.push(intent)} />);
  try {
    await press(handle, ["o"]);
    await press(handle, ["t"]);
    expect(intents).toEqual([{ kind: "consumed" }]);
  } finally {
    handle.unmount();
  }
});

test("every stray key is consumed while a sheet is open", async () => {
  const intents: BrowseOverlayIntent<string>[] = [];
  const handle = render(<Probe onIntent={(intent) => intents.push(intent)} />);
  try {
    await press(handle, ["o"]);
    await press(handle, ["x", "/", DOWN]);
    expect(intents).toEqual([{ kind: "consumed" }, { kind: "consumed" }, { kind: "consumed" }]);
  } finally {
    handle.unmount();
  }
});

test("keys with no overlay open report ignored", async () => {
  const intents: BrowseOverlayIntent<string>[] = [];
  const handle = render(<Probe onIntent={(intent) => intents.push(intent)} />);
  try {
    await press(handle, ["x"]);
    expect(intents).toEqual([{ kind: "ignored" }]);
  } finally {
    handle.unmount();
  }
});
