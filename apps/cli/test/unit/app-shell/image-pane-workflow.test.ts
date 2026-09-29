import { describe, expect, spyOn, test } from "bun:test";

import { handleShellAction } from "@/app-shell/workflows";

import { createContainerFixture } from "../../support/container-fixture";

/**
 * `image-pane` was registered with an availability gate but no handler — the
 * companion-pane toggle existed in SessionState and nothing dispatched it, so
 * the command was a parseable no-op. This pins command → owner.
 */
describe("image-pane workflow action", () => {
  test("dispatches the companion-pane toggle it was registered for", async () => {
    const { container, stateManager } = createContainerFixture();
    const dispatch = spyOn(stateManager, "dispatch");

    await expect(handleShellAction({ action: "image-pane", container })).resolves.toBe("handled");
    expect(dispatch).toHaveBeenCalledWith({ type: "TOGGLE_COMPANION_PANE" });
  });
});
