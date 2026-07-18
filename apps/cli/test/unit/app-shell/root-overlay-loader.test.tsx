import { afterEach, expect, test } from "bun:test";

import { openBrowseShell } from "@/app-shell/browse-shell";
import {
  forceSettleAllRootContent,
  mountRootContent,
  useRootContentSession,
} from "@/app-shell/root-content-state";
import { getRootOwnedOverlay } from "@/app-shell/root-shell-state";
import {
  RootOverlayLoader,
  setRootOverlayModuleImportForTests,
} from "@/app-shell/RootOverlayLoader";
import { useSessionSelector } from "@/app-shell/use-session-selector";
import { SessionStateManagerImpl } from "@/domain/session/SessionStateManager";
import { Text } from "ink";
import React, { act } from "react";

import { render } from "../../harness/render-capture";

afterEach(() => {
  setRootOverlayModuleImportForTests(null);
  forceSettleAllRootContent("root-overlay-loader-test-cleanup");
});

function createStateManager() {
  return new SessionStateManagerImpl({
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    } as never,
  });
}

function ReducerBackedRootHost({ stateManager }: { stateManager: SessionStateManagerImpl }) {
  const state = useSessionSelector(stateManager, (snapshot) => snapshot);
  const rootContent = useRootContentSession();
  const overlay = getRootOwnedOverlay(state);
  if (overlay) {
    return (
      <RootOverlayLoader
        overlay={overlay}
        state={state}
        container={{ stateManager } as never}
        onRedraw={() => {}}
      />
    );
  }
  return rootContent?.element ?? <Text>Browse unavailable</Text>;
}

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

test("a generic root overlay lifecycle preserves the browse draft across shell turnover", async () => {
  setRootOverlayModuleImportForTests(() => new Promise(() => {}));

  const stateManager = createStateManager();
  const queryDraft = { value: "", mode: "series" as const };
  const openBrowse = () =>
    openBrowseShell({
      mode: "series",
      provider: "videasy",
      initialQuery: queryDraft.value,
      queryDraft,
      placeholder: "Breaking Bad",
      commands: [
        {
          id: "help",
          label: "Help",
          aliases: [],
          description: "Open help",
          enabled: true,
        },
      ],
      onSearch: async () => ({ options: [], subtitle: "" }),
    });

  const outcomePromise = openBrowse();
  const handle = render(<ReducerBackedRootHost stateManager={stateManager} />, {
    columns: 100,
    rows: 30,
  });
  try {
    handle.stdin.enqueue(["D", "u", "n", "e"]);
    expect(handle.lastFrame()).toContain("Dune");

    handle.stdin.enqueue("/");
    handle.stdin.enqueue(["h", "e", "l", "p"]);
    handle.stdin.enqueue("\r");
    expect(await outcomePromise).toEqual({ type: "action", action: "help" });

    act(() => {
      stateManager.dispatch({ type: "OPEN_OVERLAY", overlay: { type: "help" } });
    });
    expect(handle.lastFrame()).toContain("Opening panel");

    act(() => {
      stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
      void openBrowse();
    });
    expect(handle.lastFrame()).not.toContain("Opening panel");
    expect(handle.lastFrame()).toContain("Dune");
  } finally {
    handle.unmount();
  }
});

test("a lane switch clears an unsubmitted shared browse draft", async () => {
  const stateManager = createStateManager();
  const queryDraft = { value: "", mode: "series" as const };
  const firstOutcome = openBrowseShell({
    mode: "series",
    provider: "videasy",
    initialQuery: stateManager.getState().searchQuery,
    queryDraft,
    placeholder: "Breaking Bad",
    commands: [],
    onSearch: async () => ({ options: [], subtitle: "" }),
  });
  const handle = render(<ReducerBackedRootHost stateManager={stateManager} />, {
    columns: 100,
    rows: 30,
  });
  try {
    handle.stdin.enqueue(["D", "u", "n", "e"]);
    expect(handle.lastFrame()).toContain("Dune");

    handle.stdin.enqueue("\t");
    expect(await firstOutcome).toEqual({ type: "action", action: "toggle-mode" });

    act(() => {
      stateManager.dispatch({ type: "SET_MODE", mode: "anime", provider: "allanime" });
      void openBrowseShell({
        mode: "anime",
        provider: "allanime",
        initialQuery: stateManager.getState().searchQuery,
        queryDraft,
        placeholder: "Demon Slayer",
        commands: [],
        onSearch: async () => ({ options: [], subtitle: "" }),
      });
    });

    expect(stateManager.getState().searchQuery).toBe("");
    expect(handle.lastFrame()).not.toContain("Dune");
    expect(handle.lastFrame()).toContain("Demon Slayer");
  } finally {
    handle.unmount();
  }
});

test("Escape removes a cold loading scaffold through reducer state", async () => {
  // The implementation module never resolves, so the loader's loading state
  // deterministically owns input for the whole test.
  setRootOverlayModuleImportForTests(() => new Promise(() => {}));

  const stateManager = createStateManager();
  void mountRootContent({
    kind: "browse",
    renderContent: () => <Text>Underlying root content</Text>,
    fallbackValue: undefined,
  });
  const handle = render(<ReducerBackedRootHost stateManager={stateManager} />, {
    columns: 100,
    rows: 30,
  });
  try {
    act(() => {
      stateManager.dispatch({ type: "OPEN_OVERLAY", overlay: { type: "help" } });
    });
    expect(handle.lastFrame()).toContain("Opening panel");

    await act(async () => {
      handle.stdin.enqueue("\x1b");
      // Ink defers a lone ESC briefly to disambiguate escape sequences.
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    expect(stateManager.getState().activeModals).toEqual([]);
    expect(handle.lastFrame()).not.toContain("Opening panel");
    expect(handle.lastFrame()).toContain("Underlying root content");
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
