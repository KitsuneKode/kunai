import { describe, expect, test } from "bun:test";

import { resolveRootSurfaceCommand } from "@/app-shell/root-workflow-dispatch";
import type { ShellAction } from "@/app-shell/types";
import type { Container } from "@/container";
import type { SessionState } from "@/domain/session/SessionState";

type Dispatched = { readonly type: string } & Record<string, unknown>;

function createHarness(options: { readonly attentionInbox?: boolean } = {}) {
  const dispatched: Dispatched[] = [];
  const container = {
    stateManager: {
      getState: () => ({ activeModals: [] }),
      dispatch: (event: Dispatched) => {
        dispatched.push(event);
      },
      subscribe: () => () => {},
    },
    featureFlags: { attentionInbox: options.attentionInbox ?? true },
    diagnosticsService: { record: () => {} },
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
  } as unknown as Container;

  // SAFETY: deliberately partial test stub — the resolver only reads provider/mode.
  const state = { provider: "hianime", mode: "anime" } as unknown as SessionState;
  return { container, state, dispatched };
}

describe("resolveRootSurfaceCommand", () => {
  test("settings resolves to the settings overlay", () => {
    const { container, state, dispatched } = createHarness();
    resolveRootSurfaceCommand({ container, state, action: "settings" });
    expect(dispatched).toEqual([{ type: "OPEN_OVERLAY", overlay: { type: "settings" } }]);
  });

  test("provider resolves to a lane-scoped provider picker", () => {
    const { container, state, dispatched } = createHarness();
    resolveRootSurfaceCommand({ container, state, action: "provider" });
    expect(dispatched).toEqual([
      {
        type: "OPEN_OVERLAY",
        overlay: { type: "provider_picker", currentProvider: "hianime", lane: "anime" },
      },
    ]);
  });

  test("history resolves to the watching-filtered history overlay", () => {
    const { container, state, dispatched } = createHarness();
    resolveRootSurfaceCommand({ container, state, action: "history" });
    expect(dispatched).toEqual([
      { type: "OPEN_OVERLAY", overlay: { type: "history", initialFilterMode: "watching" } },
    ]);
  });

  test("notifications refuse visibly when the inbox flag is off", () => {
    const { container, state, dispatched } = createHarness({ attentionInbox: false });
    resolveRootSurfaceCommand({ container, state, action: "notifications" });
    expect(dispatched).toEqual([
      {
        type: "SET_PLAYBACK_FEEDBACK",
        note: "Attention inbox is disabled.",
      },
    ]);
  });

  test("a picker id cancels the picker before the overlay opens", () => {
    const { container, state, dispatched } = createHarness();
    resolveRootSurfaceCommand({
      container,
      state,
      action: "library" as ShellAction,
      cancelPickerId: "picker-7",
    });
    expect(dispatched).toEqual([
      { type: "CANCEL_PICKER", id: "picker-7" },
      { type: "OPEN_OVERLAY", overlay: { type: "library", view: "library" } },
    ]);
  });
});
