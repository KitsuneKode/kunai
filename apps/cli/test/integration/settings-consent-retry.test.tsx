import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { persistSettingsDraft } from "@/app-shell/settings/persist";
import { buildSettingsRegistryContext } from "@/app-shell/settings/registry-context";
import { presenceSettingsRows } from "@/app-shell/settings/registry/presence";
import { SettingsShell } from "@/app-shell/settings/SettingsShell";
import type { Container } from "@/container";
import { FileStorage } from "@/infra/storage/FileStorage";
import { UsageAnalyticsService } from "@/services/analytics/usage-analytics-service";
import { ConfigServiceImpl } from "@/services/persistence/ConfigServiceImpl";
import { ConfigStoreImpl } from "@/services/persistence/ConfigStoreImpl";
import type { PresenceSnapshot } from "@/services/presence/PresenceService";
import React, { act } from "react";

import { render } from "../harness/render-capture";
import { applyStorageRootEnv } from "../helpers/storage-env";

let directory: string;
let restoreEnv: () => void;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "kunai-consent-retry-"));
  restoreEnv = applyStorageRootEnv(directory);
});
afterEach(async () => {
  restoreEnv();
  await rm(directory, { recursive: true, force: true });
});

async function profile() {
  const store = new ConfigStoreImpl(new FileStorage({ config: join(directory, "config.json") }));
  let failWrites = 0;
  let saved = Promise.withResolvers<void>();
  const config = await ConfigServiceImpl.load({
    load: () => store.load(),
    save: async (value) => {
      if (failWrites > 0) {
        failWrites--;
        throw new Error("fixture write denied");
      }
      await store.save(value);
    },
    reset: () => store.reset(),
    withLock: (fn) => store.withLock(fn),
  });
  const debouncedSave = config.save.bind(config);
  // Exercise the real dirty-key merge and lock, draining the production debounce
  // explicitly rather than betting on elapsed wall time.
  config.save = async () => {
    const completion = saved;
    saved = Promise.withResolvers<void>();
    const results = await Promise.allSettled([debouncedSave(), config.flushPending()]);
    completion.resolve();
    const result = results[0]!;
    if (result.status === "rejected") throw result.reason;
  };
  const idle: PresenceSnapshot = {
    provider: "discord",
    status: "idle",
    privacy: "full",
    clientIdSource: "default",
    canConnect: true,
    detail: "fixture disconnected",
  };
  const container = {
    config,
    usageAnalytics: new UsageAnalyticsService({
      config,
      currentVersion: "0.3.0",
      endpoint: "",
      env: {},
    }),
    providerRegistry: { getAll: () => [], setPriority: () => {} },
    stateManager: { getState: () => ({ mode: "series" }), dispatch: () => {} },
    connectivity: { notifyIntentChanged: () => {} },
    presence: {
      getSnapshot: () => idle,
      connect: async () => ({ ...idle, status: "ready" }),
      disconnect: async () => idle,
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
    syncAuthAvailability: {},
    featureFlags: {},
    diagnosticsService: { record: () => {} },
  } as unknown as Container;
  return {
    config,
    container,
    failNext: (count = 1) => {
      failWrites = count;
    },
    nextSave: () => saved.promise,
    disk: () => store.load(),
    sibling: async () => {
      const sibling = await ConfigServiceImpl.load(store);
      const save = sibling.save.bind(sibling);
      sibling.save = async () => {
        const pending = save();
        await sibling.flushPending();
        await pending;
      };
      return sibling;
    },
  };
}

function mount(
  container: Container,
  initialSectionId?: string,
  onStatus = (_: string | null) => {},
) {
  return render(
    <SettingsShell
      container={container}
      width={100}
      maxRows={20}
      commandMode={false}
      initialSectionId={initialSectionId}
      onClose={() => {}}
      onStatus={onStatus}
      onRedraw={() => {}}
    />,
    { columns: 100, rows: 30 },
  );
}

async function keys(handle: ReturnType<typeof mount>, ...input: string[]) {
  for (const key of input)
    await act(async () => {
      handle.stdin.enqueue(key);
    });
}
const down = "\x1b[B";
const up = "\x1b[A";
const enter = "\r";

for (const caller of ["Settings", "theme picker"] as const) {
  test(`${caller} persists only changed fields over sibling withdrawal and preferences`, async () => {
    const p = await profile();
    await p.container.usageAnalytics.setConsent("enabled");
    const baseline = p.config.getRaw();
    const sibling = await p.sibling();
    await sibling.update({
      analytics: "disabled",
      installId: "",
      tipsEnabled: false,
      presencePrivacy: "title-only",
    });
    await sibling.save();
    const next =
      caller === "Settings"
        ? { ...baseline, footerHints: "minimal" as const }
        : { ...baseline, theme: "sakura" };
    await persistSettingsDraft(p.container, next, baseline);
    const disk = await p.disk();
    expect(disk.analytics).toBe("disabled");
    expect(disk.installId).toBe("");
    expect(disk.tipsEnabled).toBe(false);
    expect(disk.presencePrivacy).toBe("title-only");
    if (caller === "Settings") expect(disk.footerHints).toBe("minimal");
    else expect(disk.theme).toBe("sakura");
  });
}

test("presence applies only fields edited in its pane", async () => {
  const p = await profile();
  await p.config.update({ presenceProvider: "discord" });
  await p.container.usageAnalytics.setConsent("enabled");
  const ctx = buildSettingsRegistryContext(p.container, {
    ...p.config.getRaw(),
    presencePrivacy: "title-only",
  });
  const sibling = await p.sibling();
  await sibling.update({
    analytics: "disabled",
    installId: "",
    presenceDiscordClientId: "123456789012345678",
    footerHints: "minimal",
  });
  await sibling.save();
  const action = presenceSettingsRows(ctx).find((row) => row.id === "presenceConnection");
  if (action?.kind !== "action") throw new Error("Missing presence action");
  await action.run(ctx);
  const disk = await p.disk();
  expect(disk.presencePrivacy).toBe("title-only");
  expect(disk.presenceDiscordClientId).toBe("123456789012345678");
  expect(disk.footerHints).toBe("minimal");
  expect(disk.analytics).toBe("disabled");
  expect(disk.installId).toBe("");
});

test("failed enable followed by explicit disable and passive edit cannot replay consent", async () => {
  const p = await profile();
  await p.container.usageAnalytics.setConsent("disabled");
  const handle = mount(p.container);
  try {
    p.failNext();
    const failed = p.nextSave();
    await act(async () => {
      await keys(handle, down, down, down, down, enter);
      await failed;
    });
    expect(handle.lastFrame()).toContain("Couldn't save settings");
    // Explicit disable returns the UI to its original persisted value. It still
    // must supersede the failed enable's dirty keys, including the generated id.
    await keys(handle, enter);
    const passive = p.nextSave();
    await act(async () => {
      await keys(handle, up, up, up, enter, down, enter);
      await passive;
    });
    const disk = await p.disk();
    expect(disk.footerHints).toBe("minimal");
    expect(disk.analytics).toBe("disabled");
    expect(disk.installId).toBe("");
    expect(p.config.installId).toBe("");
  } finally {
    await act(async () => {
      handle.unmount();
    });
    await p.config.flushPending();
  }
});

test("failed disable remains retryable by an unrelated edit", async () => {
  const p = await profile();
  await p.container.usageAnalytics.setConsent("enabled");
  const handle = mount(p.container);
  try {
    p.failNext();
    const failed = p.nextSave();
    await act(async () => {
      await keys(handle, down, down, down, down, enter);
      await failed;
    });
    expect((await p.disk()).analytics).toBe("enabled");
    const retry = p.nextSave();
    await act(async () => {
      await keys(handle, up, up, up, enter, down, enter);
      await retry;
    });
    const disk = await p.disk();
    expect(disk.analytics).toBe("disabled");
    expect(disk.installId).toBe("");
    expect(disk.footerHints).toBe("minimal");
  } finally {
    await act(async () => {
      handle.unmount();
    });
    await p.config.flushPending();
  }
});

test("action refresh rebases passive edits after same-process withdrawal", async () => {
  const p = await profile();
  await p.config.update({ presenceProvider: "discord" });
  await p.container.usageAnalytics.setConsent("enabled");
  const completed = Promise.withResolvers<void>();
  const handle = mount(p.container, "section:presence", (message) => {
    if (message?.startsWith("Discord presence:")) completed.resolve();
  });
  try {
    await p.container.usageAnalytics.setConsent("disabled");
    await act(async () => {
      await keys(handle, down, down, down, down, enter);
      await completed.promise;
    });
    const sibling = await p.sibling();
    await sibling.update({
      analytics: "enabled",
      installId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    });
    await sibling.save();
    // Presence privacy is an unrelated passive edit after the action refresh.
    const saved = p.nextSave();
    await act(async () => {
      await keys(handle, up, up, up, enter, down, enter);
      await saved;
    });
    const disk = await p.disk();
    expect(disk.analytics).toBe("enabled");
    expect(disk.installId).toBe("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
  } finally {
    await act(async () => {
      handle.unmount();
    });
    await p.config.flushPending();
  }
});
