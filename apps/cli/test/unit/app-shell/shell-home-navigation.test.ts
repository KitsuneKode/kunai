import { describe, expect, test } from "bun:test";

import { pointerClickIntent } from "@/app-shell/mouse/pointer-activation";
import {
  HOME_POINTER_ARM_KEY,
  PLAYBACK_HOME_POINTER_CONFIRM,
  resolveShellHomeNavigation,
} from "@/app-shell/shell-home-navigation";

describe("shell home navigation", () => {
  test("playback and loading stop via search", () => {
    expect(
      resolveShellHomeNavigation({ rootKind: "playback", overlayCount: 0, browseAtHome: false }),
    ).toEqual({ kind: "stop-playback-search" });
    expect(
      resolveShellHomeNavigation({ rootKind: "loading", overlayCount: 0, browseAtHome: false }),
    ).toEqual({ kind: "stop-playback-search" });
  });

  test("post-playback closes the mounted session", () => {
    expect(
      resolveShellHomeNavigation({
        rootKind: "post-playback",
        overlayCount: 0,
        browseAtHome: false,
      }),
    ).toEqual({ kind: "close-post-playback" });
  });

  test("a root picker closes instead of toggling a stale browse home", () => {
    expect(
      resolveShellHomeNavigation({ rootKind: "picker", overlayCount: 0, browseAtHome: true }),
    ).toEqual({ kind: "close-picker" });
  });

  test("idle browse home toggles return without leaving", () => {
    expect(
      resolveShellHomeNavigation({ rootKind: "browse", overlayCount: 0, browseAtHome: true }),
    ).toEqual({ kind: "toggle-browse-return" });
  });

  test("otherwise home leaves browse and snapshots overlays", () => {
    expect(
      resolveShellHomeNavigation({ rootKind: "browse", overlayCount: 2, browseAtHome: false }),
    ).toEqual({ kind: "leave-for-browse" });
    expect(
      resolveShellHomeNavigation({ rootKind: null, overlayCount: 1, browseAtHome: false }),
    ).toEqual({ kind: "leave-for-browse" });
  });
});

describe("playback home pointer confirm", () => {
  test("the fox needs two clicks before leaving playback", () => {
    expect(PLAYBACK_HOME_POINTER_CONFIRM).toContain("⌃G");
    const first = pointerClickIntent(null, HOME_POINTER_ARM_KEY, true);
    expect(first.intent).toBe("select");
    const second = pointerClickIntent(first.priorKey, HOME_POINTER_ARM_KEY, true);
    expect(second.intent).toBe("activate");
  });
});
