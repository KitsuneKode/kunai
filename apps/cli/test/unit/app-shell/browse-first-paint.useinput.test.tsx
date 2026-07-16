import { expect, test } from "bun:test";

import { BrowseShell } from "@/app-shell/browse-shell";
import type { BrowseIdleContext } from "@/app-shell/types";
import React, { act } from "react";

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
