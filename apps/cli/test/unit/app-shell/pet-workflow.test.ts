import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { companionMode, setCompanionPreferenceSource } from "@/app-shell/companion-policy";
import { handleShellAction } from "@/app-shell/workflows";

import { createContainerFixture } from "../../support/container-fixture";

/**
 * `pet` toggles Kanna via the persisted `companionPet` preference. These pin
 * the two halves of that contract: the write that `/pet` makes, and the env
 * pin that must refuse politely instead of looking like a dead control.
 */

// Same trick as companion-policy.test.ts: capability and TTY checks read the
// process's real stdout, which is a pipe under the test runner. The handler's
// `companionToggleable` gate runs synchronously, so patching only for the call
// is enough — the awaits resolve after the descriptor is restored.
function withRealTty<T>(run: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  try {
    return run();
  } finally {
    if (descriptor) {
      Object.defineProperty(process.stdout, "isTTY", descriptor);
    } else {
      // SAFETY: deleting the patched key restores whatever the runner had.
      delete (process.stdout as { isTTY?: boolean }).isTTY;
    }
  }
}

function containerWithPet(initial: "auto" | "off") {
  const stored = { companionPet: initial };
  const saves: Array<"auto" | "off"> = [];
  const config = {
    get companionPet() {
      return stored.companionPet;
    },
    update: async (partial: { companionPet?: "auto" | "off" }) => {
      if (partial.companionPet) stored.companionPet = partial.companionPet;
    },
    save: async () => {
      saves.push(stored.companionPet);
    },
  };
  // SAFETY: the fixture accepts a partial container; the stub only needs the
  // three members the pet workflow touches.
  const fixture = createContainerFixture({ config: config as never });
  return { ...fixture, stored, saves };
}

// A KUNAI_PET in the ambient env pins the toggle to a refusal, so every /pet
// test needs it cleared up front — and restored, not deleted, afterwards.
let savedKunaiPet: string | undefined;

beforeEach(() => {
  savedKunaiPet = process.env.KUNAI_PET;
  delete process.env.KUNAI_PET;
});

afterEach(() => {
  setCompanionPreferenceSource(() => "auto");
  if (savedKunaiPet === undefined) {
    delete process.env.KUNAI_PET;
  } else {
    process.env.KUNAI_PET = savedKunaiPet;
  }
});

describe("pet workflow action", () => {
  test("hides her, persists it, and says how to bring her back", async () => {
    const { container, stateManager, stored, saves } = containerWithPet("auto");
    const dispatch = spyOn(stateManager, "dispatch");

    await expect(withRealTty(() => handleShellAction({ action: "pet", container }))).resolves.toBe(
      "handled",
    );
    expect(stored.companionPet).toBe("off");
    expect(saves).toEqual(["off"]);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_PLAYBACK_FEEDBACK" }),
    );
  });

  test("brings her back from a stored off", async () => {
    const { container, stored } = containerWithPet("off");

    await expect(withRealTty(() => handleShellAction({ action: "pet", container }))).resolves.toBe(
      "handled",
    );
    expect(stored.companionPet).toBe("auto");
  });

  test("an env pin refuses instead of silently writing a dead preference", async () => {
    process.env.KUNAI_PET = "off";
    const { container, stateManager, stored, saves } = containerWithPet("auto");
    const dispatch = spyOn(stateManager, "dispatch");

    await expect(withRealTty(() => handleShellAction({ action: "pet", container }))).resolves.toBe(
      "handled",
    );
    // Nothing written — the preference cannot beat KUNAI_PET, so persisting a
    // flip would only look like it worked.
    expect(stored.companionPet).toBe("auto");
    expect(saves).toEqual([]);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_PLAYBACK_FEEDBACK" }),
    );
  });

  test("a stored preference resolves through companionMode when wired like bootstrap", async () => {
    const { container, stored } = containerWithPet("auto");
    setCompanionPreferenceSource(() => stored.companionPet);

    await withRealTty(() => handleShellAction({ action: "pet", container }));
    withRealTty(() => {
      expect(companionMode()).toBe("off");
    });
  });
});
