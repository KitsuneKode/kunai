import { afterEach, expect, test } from "bun:test";

import {
  RootOverlayLoader,
  setRootOverlayModuleImportForTests,
} from "@/app-shell/RootOverlayLoader";
import React, { act } from "react";

import { render } from "../../harness/render-capture";

afterEach(() => {
  setRootOverlayModuleImportForTests(null);
});

function mountLoader(actions: unknown[]) {
  return render(
    <RootOverlayLoader
      overlay={{ type: "help" }}
      state={{} as never}
      container={
        {
          stateManager: {
            dispatch: (action: unknown) => actions.push(action),
          },
        } as never
      }
      onRedraw={() => {}}
    />,
    { columns: 100, rows: 30 },
  );
}

test("loading overlay owns Escape before the implementation module mounts", async () => {
  // The implementation module never resolves, so the loader's loading state
  // deterministically owns input for the whole test.
  setRootOverlayModuleImportForTests(() => new Promise(() => {}));

  const actions: unknown[] = [];
  const handle = mountLoader(actions);
  try {
    expect(handle.lastFrame()).toContain("Opening panel");

    await act(async () => {
      handle.stdin.enqueue("\x1b");
      // Ink defers a lone ESC briefly to disambiguate escape sequences.
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    expect(handle.lastFrame()).toContain("Opening panel");
    expect(actions).toContainEqual({ type: "CLOSE_TOP_OVERLAY" });
  } finally {
    handle.unmount();
  }
});

test("a failed module load shows the failure state and a later mount can retry", async () => {
  setRootOverlayModuleImportForTests(() => Promise.reject(new Error("chunk failed")));

  const actions: unknown[] = [];
  const failed = mountLoader(actions);
  try {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(failed.lastFrame()).toContain("Panel unavailable");
  } finally {
    failed.unmount();
  }

  // The in-flight promise was reset on failure; a later mount retries the import.
  let attempts = 0;
  setRootOverlayModuleImportForTests(() => {
    attempts += 1;
    return new Promise(() => {});
  });
  const retried = mountLoader(actions);
  try {
    expect(retried.lastFrame()).toContain("Opening panel");
    expect(attempts).toBe(1);
  } finally {
    retried.unmount();
  }
});
