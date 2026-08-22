/**
 * Opt-in analytics against the real deployed ingest.
 *
 * Fixture-backed tests prove the service's own logic; they cannot prove that the
 * shipped default endpoint resolves, that the deployed ingest accepts what this
 * CLI actually emits, or that a send never blocks startup. Those are exactly the
 * failures a user would feel, so they are checked here against production.
 *
 * Opt-in: set KUNAI_LIVE_ANALYTICS=1. Without it this skips and sends nothing —
 * the same posture as every other live smoke.
 *
 * Runs in an isolated profile, so it never reads or writes a real install.
 */
import { UsageAnalyticsService } from "@/services/analytics/usage-analytics-service";
import { DEFAULT_ANALYTICS_ENDPOINT } from "@/services/analytics/usage-analytics-service";

import { createProviderSmokeProfile, providerSmokeProfilePayload } from "./provider-smoke";

const enabled = process.env.KUNAI_LIVE_ANALYTICS === "1";
const profile = createProviderSmokeProfile("analytics");

if (!enabled) {
  console.log(
    JSON.stringify({
      ok: true,
      skipped: true,
      reason: "set KUNAI_LIVE_ANALYTICS=1 to send one ping to the live endpoint",
      endpoint: DEFAULT_ANALYTICS_ENDPOINT,
      ...providerSmokeProfilePayload(profile),
    }),
  );
  process.exit(0);
}

const endpoint = process.env.KUNAI_ANALYTICS_URL?.trim() || DEFAULT_ANALYTICS_ENDPOINT;
const failures: string[] = [];

/** The endpoint must be reachable over HTTPS on a domain we control. */
if (!endpoint.startsWith("https://")) failures.push("endpoint-not-https");

let raw: Record<string, unknown> = {
  analytics: "enabled",
  installId: "",
  analyticsEndpoint: endpoint,
};
const config = {
  getRaw: () => ({ ...raw }) as never,
  async update(partial: Record<string, unknown>) {
    raw = { ...raw, ...partial };
  },
  async save() {},
};

const service = new UsageAnalyticsService({
  config: config as never,
  currentVersion: "0.3.0",
  endpoint,
  now: () => Date.now(),
  platform: { os: "linux", arch: "x64" },
  env: {},
});

// A ping must never hold up a session. The service retries on the next launch
// rather than blocking, so anything slow here is a real startup regression.
const startedAt = Date.now();
const outcome = await service.onSessionStart({ isInteractive: true });
const durationMs = Date.now() - startedAt;

if (outcome.kind !== "pinged") failures.push(`unexpected-outcome:${outcome.kind}`);
if (durationMs > 5_000) failures.push(`ping-too-slow:${durationMs}ms`);

const payload = service.describePayload();
const keys = Object.keys(payload).sort();
// The privacy contract bounds this to exactly five keys.
if (keys.length !== 5) failures.push(`payload-key-count:${keys.length}`);
for (const required of ["arch", "installId", "os", "ts", "version"]) {
  if (!keys.includes(required)) failures.push(`payload-missing:${required}`);
}
// This body is POSTed to the real endpoint below, so it is the one place a
// regression would put a raw install id on the wire. A digest is 64 hex chars;
// a UUID is 36 with dashes, so the shape alone catches it.
if (!/^[0-9a-f]{64}$/.test(payload.installId)) {
  failures.push(`install-id-not-hashed:${payload.installId.length}`);
}

// The ingest must refuse anything beyond the contract, not silently store it.
const rejected = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ...payload, title: "should-be-rejected" }),
}).catch(() => null);
if (rejected?.status !== 400) failures.push(`sixth-key-not-rejected:${rejected?.status ?? "none"}`);

console.log(
  JSON.stringify({
    ok: failures.length === 0,
    skipped: false,
    endpoint,
    outcome: outcome.kind,
    pingDurationMs: durationMs,
    payloadKeys: keys,
    sixthKeyStatus: rejected?.status ?? null,
    failures,
    ...providerSmokeProfilePayload(profile),
  }),
);

process.exit(failures.length === 0 ? 0 : 1);
