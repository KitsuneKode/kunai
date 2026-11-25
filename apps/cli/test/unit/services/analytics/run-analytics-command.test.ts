import { describe, expect, test } from "bun:test";

import { monthlyWireId } from "@/services/analytics/install-id";
import {
  runAnalyticsCommand,
  type AnalyticsCommandPorts,
} from "@/services/analytics/run-analytics-command";
import {
  UNSET_COHORT_PLACEHOLDER,
  UNSET_INSTALL_ID_PLACEHOLDER,
} from "@/services/analytics/usage-analytics-service";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

import { memoryPingLog } from "../../../support/analytics-fixtures";

const UUID = "11111111-2222-4333-8444-555555555555";
const NOW = Date.parse("2026-11-25T06:00:00.000Z");
/** A config written by an explicit opt-in (it carries the notice marker). */
const ENABLED: Partial<KitsuneConfig> = {
  analytics: "enabled",
  analyticsNoticeShown: true,
  installId: UUID,
  analyticsCohort: "2026-10",
};

function harness(config: Partial<KitsuneConfig>, env: AnalyticsCommandPorts["env"] = {}) {
  const pingLog = memoryPingLog();
  let out = "";
  let err = "";
  let reads = 0;
  const ports: AnalyticsCommandPorts = {
    readConfig: async () => {
      reads += 1;
      return { ...config };
    },
    pingLog,
    env,
    now: () => NOW,
    platform: { os: "linux", arch: "x64" },
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  };
  const run = (...argv: string[]) => runAnalyticsCommand(argv, { version: "0.4.0", ports });
  return {
    run,
    pingLog,
    get out() {
      return out;
    },
    get err() {
      return err;
    },
    get reads() {
      return reads;
    },
  };
}

describe("kunai analytics log", () => {
  test("prints every logged ping exactly as sent", async () => {
    const h = harness(ENABLED);
    const body = '{"id":"abc","cohort":"2026-10"}';
    await h.pingLog.append({
      sentAt: "2026-11-24T06:00:00.000Z",
      endpoint: "https://x.test",
      body,
    });
    expect(await h.run("log")).toBe(0);
    expect(h.out).toContain(body);
    expect(h.out).toContain("2026-11-24T06:00:00.000Z");
  });

  test("--json prints the entries themselves", async () => {
    const h = harness(ENABLED);
    const entry = { sentAt: "2026-11-24T06:00:00.000Z", endpoint: "https://x.test", body: "{}" };
    await h.pingLog.append(entry);
    await h.run("log", "--json");
    expect(JSON.parse(h.out)).toEqual([entry]);
  });

  test("while analytics is off it shows nothing and removes a log left behind", async () => {
    const h = harness({ analytics: "disabled", installId: "" });
    await h.pingLog.append({ sentAt: "x", endpoint: "https://x.test", body: "{}" });
    expect(await h.run("log")).toBe(0);
    expect(h.out).toContain("off");
    expect(h.pingLog.exists).toBe(false);
  });
});

describe("kunai analytics preview", () => {
  test("prints the payload the next ping would send, and says nothing was sent", async () => {
    const h = harness(ENABLED);
    expect(await h.run("preview")).toBe(0);
    const json = h.out.slice(0, h.out.lastIndexOf("}") + 1);
    expect(JSON.parse(json)).toEqual({
      id: monthlyWireId(UUID, "2026-11"),
      cohort: "2026-10",
      day: "2026-11-25",
      version: "0.4.0",
      os: "linux",
      arch: "x64",
    });
    expect(h.out).toContain("Nothing was sent.");
  });

  test("before consent it shows placeholders and creates nothing", async () => {
    const h = harness({ analytics: "unset", installId: "" });
    await h.run("preview", "--json");
    const payload = JSON.parse(h.out) as { id: string; cohort: string };
    expect(payload.id).toBe(UNSET_INSTALL_ID_PLACEHOLDER);
    expect(payload.cohort).toBe(UNSET_COHORT_PLACEHOLDER);
    expect(h.pingLog.exists).toBe(false);
  });

  test("an enabled value from before explicit consent is not treated as consent", async () => {
    const h = harness({ analytics: "enabled", installId: UUID });
    await h.run("preview", "--json");
    expect((JSON.parse(h.out) as { id: string }).id).toBe(UNSET_INSTALL_ID_PLACEHOLDER);
  });

  test("names an env block", async () => {
    const h = harness(ENABLED, { DO_NOT_TRACK: "1" });
    await h.run("preview");
    expect(h.out).toContain("DO_NOT_TRACK is set");
  });
});

describe("kunai analytics is never a way in", () => {
  test("neither subcommand sends, and an unknown one prints usage", async () => {
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    try {
      for (const argv of [["log"], ["preview"], ["enable"], ["on"], []]) {
        await harness({ analytics: "unset", installId: "" }).run(...argv);
      }
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(calls).toBe(0);
  });

  test("there is no enable subcommand", async () => {
    const h = harness({ analytics: "unset", installId: "" });
    expect(await h.run("enable")).toBe(2);
    expect(h.err).toContain("kunai analytics <log|preview>");
    expect(h.reads).toBe(0);
  });

  test("unknown flags are refused", async () => {
    expect(await harness(ENABLED).run("log", "--yes")).toBe(2);
  });
});
