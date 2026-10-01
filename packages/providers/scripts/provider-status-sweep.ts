/**
 * Live provider-status sweep.
 *
 * Runs each production provider module against a known-good fixture title on
 * the caller's network and writes `apps/docs/lib/generated-provider-status.json`.
 * The scheduled workflow (.github/workflows/provider-status-sweep.yml) runs
 * this on GitHub's egress so the published board reflects a clean-region view;
 * a local run reports *this* network's view and is still useful for diagnosing
 * region-gated providers.
 *
 * Always exits 0: an exhausted or blocked provider is status data, not a
 * script failure. Non-zero would only mean the sweep itself could not run.
 */
import fs from "node:fs";
import path from "node:path";

import type { ProviderRuntimeContext } from "@kunai/types";

import { SWEEP_PROBES, type SweepProbe } from "./provider-sweep-roster";

const OUTPUT_PATH = path.resolve(
  import.meta.dir,
  "../../../apps/docs/lib/generated-provider-status.json",
);

const RESOLVE_TIMEOUT_MS = 30_000;
const FRONT_DOOR_TIMEOUT_MS = 12_000;

type SweepStatus = "healthy" | "degraded" | "blocked" | "down" | "dead";

interface ProviderRow {
  readonly id: string;
  readonly upstreamHttp: number | null;
  readonly upstreamReachable: boolean;
  readonly resolveStatus: string;
  readonly resolveMs: number | null;
  readonly streams: number;
  readonly qualities: readonly string[];
  readonly servers: readonly string[];
  readonly audioLanguages: readonly string[];
  readonly subtitleLanes: number;
  readonly effectiveStatus: SweepStatus;
  readonly note: string;
}

interface StatusFile {
  readonly generatedAt: string;
  readonly schemaVersion: 1;
  readonly providers: readonly ProviderRow[];
}

const resolveContext = (signal: AbortSignal): ProviderRuntimeContext => ({
  fetch: {
    runtime: "direct-http",
    fetch: (input, init) => fetch(input, init),
  },
  now: () => new Date().toISOString(),
  signal,
  cache: {
    read: async () => null,
    write: async () => {},
  },
  endpointHealth: {
    shouldTry: () => true,
    recordSuccess: () => {},
    recordFailure: () => {},
  },
});

// The probe set comes from the shared production roster — see
// `provider-sweep-roster.ts`. Adding a provider to production without a
// fixture there fails the sweep-coverage test instead of silently omitting it.
const PROBES = SWEEP_PROBES;

async function probeFrontDoor(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(FRONT_DOOR_TIMEOUT_MS),
      headers: { "user-agent": "Mozilla/5.0 (provider-status-sweep)" },
    });
    return res.status;
  } catch {
    return null;
  }
}

interface Classification {
  status: SweepStatus;
  note: string;
}

function classify(
  upstreamHttp: number | null,
  resolveStatus: string,
  streams: number,
  firstFailureCode: string | undefined,
): Classification {
  if (upstreamHttp === null && resolveStatus !== "resolved") {
    return { status: "dead", note: "upstream unreachable" };
  }
  if (resolveStatus === "resolved" && streams > 0) {
    return { status: "healthy", note: "" };
  }
  if (firstFailureCode === "blocked") {
    return {
      status: "blocked",
      note: "upstream challenges this network (WAF/captcha); relay in an ungated region bypasses",
    };
  }
  if (upstreamHttp === 503) {
    return { status: "down", note: "upstream reports maintenance" };
  }
  if (resolveStatus === "exhausted") {
    return { status: "degraded", note: "upstream up but resolve exhausted" };
  }
  return { status: "degraded", note: `resolve status ${resolveStatus}` };
}

async function probe(spec: SweepProbe): Promise<ProviderRow> {
  const upstreamHttp = await probeFrontDoor(spec.frontDoor);
  const started = Date.now();
  const signal = AbortSignal.timeout(RESOLVE_TIMEOUT_MS);
  try {
    const result = await spec.module.resolve(spec.input, resolveContext(signal));
    const resolveMs = Date.now() - started;
    const status = result.status;
    const streams = result.streams;
    const failures = result.failures;
    const qualities = [
      ...new Set(streams.map((s) => s.qualityLabel ?? "").filter((q) => q.length > 0)),
    ];
    const servers = [
      ...new Set(streams.map((s) => s.serverName ?? "").filter((s) => s.length > 0)),
    ];
    const audio = [...new Set(streams.flatMap((s) => s.audioLanguages ?? []))];
    const subtitleLanes =
      result.subtitles.length ||
      streams.filter((s) => (s.subtitleLanguages?.length ?? 0) > 0).length;
    const classified = classify(upstreamHttp, status, streams.length, failures[0]?.code);
    if (status !== "resolved" && /captcha|waf|challenge/i.test(failures[0]?.message ?? "")) {
      classified.status = "blocked";
      classified.note =
        "upstream challenges this network (WAF/captcha); relay in an ungated region bypasses";
    }
    const note = classified.note || (failures[0]?.message?.slice(0, 140) ?? "");
    return {
      id: spec.id,
      upstreamHttp,
      upstreamReachable: upstreamHttp !== null && upstreamHttp < 500,
      resolveStatus: status,
      resolveMs,
      streams: streams.length,
      qualities,
      servers,
      audioLanguages: audio,
      subtitleLanes,
      effectiveStatus: classified.status,
      note,
    };
  } catch (error) {
    return {
      id: spec.id,
      upstreamHttp,
      upstreamReachable: upstreamHttp !== null && upstreamHttp < 500,
      resolveStatus: "error",
      resolveMs: Date.now() - started,
      streams: 0,
      qualities: [],
      servers: [],
      audioLanguages: [],
      subtitleLanes: 0,
      effectiveStatus: upstreamHttp === null ? "dead" : upstreamHttp === 503 ? "down" : "degraded",
      note: error instanceof Error ? error.message.slice(0, 140) : String(error),
    };
  }
}

async function main() {
  const rows = await Promise.all(PROBES.map(probe));
  const file: StatusFile = {
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    providers: rows,
  };
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(file, null, 2)}\n`);
  for (const row of rows) {
    console.log(
      `${row.id.padEnd(10)} ${row.effectiveStatus.padEnd(8)} http=${row.upstreamHttp ?? "—"} resolve=${row.resolveStatus} streams=${row.streams} ${row.note}`,
    );
  }
  console.log(`wrote ${OUTPUT_PATH}`);
}

await main();
