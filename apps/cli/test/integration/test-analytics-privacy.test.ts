import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

import { UsageAnalyticsService } from "@/services/analytics/usage-analytics-service";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";

import { storageRootEnv } from "../helpers/storage-env";

function fixtureConfig(enabled = false) {
  let raw: KitsuneConfig = {
    ...DEFAULT_CONFIG,
    analytics: enabled ? ("enabled" as const) : ("unset" as const),
    installId: enabled ? "11111111-2222-4333-8444-555555555555" : "",
  };
  return {
    getRaw: () => ({ ...raw }),
    async update(patch: Partial<typeof raw>) {
      raw = { ...raw, ...patch };
    },
    async save() {},
    async recordAnalyticsPing() {
      return true;
    },
  };
}

for (const enabled of [false, true]) {
  test(`shadow profile blocks consent and sends with CI=0, inherited enabled=${enabled}`, async () => {
    const config = fixtureConfig(enabled);
    let sends = 0;
    const service = new UsageAnalyticsService({
      config,
      currentVersion: "0.3.0",
      endpoint: "https://analytics.example.test/api/ping",
      env: { CI: "0", DO_NOT_TRACK: "0", ...storageRootEnv("/unused/mock-profile") },
      fetchImpl: async () => {
        sends++;
        return new Response(null, { status: 204 });
      },
    });
    // A TTY and even an explicit test keystroke must not bypass test isolation.
    await service.maybePing({ isInteractive: true });
    await service.setConsent("enabled");
    expect(config.getRaw().installId.length === 0).toBe(true);
    expect(config.getRaw().analytics).toBe("disabled");
    expect(sends).toBe(0);
  });
}

test("test preload blocks a local explicit opt-in despite inherited DNT=0 and CI=0", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `
    await import('./test/preload.ts');
    const { UsageAnalyticsService } = await import('./src/services/analytics/usage-analytics-service.ts');
    const { DEFAULT_CONFIG } = await import('./src/services/persistence/ConfigStore.ts');
    let raw = { ...DEFAULT_CONFIG };
    let sends = 0;
    const service = new UsageAnalyticsService({
      config: {
        getRaw: () => raw,
        async update(patch) { raw = { ...raw, ...patch }; },
        async save() {},
        async recordAnalyticsPing() { return true; },
      },
      currentVersion: '0.3.0',
      endpoint: 'https://analytics.example.test/api/ping',
      fetchImpl: async () => { sends++; return new Response(null, { status: 204 }); },
    });
    await service.setConsent('enabled');
    await service.maybePing({ isInteractive: true });
    console.log(JSON.stringify({ hasIdentity: raw.installId.length > 0, enabled: raw.analytics === 'enabled', sends }));
  `,
    ],
    {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      env: { ...process.env, CI: "0", DO_NOT_TRACK: "0" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(code, err).toBe(0);
  expect(JSON.parse(out)).toEqual({ hasIdentity: false, enabled: false, sends: 0 });
});
