/**
 * Opt-in contract smoke against an isolated local ingest fixture only.
 * Never validates production DNS, deployment or production counts.
 *
 * KUNAI_LIVE_ANALYTICS=1 KUNAI_ANALYTICS_TEST_URL=http://127.0.0.1:3000/api/ping
 * bun run test:live:analytics
 */
import {
  ANALYTICS_PAYLOAD_KEYS,
  UsageAnalyticsService,
} from "@/services/analytics/usage-analytics-service";
import type { AnalyticsPingCompletion, KitsuneConfig } from "@/services/persistence/ConfigService";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";

import { createProviderSmokeProfile, providerSmokeProfilePayload } from "./provider-smoke";

const enabled = process.env.KUNAI_LIVE_ANALYTICS === "1";
if (!enabled) {
  console.log(
    JSON.stringify({
      ok: true,
      skipped: true,
      reason:
        "set KUNAI_LIVE_ANALYTICS=1 and KUNAI_ANALYTICS_TEST_URL to an isolated loopback ingest fixture",
    }),
  );
  process.exit(0);
}

// A dedicated variable avoids accidentally inheriting a real user's endpoint.
// Numeric loopback only: no DNS, credentials, redirects or production fallback.
const endpoint = process.env.KUNAI_ANALYTICS_TEST_URL?.trim() ?? "";
function isLocalFixtureEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      ["127.0.0.1", "[::1]"].includes(url.hostname) &&
      url.port !== "" &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/api/ping" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}
if (!isLocalFixtureEndpoint(endpoint)) {
  console.log(
    JSON.stringify({
      ok: false,
      skipped: false,
      failures: ["require-isolated-loopback-test-endpoint"],
    }),
  );
  process.exit(1);
}

const profile = createProviderSmokeProfile("analytics");
const failures: string[] = [];
let raw: KitsuneConfig = {
  ...DEFAULT_CONFIG,
  analytics: "enabled",
  // Synthetic fixture identity. It is never created by a test consent path
  // and can only be delivered to the explicit isolated loopback fixture above.
  installId: "6b1a9f2c-58d4-4e77-9c31-0a5b7e2d84f0",
};
const config = {
  getRaw: () => ({ ...raw }),
  async update(partial: Partial<KitsuneConfig>) {
    raw = { ...raw, ...partial };
  },
  async save() {},
  async recordAnalyticsPing(completion: AnalyticsPingCompletion) {
    if (raw.analytics !== "enabled" || raw.installId !== completion.installId) return false;
    raw = {
      ...raw,
      analyticsRetryAfter: completion.analyticsRetryAfter,
      ...(completion.lastAnalyticsPingAt === undefined
        ? {}
        : { lastAnalyticsPingAt: completion.lastAnalyticsPingAt }),
    };
    return true;
  },
};
let pingStatus: number | null = null;
const service = new UsageAnalyticsService({
  config,
  currentVersion: "0.3.0",
  endpoint,
  platform: { os: "linux", arch: "x64" },
  // Deliberately bypass test DNT only for this isolated config/local fixture.
  env: {},
  fetchImpl: async (input, init) => {
    const response = await fetch(input, init);
    pingStatus = response.status;
    return response;
  },
});

const payload = service.describePayload();
const keys = Object.keys(payload).sort();
if (JSON.stringify(keys) !== JSON.stringify(ANALYTICS_PAYLOAD_KEYS)) failures.push("payload-keys");
if (!/^[0-9a-f]{64}$/.test(payload.installId)) failures.push("install-id-not-hashed");

// Validate BEFORE any network side effect; await delivery rather than treating
// a fire-and-forget startup outcome as proof that the ingest accepted a ping.
if (failures.length === 0) {
  await service.maybePing({ isInteractive: true });
  if (pingStatus !== 204) failures.push(`ping-not-accepted:${pingStatus ?? "none"}`);
}

const rejected =
  failures.length > 0
    ? null
    : await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, title: "should-be-rejected" }),
        redirect: "error",
        signal: AbortSignal.timeout(2_500),
      }).catch(() => null);
if (failures.length === 0 && rejected?.status !== 400) {
  failures.push(`sixth-key-not-rejected:${rejected?.status ?? "none"}`);
}

console.log(
  JSON.stringify({
    ok: failures.length === 0,
    skipped: false,
    endpoint,
    pingStatus,
    payloadKeys: keys,
    sixthKeyStatus: rejected?.status ?? null,
    failures,
    ...providerSmokeProfilePayload(profile),
  }),
);
process.exit(failures.length === 0 ? 0 : 1);
