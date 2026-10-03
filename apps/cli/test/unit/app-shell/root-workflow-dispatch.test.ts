import { describe, expect, test } from "bun:test";

import { resolveRootSurfaceCommand } from "@/app-shell/root-workflow-dispatch";
import type { ShellAction } from "@/app-shell/types";
import type { Container } from "@/container";
import type { SessionState, StateTransition } from "@/domain/session/SessionState";

type Dispatched = StateTransition;

function createHarness(
  options: { readonly attentionInbox?: boolean } = {},
  topOverlay: SessionState["activeModals"][number] | null = null,
) {
  const dispatched: Dispatched[] = [];
  // SAFETY: deliberately partial test stub — the dispatcher only reads the members defined below.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the stub's narrower member shapes force the unknown hop
  const container = {
    stateManager: {
      getState: () => ({ activeModals: topOverlay ? [topOverlay] : [] }),
      dispatch: (event: Dispatched) => {
        dispatched.push(event);
      },
      subscribe: () => () => {},
    },
    featureFlags: { attentionInbox: options.attentionInbox ?? true },
    diagnosticsService: { record: () => {} },
  } as unknown as Container;

  // SAFETY: deliberately partial test stub — the resolver only reads provider/mode.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the stub's narrower shape forces the unknown hop
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

  test("a picker top settles its waiter before the new overlay opens", () => {
    const { container, state, dispatched } = createHarness(
      {},
      {
        type: "episode_picker",
        id: "picker-7",
        season: 1,
        options: [],
        selectedIndex: 0,
        filterQuery: "",
      },
    );
    // SAFETY: "library" is a ShellAction member; the literal needs no widened annotation.
    resolveRootSurfaceCommand({ container, state, action: "library" as ShellAction });
    expect(dispatched).toEqual([
      { type: "CANCEL_PICKER", id: "picker-7" },
      { type: "OPEN_OVERLAY", overlay: { type: "library", view: "library" } },
    ]);
  });

  test("a tracks_panel top settles its waiter instead of stranding the playback loop", () => {
    const { container, state, dispatched } = createHarness(
      {},
      { type: "tracks_panel", id: "tracks-9", groups: [], favorites: [] },
    );
    resolveRootSurfaceCommand({ container, state, action: "settings" });
    expect(dispatched).toEqual([
      { type: "CLOSE_TOP_OVERLAY" },
      { type: "CANCEL_PICKER", id: "tracks-9" },
      { type: "OPEN_OVERLAY", overlay: { type: "settings" } },
    ]);
  });
});
