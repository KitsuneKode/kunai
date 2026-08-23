import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { persistSettingsDraft } from "@/app-shell/settings/persist";
import { SettingsShell } from "@/app-shell/settings/SettingsShell";
import type { Container } from "@/container";
import { FileStorage } from "@/infra/storage/FileStorage";
import { UsageAnalyticsService } from "@/services/analytics/usage-analytics-service";
import type { ConfigService } from "@/services/persistence/ConfigService";
import { ConfigServiceImpl } from "@/services/persistence/ConfigServiceImpl";
import { ConfigStoreImpl } from "@/services/persistence/ConfigStoreImpl";
import React, { act } from "react";

import { render } from "../harness/render-capture";
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
    // unrelated whole-draft save after explicit consent.
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
