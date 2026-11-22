import { expect, test } from "bun:test";

import { applySettingsToRuntime } from "@/app/bootstrap/apply-settings-to-runtime";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { ConfigServiceImpl } from "@/services/persistence/ConfigServiceImpl";

import { createIsolatedContainer } from "../../integration/helpers/isolated-container";

test("leaving offline mode resumes the download queue and sync delivery, once", async () => {
  const config = await ConfigServiceImpl.load({
    load: async () => ({}),
    save: async (_config: KitsuneConfig) => {},
    reset: async () => {},
  });
  // What `--offline` does at startup: a session override, not a saved setting.
  config.applySessionOverrides({ offlineMode: true });

  const isolated = await createIsolatedContainer("online-resume");
  try {
    const kicks: string[] = [];
    let deliveries = 0;
    const container = {
      ...isolated.container,
      config,
      downloadService: Object.assign(Object.create(isolated.container.downloadService), {
        kickQueue: (source: string) => kicks.push(source),
      }),
      syncService: Object.assign(Object.create(isolated.container.syncService), {
        deliverSoon: () => {
          deliveries += 1;
        },
      }),
    };

    // An unrelated edit while still offline starts nothing.
    await applySettingsToRuntime({ container, next: { ...config.getRaw(), zenMode: true } });
    expect(kicks).toEqual([]);
    expect(deliveries).toBe(0);

    await applySettingsToRuntime({ container, next: { ...config.getRaw(), offlineMode: false } });
    expect(config.offlineMode).toBe(false);
    expect(kicks).toEqual(["online-resume"]);
    expect(deliveries).toBe(1);

    // Going offline again resumes nothing.
    await applySettingsToRuntime({ container, next: { ...config.getRaw(), offlineMode: true } });
    expect(kicks).toEqual(["online-resume"]);
    expect(deliveries).toBe(1);
  } finally {
    isolated.dispose();
  }
});
