import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RELAY_CAPABLE_PROVIDER_OPTIONS } from "@/domain/provider-relay-settings";
import {
  buildDoctorReport,
  formatDoctorReportText,
} from "@/services/update/native-installer/doctor";
import { probeRelayCoverage } from "@/services/update/native-installer/doctor-relay";
import { getInstallLayoutPaths } from "@/services/update/native-installer/install-layout";

const RELAY_BASE_URL = "https://relay.example.test";
const ALL_RELAY_IDS = RELAY_CAPABLE_PROVIDER_OPTIONS.map((option) => option.value);
const made: string[] = [];

afterEach(async () => {
  delete process.env.KUNAI_RELAY_BASE_URL;
  for (const dir of made.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeConfigDir(config?: { providerRelay?: unknown }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kunai-doctor-relay-"));
  made.push(root);
  const configDir = join(root, "config");
  await mkdir(configDir, { recursive: true });
  if (config !== undefined) {
    await writeFile(join(configDir, "config.json"), `${JSON.stringify(config)}\n`);
  }
  return configDir;
}

function healthResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function fetchReturning(response: () => Response | Promise<Response>): typeof fetch {
  return (() => Promise.resolve(response())) as unknown as typeof fetch;
}

function fetchRejecting(error: unknown): typeof fetch {
  return (async () => {
    throw error;
  }) as unknown as typeof fetch;
}

describe("probeRelayCoverage", () => {
  test("skips without touching the network when no relay is configured", async () => {
    const configDir = await makeConfigDir();
    let fetched = false;
    const fetchImpl = (() => {
      fetched = true;
      return Promise.reject(new Error("must not be called"));
    }) as unknown as typeof fetch;

    const coverage = await probeRelayCoverage(configDir, fetchImpl);

    expect(coverage).toEqual({ status: "not-configured" });
    expect(fetched).toBe(false);
  });

  test("a malformed config.json degrades to not-configured instead of throwing", async () => {
    const configDir = await makeConfigDir();
    await writeFile(join(configDir, "config.json"), "{ not json\n");

    const coverage = await probeRelayCoverage(configDir, fetchRejecting(new Error("nope")));

    expect(coverage).toEqual({ status: "not-configured" });
  });

  test("KUNAI_RELAY_BASE_URL supplies the baseUrl when config has none", async () => {
    const configDir = await makeConfigDir();
    process.env.KUNAI_RELAY_BASE_URL = RELAY_BASE_URL;

    let requested = "";
    const fetchImpl = ((input: Request | string | URL) => {
      requested = String(input);
      return Promise.resolve(
        healthResponse({ ok: true, service: "kunai-relay", providerIds: ALL_RELAY_IDS }),
      );
    }) as unknown as typeof fetch;

    const coverage = await probeRelayCoverage(configDir, fetchImpl);

    expect(coverage.status).toBe("ok");
    expect(requested).toBe(`${RELAY_BASE_URL}/health`);
  });

  test("returns ok when the deployment knows every relay-capable provider", async () => {
    const configDir = await makeConfigDir({
      providerRelay: { baseUrl: RELAY_BASE_URL },
    });

    const coverage = await probeRelayCoverage(
      configDir,
      fetchReturning(() =>
        healthResponse({ ok: true, service: "kunai-relay", providerIds: ALL_RELAY_IDS }),
      ),
    );

    expect(coverage).toEqual({ status: "ok", baseUrl: RELAY_BASE_URL });
  });

  test("reports exactly which providers a stale deployment is missing", async () => {
    const configDir = await makeConfigDir({
      providerRelay: { baseUrl: RELAY_BASE_URL },
    });
    const staleRoster = ALL_RELAY_IDS.filter((id) => id !== "movy" && id !== "rivestream");

    const coverage = await probeRelayCoverage(
      configDir,
      fetchReturning(() =>
        healthResponse({ ok: true, service: "kunai-relay", providerIds: staleRoster }),
      ),
    );

    expect(coverage.status).toBe("missing-providers");
    // Settings-pane order — the same order a user sees the providers listed.
    expect(coverage.missingProviderIds).toEqual(["rivestream", "movy"]);
  });

  test("a health response without providerIds predates coverage reporting", async () => {
    const configDir = await makeConfigDir({
      providerRelay: { baseUrl: RELAY_BASE_URL },
    });

    const coverage = await probeRelayCoverage(
      configDir,
      fetchReturning(() => healthResponse({ ok: true, service: "kunai-relay", providers: 6 })),
    );

    expect(coverage).toEqual({ status: "no-provider-ids", baseUrl: RELAY_BASE_URL });
  });

  test("a non-2xx health response skips as unreachable", async () => {
    const configDir = await makeConfigDir({
      providerRelay: { baseUrl: RELAY_BASE_URL },
    });

    const coverage = await probeRelayCoverage(
      configDir,
      fetchReturning(() => healthResponse("oops", { status: 502 })),
    );

    expect(coverage.status).toBe("unreachable");
    expect(coverage.detail).toBe("HTTP 502");
  });

  test("a rejected fetch skips as unreachable with the error name, not its message", async () => {
    const configDir = await makeConfigDir({
      providerRelay: { baseUrl: RELAY_BASE_URL },
    });

    const coverage = await probeRelayCoverage(
      configDir,
      fetchRejecting(new TypeError("connect ECONNREFUSED 1.2.3.4:443")),
    );

    expect(coverage.status).toBe("unreachable");
    expect(coverage.detail).toBe("TypeError");
  });
});

describe("doctor report relay findings", () => {
  async function runReport(probe: () => ReturnType<typeof probeRelayCoverage>) {
    const root = await mkdtemp(join(tmpdir(), "kunai-doctor-relay-report-"));
    made.push(root);
    const layout = getInstallLayoutPaths({
      dataDir: join(root, "data"),
      cacheDir: join(root, "cache"),
      configDir: join(root, "config"),
      launcherPath: join(root, "bin", "kunai"),
      platform: "linux",
    });
    await mkdir(layout.configDir, { recursive: true });
    return buildDoctorReport({
      layout,
      now: () => "2026-07-21T10:00:00.000Z",
      runningExecutable: { path: join(root, "src", "kunai.ts"), version: "0.0.0" },
      pathValue: "",
      platform: "linux",
      fileExists: () => false,
      inspectManifest: async () => ({ status: "missing" }),
      probeCapabilities: async () => ({
        mpv: true,
        ffprobe: true,
        ytDlp: true,
        curl: { present: true, impersonates: true, profile: "chrome150" },
        image: {
          terminal: "unknown",
          protocol: "none",
          renderer: "none",
          available: false,
          reason: "test",
        },
        issues: [],
      }),
      probeRelayCoverage: probe,
    });
  }

  test("a stale deployment surfaces a warning naming the missing providers", async () => {
    const report = await runReport(async () => ({
      status: "missing-providers",
      baseUrl: RELAY_BASE_URL,
      missingProviderIds: ["movy", "vidrock"],
    }));

    const finding = report.findings.find((f) => f.code === "relay-roster-drift");
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("relay.example.test");
    expect(finding?.message).toContain("movy, vidrock");
    const text = formatDoctorReportText(report);
    expect(text).toContain("relay-roster-drift");
  });

  test("no configured relay is an info note, not a failure", async () => {
    const report = await runReport(async () => ({ status: "not-configured" }));

    const finding = report.findings.find((f) => f.code === "relay-coverage-skipped");
    expect(finding?.severity).toBe("info");
    expect(report.findings.every((f) => f.severity !== "error")).toBe(true);
  });

  test("an unreachable relay is an info note, not a failure", async () => {
    const report = await runReport(async () => ({
      status: "unreachable",
      baseUrl: RELAY_BASE_URL,
      detail: "TimeoutError",
    }));

    const finding = report.findings.find((f) => f.code === "relay-coverage-unreachable");
    expect(finding?.severity).toBe("info");
    expect(finding?.message).toContain("TimeoutError");
  });

  test("a deployment without providerIds reports that it predates coverage reporting", async () => {
    const report = await runReport(async () => ({
      status: "no-provider-ids",
      baseUrl: RELAY_BASE_URL,
    }));

    const finding = report.findings.find((f) => f.code === "relay-coverage-unreported");
    expect(finding?.severity).toBe("info");
    expect(finding?.message).toContain("predates");
  });

  test("a covered deployment reports ok", async () => {
    const report = await runReport(async () => ({
      status: "ok",
      baseUrl: RELAY_BASE_URL,
    }));

    const finding = report.findings.find((f) => f.code === "relay-coverage-ok");
    expect(finding?.severity).toBe("info");
    expect(finding?.message).toContain("relay.example.test");
  });
});
