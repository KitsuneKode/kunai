import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { persistSettingsDraft } from "@/app-shell/settings/persist";
import { handleSettingsPointer } from "@/app-shell/settings/pointer";
import { buildSettingsRegistryContext } from "@/app-shell/settings/registry-context";
import { SettingsShell } from "@/app-shell/settings/SettingsShell";
import { createSettingsUiState } from "@/app-shell/settings/state";
import type { Container } from "@/container";
import { FileStorage } from "@/infra/storage/FileStorage";
import { UsageAnalyticsService } from "@/services/analytics/usage-analytics-service";
import type { ConfigService } from "@/services/persistence/ConfigService";
import { ConfigServiceImpl } from "@/services/persistence/ConfigServiceImpl";
import { ConfigStoreImpl } from "@/services/persistence/ConfigStoreImpl";
import type { PresenceSnapshot } from "@/services/presence/PresenceService";
import React, { act } from "react";

import { render } from "../harness/render-capture";
import { renderWithPointer } from "../support/pointer-render";
import { waitUntil as sharedWaitUntil } from "../support/wait-until";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function createTemporaryProfile(): Promise<{
  readonly directory: string;
  readonly loadConfig: () => Promise<ConfigServiceImpl>;
}> {
  const directory = await mkdtemp(join(tmpdir(), "kunai-settings-analytics-"));
  const configPath = join(directory, "config.json");
  return {
    directory,
    loadConfig: () =>
      ConfigServiceImpl.load(new ConfigStoreImpl(new FileStorage({ config: configPath }))),
  };
}

function createSettingsContainer(config: ConfigService): Container {
  const usageAnalytics = new UsageAnalyticsService({
    config,
    currentVersion: "0.3.0",
    endpoint: "",
    env: {},
  });
  return {
    config,
    usageAnalytics,
    providerRegistry: {
      getAll: () => [],
      setPriority: () => undefined,
    },
    presence: {
      getSnapshot: () => null,
      disconnect: async () => undefined,
    },
    stateManager: {
      getState: () => ({ mode: "series" }),
      dispatch: () => undefined,
    },
    syncAuthAvailability: {
      anilist: { available: false, reason: "callback-missing" },
      tmdb: { available: false, reason: "api-key-missing" },
    },
    syncService: {
      adapters: [],
      getStatus: () => ({
        connected: 0,
        pending: 0,
        needsReauth: 0,
        deadLettered: 0,
        health: "disconnected",
      }),
    },
    connectivity: { notifyIntentChanged: () => undefined },
    featureFlags: {},
    diagnosticsService: { record: () => undefined },
  } as unknown as Container;
}

/**
 * Poll inside an `act()` boundary, with a budget that is not a bet on the host.
 *
 * This was a 100 x 10ms loop -- one second of wall clock for work that writes
 * config to disk atomically. On a loaded Windows agent under `--parallel` that
 * is not enough, and it failed as `message` rather than as anything about
 * analytics. Scheduling shifts whenever unrelated tests are added elsewhere,
 * which is exactly how it surfaced.
 */
async function waitUntil(predicate: () => boolean, message: string): Promise<void> {
  await sharedWaitUntil(predicate, {
    label: message,
    tick: async (ms) => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
      });
    },
  });
}

/**
 * The settings save is debounced, so this waits out the debounce rather than
 * polling a condition. Kept as a sleep for that reason, but sized above the
 * debounce with headroom instead of sitting just past it.
 */
async function waitForDelayedSettingsSave(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  });
}

test("Settings enable and an unrelated save preserve one install id on disk", async () => {
  const profile = await createTemporaryProfile();
  const config = await profile.loadConfig();
  const container = createSettingsContainer(config);
  const handle = render(
    <SettingsShell
      container={container}
      width={100}
      maxRows={20}
      commandMode={false}
      onClose={() => undefined}
      onStatus={() => undefined}
      onRedraw={() => undefined}
    />,
    { columns: 100, rows: 30 },
  );

  try {
    // Down×4: startup mode → footer hints → shortcut tips → every tip →
    // usage analytics. Row order is the contract this test navigates by.
    handle.stdin.enqueue("\x1b[B");
    handle.stdin.enqueue("\x1b[B");
    handle.stdin.enqueue("\x1b[B");
    handle.stdin.enqueue("\x1b[B");
    handle.stdin.enqueue("\r");

    await waitUntil(
      () => config.getRaw().analytics === "enabled" && config.getRaw().installId.length > 0,
      "Settings never persisted an enabled preference with an install id",
    );
    const derivedId = config.getRaw().installId;
    expect(derivedId).toMatch(UUID_PATTERN);

    await waitForDelayedSettingsSave();

    const afterEnable = await profile.loadConfig();
    expect(afterEnable.getRaw().analytics).toBe("enabled");
    expect(afterEnable.getRaw().installId).toBe(derivedId);

    // Change Footer hints through the same mounted SettingsShell. Its draft was
    // created before analytics minted the id, so this also covers a stale,
    // unrelated whole-draft save after explicit consent. Up×3 walks back past
    // the two tip rows and startup mode to footer hints.
    handle.stdin.enqueue("\x1b[A");
    handle.stdin.enqueue("\x1b[A");
    handle.stdin.enqueue("\x1b[A");
    handle.stdin.enqueue("\r");
    handle.stdin.enqueue("\x1b[B");
    handle.stdin.enqueue("\r");

    await waitUntil(
      () => config.getRaw().footerHints === "minimal",
      "Settings never persisted the unrelated footer preference",
    );
    await waitForDelayedSettingsSave();

    const afterUnrelatedSave = await profile.loadConfig();
    expect(afterUnrelatedSave.getRaw().footerHints).toBe("minimal");
    expect(afterUnrelatedSave.getRaw().analytics).toBe("enabled");
    expect(afterUnrelatedSave.getRaw().installId).toBe(derivedId);
  } finally {
    handle.unmount();
    await config.flushPending();
    await rm(profile.directory, { recursive: true, force: true });
  }
});

