import { expect, test } from "bun:test";

import { requestBrowseIdleContextRefresh } from "@/app-shell/browse-idle-context";
import { BrowseShell } from "@/app-shell/browse-shell";
import type { BrowseIdleContext } from "@/app-shell/types";
import React, { act, createRef, useImperativeHandle, useState } from "react";

import { render } from "../../harness/render-capture";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderDeferredBrowse(loadIdleContext: () => Promise<BrowseIdleContext | undefined>) {
  return render(
    <BrowseShell
      mode="series"
      provider="vidking"
      placeholder="Breaking Bad"
      commands={[]}
      loadIdleContext={loadIdleContext}
      onSearch={async () => ({ options: [], subtitle: "" })}
      onResolve={() => {}}
      onSubmit={() => {}}
      onCancel={() => {}}
    />,
    { columns: 100, rows: 32 },
  );
}

test("personal shortcuts hydrate without replacing typed search or stealing focus", async () => {
  const pending = deferred<BrowseIdleContext | undefined>();
  const handle = renderDeferredBrowse(() => pending.promise);

  try {
    expect(handle.lastFrame()).toContain("Search title");
    expect(handle.lastFrame()).toContain("Breaking Bad");
    expect(handle.lastFrame()).toContain("Type a title");

    handle.stdin.enqueue(["D", "u", "n", "e"]);

    await act(async () => {
      pending.resolve({
        continueWatching: {
          title: "Continue Me",
          titleId: "tmdb:1",
          mediaKind: "series",
          ep: "S01E02",
        },
      });
      await pending.promise;
    });

    expect(handle.lastFrame()).toContain("Dune");
    expect(handle.lastFrame()).toContain("Continue Me");
    expect(handle.lastFrame()).not.toContain("▌ ⏸");
  } finally {
    handle.unmount();
  }
});

test("personal shortcut failure leaves search usable", async () => {
  const pending = deferred<BrowseIdleContext | undefined>();
  const handle = renderDeferredBrowse(() => pending.promise);

  try {
    await act(async () => {
      pending.reject(new Error("local read failed"));
      await pending.promise.catch(() => {});
    });

    expect(handle.lastFrame()).toContain("Search title");
    expect(handle.lastFrame()).toContain("Local shortcuts unavailable");
    handle.stdin.enqueue(["A", "l", "i", "e", "n"]);
    expect(handle.lastFrame()).toContain("Alien");
  } finally {
    handle.unmount();
  }
});

test("mode replacement and overlapping refreshes reject stale idle results", async () => {
  const initial = deferred<BrowseIdleContext | undefined>();
  const oldRefresh = deferred<BrowseIdleContext | undefined>();
  const next = deferred<BrowseIdleContext | undefined>();
  const replies = [initial, oldRefresh, next];
  let calls = 0;
  const load = () => replies[calls++]!.promise;
  const control = createRef<{ switchMode: () => void }>();
  function StatefulBrowse() {
    const [mode, setMode] = useState<"series" | "anime">("series");
    useImperativeHandle(control, () => ({ switchMode: () => setMode("anime") }), []);
    return (
      <BrowseShell
        mode={mode}
        provider="vidlink"
        placeholder="Search"
        commands={[]}
        loadIdleContext={load}
        onSearch={async () => ({ options: [], subtitle: "" })}
        onResolve={() => {}}
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    );
  }
  const handle = render(<StatefulBrowse />, { columns: 100, rows: 32 });
  try {
    await act(async () =>
      initial.resolve({ savedNext: { titleId: "tmdb:1", title: "Old initial", total: 1 } }),
    );
    act(() => requestBrowseIdleContextRefresh());
    await act(async () => control.current!.switchMode());
    expect(calls).toBe(3);
    await act(async () =>
      next.resolve({ savedNext: { titleId: "anilist:1", title: "New anime", total: 1 } }),
    );
    expect(handle.lastFrame()).toContain("New anime");
    await act(async () =>
      oldRefresh.resolve({ savedNext: { titleId: "tmdb:2", title: "Stale movie", total: 1 } }),
    );
    expect(handle.lastFrame()).toContain("New anime");
    expect(handle.lastFrame()).not.toContain("Stale movie");
  } finally {
    handle.unmount();
  }
});

test("the newest refresh owns home even when an earlier request finishes last", async () => {
  const initial = deferred<BrowseIdleContext | undefined>();
  const first = deferred<BrowseIdleContext | undefined>();
  const second = deferred<BrowseIdleContext | undefined>();
  const replies = [initial, first, second];
  let calls = 0;
  const handle = renderDeferredBrowse(() => replies[calls++]!.promise);
  try {
    await act(async () => initial.resolve(undefined));
    act(() => requestBrowseIdleContextRefresh());
    act(() => requestBrowseIdleContextRefresh());
    await act(async () =>
      second.resolve({ savedNext: { titleId: "tmdb:2", title: "Newest saved", total: 1 } }),
    );
    await act(async () =>
      first.resolve({ savedNext: { titleId: "tmdb:1", title: "Stale saved", total: 1 } }),
    );
    expect(handle.lastFrame()).toContain("Newest saved");
    expect(handle.lastFrame()).not.toContain("Stale saved");
  } finally {
    handle.unmount();
  }
});
