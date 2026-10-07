import { describe, expect, test } from "bun:test";

import { PALETTE_WORKFLOW_ACTIONS } from "@/app-shell/dispatch-palette-command";
import {
  buildGuideRows,
  GUIDE_COMMAND_IDS,
  GUIDE_SECTIONS,
  guideSurfaceFor,
} from "@/app-shell/guide-model";
import { ROOT_OVERLAY_NAV_COMMANDS } from "@/app-shell/root-overlay-shell";
import { SEARCH_BROWSE_COMMAND_IDS } from "@/app-shell/search-browse-command-ids";
import { toShellAction } from "@/app-shell/types";
import { COMMAND_CONTEXTS, COMMANDS, resolveCommands } from "@/domain/session/command-registry";
import { createInitialState } from "@/domain/session/SessionState";

const RUNNABLE_HERE: ReadonlySet<string> = new Set([
  ...ROOT_OVERLAY_NAV_COMMANDS,
  ...PALETTE_WORKFLOW_ACTIONS,
]);
const SEARCH_SURFACE: ReadonlySet<string> = new Set(SEARCH_BROWSE_COMMAND_IDS);

describe("guide directory content", () => {
  test("every guide entry names a registered command id", () => {
    const registered = new Set(COMMANDS.map((command) => command.id));
    for (const id of GUIDE_COMMAND_IDS) {
      expect(registered.has(id)).toBe(true);
    }
  });

  test("no command is listed twice across sections", () => {
    expect(new Set(GUIDE_COMMAND_IDS).size).toBe(GUIDE_COMMAND_IDS.length);
  });

  test("every section lists at least one entry", () => {
    for (const section of GUIDE_SECTIONS) {
      expect(section.entries.length).toBeGreaterThan(0);
    }
  });
});

describe("guide surface tags", () => {
  test("a command the overlay routes itself tags as run", () => {
    // nav-resolved and workflow-resolved both count — Enter fires either path.
    expect(guideSurfaceFor("settings", RUNNABLE_HERE, SEARCH_SURFACE)).toBe("run");
    expect(guideSurfaceFor("pet", RUNNABLE_HERE, SEARCH_SURFACE)).toBe("run");
  });

  test("a browse-listed command the overlay cannot route tags as search", () => {
    expect(guideSurfaceFor("trending", RUNNABLE_HERE, SEARCH_SURFACE)).toBe("search");
    expect(guideSurfaceFor("random", RUNNABLE_HERE, SEARCH_SURFACE)).toBe("search");
  });

  test("a playback-only command tags as playing, a post-play-only one as post-play", () => {
    expect(guideSurfaceFor("quality", RUNNABLE_HERE, SEARCH_SURFACE)).toBe("playing");
    expect(guideSurfaceFor("audio", RUNNABLE_HERE, SEARCH_SURFACE)).toBe("playing");
    // /replay is not listed on the active-playback palette at all — the player
    // reaches it by key — so its honest home tag is post-play.
    expect(guideSurfaceFor("replay", RUNNABLE_HERE, SEARCH_SURFACE)).toBe("post-play");
    expect(guideSurfaceFor("next-season", RUNNABLE_HERE, SEARCH_SURFACE)).toBe("post-play");
  });

  test("the run tag can never outrun the router", () => {
    // If an entry tags "run" but neither nav nor workflow resolves it, the
    // guide would advertise a dead Enter — the exact failure this surface
    // exists to eliminate.
    for (const id of GUIDE_COMMAND_IDS) {
      const surface = guideSurfaceFor(id, RUNNABLE_HERE, SEARCH_SURFACE);
      if (surface === "run") {
        const action = toShellAction(id);
        expect(ROOT_OVERLAY_NAV_COMMANDS.has(action) || PALETTE_WORKFLOW_ACTIONS.has(action)).toBe(
          true,
        );
      }
    }
  });

  test("tagged search rows stay inside the search surface's own command list", () => {
    // The take-me-there path hands {type:"action"} to the browse session — a
    // row tagged search whose id the browse palette does not list would be
    // routed to a surface that never offered it.
    const searchIds: readonly string[] = SEARCH_BROWSE_COMMAND_IDS;
    for (const id of GUIDE_COMMAND_IDS) {
      if (guideSurfaceFor(id, RUNNABLE_HERE, SEARCH_SURFACE) === "search") {
        expect(searchIds).toContain(id);
      }
    }
  });
});

describe("buildGuideRows", () => {
  test("resolves rows from live command state", () => {
    const state = createInitialState("vidking", "allanime", {
      anime: { audio: "sub", subtitle: "en", quality: "auto" },
      series: { audio: "original", subtitle: "en", quality: "auto" },
      movie: { audio: "original", subtitle: "en", quality: "auto" },
    });
    const sections = buildGuideRows({
      commands: resolveCommands(state, GUIDE_COMMAND_IDS),
      runnableHere: RUNNABLE_HERE,
      searchSurface: SEARCH_SURFACE,
    });
    expect(sections.length).toBe(GUIDE_SECTIONS.length);
    const rowCount = sections.reduce((total, section) => total + section.rows.length, 0);
    expect(rowCount).toBe(GUIDE_COMMAND_IDS.length);
    for (const section of sections) {
      for (const row of section.rows) {
        expect(row.invocation.startsWith("/")).toBe(true);
        expect(row.description.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("guide command reachability", () => {
  test("/guide itself is listed on the palettes that can open it", () => {
    // A discovery surface the user cannot discover is the same dead-feature
    // class the guide exists to fix — its own listing is part of the contract.
    expect(SEARCH_BROWSE_COMMAND_IDS).toContain("guide");
    expect(COMMAND_CONTEXTS.rootOverlay).toContain("guide");
    expect(COMMAND_CONTEXTS.modalPicker).toContain("guide");
    expect(COMMAND_CONTEXTS.activePlayback).toContain("guide");
    expect(COMMAND_CONTEXTS.postPlayback).toContain("guide");
  });
});