test("closing Settings inside the save debounce still persists the pending change", async () => {
  // The draft save is debounced 300 ms, and unmount used to clear the timer
  // without flushing — Esc within the window silently discarded a change the
  // UI had already shown.
  const profile = await createTemporaryProfile();
  const config = await profile.loadConfig();
  const container = createSettingsContainer(config);
  const handle = render(
    <SettingsShell
      container={container}
      width={100}
      maxRows={20}
      commandMode={false}
      onClose={() => undefined}
      onStatus={() => undefined}
      onRedraw={() => undefined}
    />,
    { columns: 100, rows: 30 },
  );

  try {
    expect(config.getRaw().defaultMode).toBe("series");
    // Open the first row's submenu (Default startup mode), pick "anime".
    handle.stdin.enqueue("\r");
    handle.stdin.enqueue("\x1b[B");
    handle.stdin.enqueue("\r");
    // Unmount immediately — inside the debounce window.
    handle.unmount();

    await waitUntil(
      () => config.getRaw().defaultMode === "anime",
      "unmount discarded the pending settings draft",
    );

    await config.flushPending();
    const reloaded = await profile.loadConfig();
    expect(reloaded.getRaw().defaultMode).toBe("anime");
  } finally {
    await config.flushPending();
    await rm(profile.directory, { recursive: true, force: true });
  }
});

for (const analytics of ["unset", "disabled"] as const) {
  test(`a ${analytics} Settings draft cannot preserve an injected install id on disk`, async () => {
    const profile = await createTemporaryProfile();
    const config = await profile.loadConfig();
    const container = createSettingsContainer(config);

    try {
      await persistSettingsDraft(container, {
        ...config.getRaw(),
        analytics,
        installId: "injected-install-id",
      });

      const reloaded = await profile.loadConfig();
      expect(reloaded.getRaw().analytics).toBe(analytics);
      expect(reloaded.getRaw().installId).toBe("");
    } finally {
      await config.flushPending();
      await rm(profile.directory, { recursive: true, force: true });
    }
  });
}

test("mouse clicks focus analytics but never grant keystroke-gated consent", async () => {
  const profile = await createTemporaryProfile();
  const config = await profile.loadConfig();
  const status: string[] = [];
  const handle = renderWithPointer(
    <SettingsShell
      container={createSettingsContainer(config)}
      width={100}
      maxRows={20}
      commandMode={false}
      onClose={() => {}}
      onStatus={(message) => {
        if (message) status.push(message);
      }}
      onRedraw={() => {}}
    />,
    { columns: 100, rows: 30 },
  );
  try {
    handle.click("settings:row:usageAnalytics");
    handle.click("settings:row:usageAnalytics");
    expect(config.analytics).toBe("unset");
    expect(config.installId).toBe("");
    expect(status.at(-1)).toContain("Enter");
    const disk = await profile.loadConfig();
    expect(disk.analytics).toBe("unset");
    expect(disk.installId).toBe("");
  } finally {
    handle.unmount();
    await rm(profile.directory, { recursive: true, force: true });
  }
});

test("mouse selects a settings choice before committing and respects palette ownership", async () => {
  const profile = await createTemporaryProfile();
  const config = await profile.loadConfig();
  const container = createSettingsContainer(config);
  const node = (commandMode: boolean) => (
    <SettingsShell
      container={container}
      width={100}
      maxRows={20}
      commandMode={commandMode}
      onClose={() => {}}
      onStatus={() => {}}
      onRedraw={() => {}}
    />
  );
  const handle = renderWithPointer(node(false), { columns: 100, rows: 30 });
  try {
    handle.click("settings:row:defaultMode");
    handle.click("settings:choice:anime");
    expect(config.defaultMode).toBe("series");
    handle.click("settings:choice:anime");
    await waitUntil(() => config.defaultMode === "anime", "mouse default mode update");
    await config.save();
    expect((await profile.loadConfig()).defaultMode).toBe("anime");
    handle.rerender(node(true));
    expect(handle.dispatcher.size).toBe(0);
    handle.rerender(node(false));
    expect(handle.dispatcher.size).toBeGreaterThan(0);
  } finally {
    handle.unmount();
    await rm(profile.directory, { recursive: true, force: true });
  }
});

