import { describe, expect, test } from "bun:test";

import type { ShellAction } from "@/app-shell/types";
import { buildPickerActionContext, waitForOverlayClose } from "@/app-shell/workflows";
import {
  handleShellAction,
  runShellWorkflowFromOverlay,
} from "@/app-shell/workflows/shell-workflows";
import type { Container } from "@/container";

import { createContainerFixture } from "../../support/container-fixture";

describe("workflows characterization", () => {
  test("buildPickerActionContext wires footer mode and command dispatch", () => {
    const { container } = createContainerFixture({
      config: { minimalMode: false, footerHints: "detailed" },
      shellChrome: { footerMode: "detailed" },
    } as never);
    const ctx = buildPickerActionContext({
      container,
      taskLabel: "Pick an episode",
    });

    expect(ctx.taskLabel).toBe("Pick an episode");
    expect(ctx.footerMode).toBeDefined();
    expect(Array.isArray(ctx.commands)).toBe(true);
    expect(typeof ctx.onAction).toBe("function");
  });

  test("a picker offers the consent-bearing overlays, not a narrower hand-list", () => {
    // These two were unreachable from the starting-point pickers while the
    // footer still advertised `[/] commands`, because the surface carried its
    // own array that had drifted from the registry. Analytics and presence are
    // the ones that matter: both govern data leaving the machine, so "the
    // command does not exist" is the wrong answer to give about them anywhere.
    const { container } = createContainerFixture({
      config: { minimalMode: false, footerHints: "detailed" },
      shellChrome: { footerMode: "detailed" },
    } as never);
    const ids = buildPickerActionContext({ container, taskLabel: "Where to start?" }).commands.map(
      (command) => command.id,
    );

    expect(ids).toContain("analytics");
    expect(ids).toContain("presence");
    expect(ids).toContain("settings");
  });

  test("waitForOverlayClose resolves when overlay type is no longer on top", async () => {
    const { stateManager, closeTopOverlay } = createContainerFixture();
    stateManager.dispatch({
      type: "OPEN_OVERLAY",
      overlay: { type: "history" },
    });

    const pending = waitForOverlayClose(stateManager as never, "history");
    closeTopOverlay();

    await expect(pending).resolves.toBeUndefined();
  });
});

/**
 * `actionHandlers` is a `Record<string, ActionHandler | undefined>`, so an action
 * with no entry falls through to `"unhandled"` silently — there is no type error
 * and no log. That is the intended contract (the input router keeps ownership of
 * navigation and playback keys), but it means a split of `shell-workflows.ts`
 * could drop a handler and nothing would fail.
 *
 * These tests pin both sides of the split so a refactor has to be deliberate:
 * the pass-through set answers `"unhandled"` without touching the container, and
 * a workflow-owned action still reaches a handler.
 */
describe("handleShellAction routing contract", () => {
  /**
   * Every `ShellAction` with no entry in `actionHandlers`. The
   * `satisfies readonly ShellAction[]` is load-bearing: if one of these is
   * removed from the union, typecheck fails here rather than the list quietly
   * describing an action that no longer exists.
   */
  const PASS_THROUGH_ACTIONS = [
    "anime-calendar",
    "anime-mode",
    "audio",
    "back-to-results",
    "back-to-search",
    "calendar",
    "command-mode",
    "details",
    "fallback",
    "filters",
    "image-pane",
    "memory",
    "narrow-results",
    "next",
    "next-season",
    "notifications",
    "pick-episode",
    "play-local",
    "play-offline-ready",
    "play-queue-next",
    "previous",
    "quality",
    "random",
    "recommendation",
    "recompute",
    "recover",
    "replay",
    "resume",
    "resume-continue-watching",
    "search",
    "series-calendar",
    "series-mode",
    "source",
    "stop-after-current",
    "subtitle",
    "surprise",
    "toggle-autoplay",
    "toggle-autoskip",
    "toggle-mode",
    "toggle-mode-reverse",
    "tracked-calendar",
    "trending",
    "watch-online",
    "youtube-mode",
  ] as const satisfies readonly ShellAction[];

  /**
   * Any property read is a failure. A pass-through action must not reach a
   * handler at all, so "did not touch the container" is the observable proof —
   * stronger than asserting the return value alone.
   */
  function throwingContainer(): Container {
    return new Proxy(
      {},
      {
        get(_target, property) {
          throw new Error(`handleShellAction read container.${String(property)}`);
        },
      },
    ) as unknown as Container;
  }

  test("every pass-through action answers unhandled without reading the container", async () => {
    const container = throwingContainer();
    for (const action of PASS_THROUGH_ACTIONS) {
      expect(await handleShellAction({ action, container })).toBe("unhandled");
    }
  });

  test("the pass-through set is exactly 44 actions", () => {
    // A handler added for one of these, or a new unhandled action, changes this
    // number. Updating it should be a conscious edit in the same change set.
    expect(new Set(PASS_THROUGH_ACTIONS).size).toBe(44);
  });

  test("a workflow-owned action still reaches its handler", async () => {
    // `quit` routes to resolveQuitWithDownloadQueue, whose first act is
    // `container.downloadService.hasActiveJobs()` — so the proxy throw proves
    // the handler ran rather than the action falling through.
    await expect(
      handleShellAction({ action: "quit", container: throwingContainer() }),
    ).rejects.toThrow(/read container\.downloadService/);
  });
});

describe("runShellWorkflowFromOverlay dismissal", () => {
  test("a picker is cancelled by id instead of closing the overlay beneath it", async () => {
    const { container, dispatches, stateManager } = createContainerFixture();
    stateManager.dispatch({ type: "OPEN_OVERLAY", overlay: { type: "library" } });
    dispatches.length = 0;

    const result = await runShellWorkflowFromOverlay(container, "settings", {
      cancelPickerId: "episode-picker",
      execute: async () => "handled",
    });

    expect(result).toBe("handled");
    // The fixture records overlay mutations only, so a CANCEL_PICKER leaves it
    // empty — the point is that the overlay underneath was NOT closed.
    expect(dispatches).not.toContain("close");
  });

  test("an empty overlay stack closes nothing before running the workflow", async () => {
    const { container, dispatches } = createContainerFixture();

    const result = await runShellWorkflowFromOverlay(container, "settings", {
      execute: async () => "handled",
    });

    expect(result).toBe("handled");
    expect(dispatches).toEqual([]);
  });
});
