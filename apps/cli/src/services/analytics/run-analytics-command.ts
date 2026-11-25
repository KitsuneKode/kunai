/**
 * `kunai analytics log` and `kunai analytics preview`: check the claim instead
 * of trusting it.
 *
 * Both are read-only with respect to consent. Neither sends a request, creates
 * an id, writes a cohort or changes the preference, so neither can be a way to
 * turn analytics on. The one write either makes is removing a ping log left
 * behind while analytics is not enabled, which is the log's own rule.
 */

import { envBlockFlag, type ConsentEnv } from "@/domain/analytics/consent-policy";
import { FileStorage } from "@/infra/storage/FileStorage";
import { loadedAnalyticsFields } from "@/services/persistence/analytics-consent";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { ConfigStoreImpl } from "@/services/persistence/ConfigStoreImpl";

import { filePingLog, pingLogPath, PING_LOG_LIMIT, type PingLog } from "./ping-log";
import {
  analyticsOs,
  describeAnalyticsPayload,
  resolveAnalyticsEndpoint,
  type AnalyticsIdentity,
  type AnalyticsPlatform,
} from "./usage-analytics-service";

export const ANALYTICS_SUBCOMMANDS = ["log", "preview"] as const;

export type AnalyticsCommandPorts = {
  readonly readConfig: () => Promise<Partial<KitsuneConfig>>;
  readonly pingLog: PingLog;
  readonly env: ConsentEnv & { readonly KUNAI_ANALYTICS_URL?: string | undefined };
  readonly now: () => number;
  readonly platform: AnalyticsPlatform;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
};

const USAGE = `kunai analytics <${ANALYTICS_SUBCOMMANDS.join("|")}> [--json]
  log       The last ${PING_LOG_LIMIT} pings, exactly as sent
  preview   The payload the next ping would send. Nothing is sent.
Turn analytics on or off in /settings or /analytics inside the app.
`;

export async function runAnalyticsCommand(
  argv: readonly string[],
  options: { readonly version: string; readonly ports?: AnalyticsCommandPorts },
): Promise<number> {
  const ports = options.ports ?? defaultPorts();
  const json = argv.includes("--json");
  const words = argv.filter((word) => !word.startsWith("-"));
  const unknownFlag = argv.find((word) => word.startsWith("-") && word !== "--json");
  const sub = words[0];
  if (unknownFlag || words.length !== 1 || (sub !== "log" && sub !== "preview")) {
    ports.err(USAGE);
    return 2;
  }

  const loaded = await ports.readConfig();
  // Startup's reading of the file, so preview and the real ping agree.
  const identity: AnalyticsIdentity = loadedAnalyticsFields(loaded);

  if (sub === "log") return printLog(identity, ports, json);
  return printPreview(identity, loaded, options.version, ports, json);
}

async function printLog(
  identity: AnalyticsIdentity,
  ports: AnalyticsCommandPorts,
  json: boolean,
): Promise<number> {
  if (identity.analytics !== "enabled") {
    // The log is kept only while enabled. One left behind by a disable this
    // build did not see is removed, not shown.
    await ports.pingLog.remove().catch(() => undefined);
    if (json) ports.out("[]\n");
    else ports.out("Analytics is off, so no pings are sent and none are kept.\n");
    return 0;
  }
  const entries = await ports.pingLog.read();
  if (json) {
    ports.out(`${JSON.stringify(entries, null, 2)}\n`);
    return 0;
  }
  if (entries.length === 0) {
    ports.out("Analytics is on. No ping has been sent from this install yet.\n");
    return 0;
  }
  for (const entry of entries) {
    ports.out(`${entry.sentAt}  ${entry.endpoint}\n${entry.body}\n`);
  }
  return 0;
}

function printPreview(
  identity: AnalyticsIdentity,
  loaded: Partial<KitsuneConfig>,
  version: string,
  ports: AnalyticsCommandPorts,
  json: boolean,
): number {
  const payload = describeAnalyticsPayload({
    identity,
    version,
    platform: ports.platform,
    now: ports.now(),
  });
  ports.out(`${JSON.stringify(payload, null, 2)}\n`);
  if (!json) ports.out(`${previewStatus(identity, loaded, ports.env)}\nNothing was sent.\n`);
  return 0;
}

function previewStatus(
  identity: AnalyticsIdentity,
  loaded: Partial<KitsuneConfig>,
  env: AnalyticsCommandPorts["env"],
): string {
  const blocked = envBlockFlag(env);
  if (blocked) return `${blocked} is set, so nothing is sent while it is.`;
  if (identity.analytics !== "enabled") {
    return "Analytics is off. This is what a ping would contain if you turned it on.";
  }
  const configured = typeof loaded.analyticsEndpoint === "string" ? loaded.analyticsEndpoint : "";
  const endpoint = resolveAnalyticsEndpoint(env, configured);
  if (!endpoint)
    return "Analytics is on, but the endpoint override is not https, so nothing is sent.";
  return `Analytics is on. At most one ping a day goes to ${new URL(endpoint).host}.`;
}

function defaultPorts(): AnalyticsCommandPorts {
  const storage = new FileStorage(undefined, (message) => {
    process.stderr.write(`kunai: ${message}\n`);
  });
  const store = new ConfigStoreImpl(storage);
  return {
    readConfig: () => store.load(),
    pingLog: filePingLog(pingLogPath()),
    env: {
      DO_NOT_TRACK: process.env.DO_NOT_TRACK,
      CI: process.env.CI,
      KUNAI_ANALYTICS_URL: process.env.KUNAI_ANALYTICS_URL,
    },
    now: () => Date.now(),
    platform: { os: analyticsOs(), arch: process.arch },
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  };
}