test.each(["busy", "editing"] as const)(
  "%s rejects pointer mutations before reading or running an action",
  async (mode) => {
    const profile = await createTemporaryProfile();
    const config = await profile.loadConfig();
    const container = createSettingsContainer(config);
    const base = createSettingsUiState(config.getRaw());
    const state =
      mode === "busy"
        ? { ...base, busy: true }
        : {
            ...base,
            inputMode: {
              active: true as const,
              settingId: "relayUrl",
              buffer: "draft",
              seed: "original",
            },
          };
    try {
      const result = handleSettingsPointer({ type: "row", id: "usageAnalytics" }, state, {
        container,
        registryCtx: buildSettingsRegistryContext(container, config.getRaw()),
      });
      expect(result.handled).toBe(false);
      expect(result.state).toBe(state);
      expect(result.persist).toBeUndefined();
      expect(result.runActionId).toBeUndefined();
    } finally {
      await rm(profile.directory, { recursive: true, force: true });
    }
  },
);

test.each(["separate", "batched"] as const)(
  "%s settings clicks start only one action and freeze navigation",
  async (delivery) => {
    const profile = await createTemporaryProfile();
    const config = await profile.loadConfig();
    await config.update({ presenceProvider: "discord" });
    const container = createSettingsContainer(config);
    const snapshot: PresenceSnapshot = {
      provider: "discord",
      status: "ready",
      privacy: "full",
      clientIdSource: "default",
      canConnect: true,
      detail: "Connected fixture",
    };
    const deferred = Promise.withResolvers<PresenceSnapshot>();
    container.presence.getSnapshot = () => snapshot;
    let actionCalls = 0;
    container.presence.disconnect = () => {
      actionCalls += 1;
      return deferred.promise;
    };
    let closed = 0;
    const handle = renderWithPointer(
      <SettingsShell
        container={container}
        width={100}
        maxRows={20}
        commandMode={false}
        initialSectionId="section:presence"
        onClose={() => {
          closed += 1;
        }}
        onStatus={() => {}}
        onRedraw={() => {}}
      />,
      { columns: 100, rows: 30 },
    );
    try {
      handle.click("settings:row:presenceConnection");
      if (delivery === "batched") {
        // Both clicks reach the current render before React commits the busy state.
        act(() => {
          handle.click("settings:row:presenceConnection");
          handle.click("settings:row:presenceConnection");
        });
      } else {
        handle.click("settings:row:presenceConnection");
      }
      expect(actionCalls).toBe(1);
      expect(handle.dispatcher.size).toBe(0);
      const busyFrame = handle.lastFrame();
      for (const key of ["\x1b[B", "\t", "/", "q", "\x1b"]) {
        handle.stdin.enqueue(key);
        expect(handle.lastFrame()).toBe(busyFrame);
      }
      expect(closed).toBe(0);
      await act(async () => {
        deferred.resolve(snapshot);
        await deferred.promise;
      });
      expect(handle.dispatcher.size).toBeGreaterThan(0);
      handle.click("settings:row:presenceConnection");
      expect(actionCalls).toBe(2);
    } finally {
      deferred.resolve(snapshot);
      handle.unmount();
      await config.flushPending();
      await rm(profile.directory, { recursive: true, force: true });
    }
  },
);

test("mouse settings save failures retain visible feedback and diagnostics", async () => {
  const profile = await createTemporaryProfile();
  const config = await profile.loadConfig();
  const container = createSettingsContainer(config);
  const notes: string[] = [];
  container.diagnosticsService.record = (event) => {
    notes.push(event.message);
  };
  config.update = async () => {
    throw new Error("fixture disk unavailable");
  };
  const handle = renderWithPointer(
    <SettingsShell
      container={container}
      width={100}
      maxRows={20}
      commandMode={false}
      onClose={() => {}}
      onStatus={() => {}}
      onRedraw={() => {}}
    />,
  );
  try {
    handle.click("settings:row:defaultMode");
    handle.click("settings:choice:anime");
    await act(async () => {
      handle.click("settings:choice:anime");
    });
    expect(handle.lastFrame()).toContain("Couldn't save settings: fixture disk unavailable");
    expect(notes).toContain("Settings persist failed");
    expect(config.defaultMode).toBe("series");
  } finally {
    handle.unmount();
    await config.flushPending();
    await rm(profile.directory, { recursive: true, force: true });
  }
});
