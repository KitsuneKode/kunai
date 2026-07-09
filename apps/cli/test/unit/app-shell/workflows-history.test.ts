import { describe, expect, test } from "bun:test";

import { handleShellAction } from "@/app-shell/workflows";

import { createContainerFixture } from "../../support/container-fixture";

describe("history workflow action", () => {
  test("continue opens history on the Continue tab", async () => {
    const { container, dispatches, closeTopOverlay } = createContainerFixture();

    const result = handleShellAction({ action: "continue", container });
    // openRootOwnedOverlay dispatches synchronously; yield so the promise settles
    // after OPEN_OVERLAY before we assert and close.
    await Bun.sleep(0);

    expect(dispatches).toEqual(["open:history"]);

    closeTopOverlay();

    await expect(result).resolves.toBe("handled");
    expect(dispatches).toEqual(["open:history", "close"]);
  });

  test("history opens history on the All tab", async () => {
    const { container, dispatches, closeTopOverlay } = createContainerFixture();

    const result = handleShellAction({ action: "history", container });
    await Bun.sleep(0);

    expect(dispatches).toEqual(["open:history"]);

    closeTopOverlay();

    await expect(result).resolves.toBe("handled");
    expect(dispatches).toEqual(["open:history", "close"]);
  });
});
