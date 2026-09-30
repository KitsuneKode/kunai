import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { RELAY_CAPABLE_PROVIDER_OPTIONS } from "@/domain/provider-relay-settings";
import { parseProviderRelayConfig } from "@kunai/config";
import { resolveEffectiveProviderRelayConfig } from "@kunai/relay";

/**
 * Outcome of the relay roster probe, already classified for `collectFindings`.
 * Every non-`ok` status is a note, not a failure — doctor runs offline and a
 * relay the machine cannot reach is not an install defect.
 */
export interface DoctorRelayCoverage {
  readonly status:
    | "not-configured"
    | "unreachable"
    | "no-provider-ids"
    | "ok"
    | "missing-providers";
  readonly baseUrl?: string;
  readonly missingProviderIds?: readonly string[];
  readonly detail?: string;
}

const RELAY_HEALTH_TIMEOUT_MS = 5_000;

/**
 * The relay's own deployment roster, read back over `/health`.providerIds.
 *
 * A relay deployed before a provider existed answers its RPC route with
 * `unknown-provider` — a refusal that used to read as the upstream's verdict
 * and once blanked the anime lane. This check makes the drift visible: diff
 * the deployment's roster against the client-side relay-capable list and say
 * exactly which providers the deployment does not know.
 */
export async function probeRelayCoverage(
  configDir: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DoctorRelayCoverage> {
  const relay = parseProviderRelayConfig(await readConfigRelay(configDir));
  const effective = resolveEffectiveProviderRelayConfig(relay, {
    baseUrl: process.env.KUNAI_RELAY_BASE_URL,
  });
  const baseUrl = effective.baseUrl;
  if (!baseUrl) return { status: "not-configured" };

  let body: unknown;
  try {
    const response = await fetchImpl(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(RELAY_HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { status: "unreachable", baseUrl, detail: `HTTP ${response.status}` };
    }
    body = await response.json();
  } catch (error) {
    return { status: "unreachable", baseUrl, detail: describeProbeError(error) };
  }

  // A relay deployed before health reported `providerIds` has nothing to diff
  // against — that is itself a finding (the deployment predates coverage
  // reporting), but it is not evidence of drift.
  const providerIds = readProviderIds(body);
  if (!providerIds) return { status: "no-provider-ids", baseUrl };

  const known = new Set(providerIds);
  const missing = RELAY_CAPABLE_PROVIDER_OPTIONS.map((option) => option.value).filter(
    (id) => !known.has(id),
  );
  if (missing.length > 0) {
    return { status: "missing-providers", baseUrl, missingProviderIds: missing };
  }
  return { status: "ok", baseUrl };
}

/** The health endpoint is unauthenticated and owns this shape — read it defensively anyway. */
function readProviderIds(body: unknown): readonly string[] | undefined {
  if (!body || typeof body !== "object") return undefined;
  const candidate = body as { providerIds?: unknown };
  if (!Array.isArray(candidate.providerIds)) return undefined;
  return candidate.providerIds.filter((id): id is string => typeof id === "string");
}

/**
 * `providerRelay` out of `config.json` — the same file the running shell
 * loads, read through the schema so a hand-edited value degrades to the
 * default (relay off) rather than taking doctor down with it.
 */
async function readConfigRelay(configDir: string): Promise<unknown> {
  try {
    const raw = await readFile(join(configDir, "config.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as { providerRelay?: unknown }).providerRelay
      : undefined;
  } catch {
    return undefined;
  }
}

/** Names, not messages: a fetch error message can embed the URL the user owns. */
function describeProbeError(error: unknown): string {
  if (error instanceof Error) return error.name;
  return "request failed";
}
