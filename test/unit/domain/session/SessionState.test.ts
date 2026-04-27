import { describe, expect, test } from "bun:test";

import { resolveCommands } from "@/domain/session/command-registry";
import { createInitialState, reduceState } from "@/domain/session/SessionState";

describe("SessionState overlays", () => {
  test("keeps a shallow overlay stack and closes the top overlay first", () => {
    let state = createInitialState("vidking", "allanime");

    state = reduceState(state, {
      type: "OPEN_OVERLAY",
      overlay: { type: "settings" },
    });
    state = reduceState(state, {
      type: "OPEN_OVERLAY",
      overlay: { type: "confirm", message: "Apply now?" },
    });

    expect(state.activeModals.map((modal) => modal.type)).toEqual(["settings", "confirm"]);

    state = reduceState(state, { type: "CLOSE_TOP_OVERLAY" });
    expect(state.activeModals.map((modal) => modal.type)).toEqual(["settings"]);

    state = reduceState(state, { type: "CLOSE_TOP_OVERLAY" });
    expect(state.activeModals).toHaveLength(0);
  });

  test("updates default providers without mutating the current provider directly", () => {
    let state = createInitialState("vidking", "allanime");

    state = reduceState(state, {
      type: "SET_DEFAULT_PROVIDER",
      mode: "anime",
      provider: "anivibe",
    });

    expect(state.defaultProviders.series).toBe("vidking");
    expect(state.defaultProviders.anime).toBe("anivibe");
    expect(state.provider).toBe("vidking");
  });
});

describe("SessionState responsive layout", () => {
  test("auto-collapses the companion pane on narrow terminals and restores it when width returns", () => {
    let state = createInitialState("vidking", "allanime");

    expect(state.layout.breakpoint).toBe("wide");
    expect(state.layout.companion.visible).toBe(true);

    state = reduceState(state, {
      type: "SET_TERMINAL_SIZE",
      columns: 88,
      rows: 24,
    });

    expect(state.layout.breakpoint).toBe("narrow");
    expect(state.layout.companion.visible).toBe(false);
    expect(state.layout.companion.autoCollapsed).toBe(true);
    expect(state.layout.note).toContain("collapsed");

    state = reduceState(state, {
      type: "SET_TERMINAL_SIZE",
      columns: 150,
      rows: 40,
    });

    expect(state.layout.breakpoint).toBe("wide");
    expect(state.layout.companion.visible).toBe(true);
    expect(state.layout.companion.autoCollapsed).toBe(false);
  });

  test("keeps text details before image preview as the terminal gets tighter", () => {
    let state = createInitialState("vidking", "allanime");

    state = reduceState(state, { type: "SET_IMAGE_SUPPORT", supported: true });
    expect(state.layout.details.visible).toBe(true);
    expect(state.layout.details.imageVisible).toBe(true);

    state = reduceState(state, {
      type: "SET_TERMINAL_SIZE",
      columns: 118,
      rows: 30,
    });

    expect(state.layout.breakpoint).toBe("medium");
    expect(state.layout.companion.visible).toBe(true);
    expect(state.layout.details.visible).toBe(true);
    expect(state.layout.details.imageVisible).toBe(false);
    expect(state.layout.details.imageAutoCollapsed).toBe(true);
  });

  test("respects a user-collapsed companion pane even after the terminal becomes wide again", () => {
    let state = createInitialState("vidking", "allanime");

    state = reduceState(state, { type: "TOGGLE_COMPANION_PANE" });
    expect(state.layout.companion.visible).toBe(false);
    expect(state.layout.companion.userCollapsed).toBe(true);

    state = reduceState(state, {
      type: "SET_TERMINAL_SIZE",
      columns: 88,
      rows: 24,
    });
    state = reduceState(state, {
      type: "SET_TERMINAL_SIZE",
      columns: 150,
      rows: 40,
    });

    expect(state.layout.companion.visible).toBe(false);
    expect(state.layout.companion.userCollapsed).toBe(true);
  });
});

describe("command availability", () => {
  test("explains unavailable commands instead of hiding them", () => {
    let state = createInitialState("vidking", "allanime");
    state = reduceState(state, { type: "SET_IMAGE_SUPPORT", supported: true });
    state = reduceState(state, {
      type: "SELECT_TITLE",
      title: {
        id: "1396",
        type: "series",
        name: "Breaking Bad",
      },
    });
    state = reduceState(state, {
      type: "SELECT_EPISODE",
      episode: { season: 1, episode: 2 },
    });
    state = reduceState(state, {
      type: "SET_EPISODE_NAVIGATION",
      navigation: {
        hasPrevious: true,
        hasNext: false,
        hasNextSeason: false,
        nextUnavailableReason: "No later episode metadata is available yet.",
      },
    });
    state = reduceState(state, {
      type: "OPEN_OVERLAY",
      overlay: { type: "settings" },
    });

    const commands = resolveCommands(state);
    const byId = new Map(commands.map((command) => [command.id, command]));

    expect(byId.get("provider")?.enabled).toBe(true);
    expect(byId.get("replay")?.enabled).toBe(true);
    expect(byId.get("previous")?.enabled).toBe(true);
    expect(byId.get("next")?.enabled).toBe(false);
    expect(byId.get("next")?.reason).toContain("No later episode metadata");
    expect(byId.get("quit")?.enabled).toBe(false);
    expect(byId.get("quit")?.reason).toContain("overlay");
    expect(byId.get("image-pane")?.enabled).toBe(true);
  });
});
