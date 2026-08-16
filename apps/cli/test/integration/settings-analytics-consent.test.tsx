import { expect, test } from "bun:test";

import { SettingsShell } from "@/app-shell/settings/SettingsShell";
import type { Container } from "@/container";
import { UsageAnalyticsService } from "@/services/analytics/usage-analytics-service";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { ConfigServiceImpl } from "@/services/persistence/ConfigServiceImpl";
import type { ConfigStore } from "@/services/persistence/ConfigStore";
import React, { act } from "react";

import { render } from "../harness/render-capture";

class MemoryConfigStore implements ConfigStore {
  constructor(private value: Partial<KitsuneConfig> = {}) {}

  async load(): Promise<Partial<KitsuneConfig>> {
    return this.value;
  }

  async save(config: KitsuneConfig): Promise<void> {
    this.value = structuredClone(config);
  }

  async reset(): Promise<void> {
    this.value = {};
  }
}

async function waitUntil(predicate: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(message);
}

test("Settings enable keeps the service-derived install id through the delayed draft save", async () => {
  const store = new MemoryConfigStore();
  const config = await ConfigServiceImpl.load(store);
  const usageAnalytics = new UsageAnalyticsService({
    config,
    currentVersion: "0.3.0",
    endpoint: "",
    env: {},
  });
  const container = {
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
    connectivity: { notifyIntentChanged: () => undefined },
    featureFlags: {},
  } as unknown as Container;

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

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });

    expect(config.getRaw().analytics).toBe("enabled");
    expect(config.getRaw().installId).toBe(derivedId);
    expect((await store.load()).installId).toBe(derivedId);
  } finally {
    handle.unmount();
  }
});
