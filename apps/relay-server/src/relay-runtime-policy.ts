import type { RelayAuthorizationPolicy } from "@kunai/relay";

import { handleRelayRequest } from "./relay-app";

const DEFAULT_HOSTNAME = "127.0.0.1";
const DEFAULT_PORT = 8787;

export interface RelayDevelopmentEnvironment {
  readonly PORT?: string;
  readonly RELAY_HOST?: string;
  readonly RELAY_TOKEN?: string;
  readonly RELAY_CORS_ORIGINS?: string;
}

export interface RelayDevelopmentPolicy {
  readonly hostname: string;
  readonly port: number;
  readonly authorization: RelayAuthorizationPolicy;
  readonly corsAllowedOrigins: readonly string[];
}

export function resolveRelayDevelopmentPolicy(
  env: RelayDevelopmentEnvironment,
): RelayDevelopmentPolicy {
  const hostname = env.RELAY_HOST?.trim() || DEFAULT_HOSTNAME;
  const token = env.RELAY_TOKEN?.trim();

  if (!token && hostname !== "127.0.0.1" && hostname !== "::1") {
    throw new Error(`RELAY_TOKEN is required when RELAY_HOST is ${hostname}`);
  }

  return {
    hostname,
    port: resolvePort(env.PORT),
    authorization: token ? { mode: "bearer", token } : { mode: "local-loopback" },
    corsAllowedOrigins: resolveCorsOrigins(env.RELAY_CORS_ORIGINS),
  };
}

/**
 * Comma-separated origin allowlist; absent/empty means CORS is off entirely.
 * Entries must be bare origins — a path or typo would otherwise never match
 * and fail closed without telling the operator why.
 */
function resolveCorsOrigins(value: string | undefined): readonly string[] {
  const origins = (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(
        `RELAY_CORS_ORIGINS entries must be origins like https://app.example; received ${origin}`,
      );
    }
    if (parsed.origin !== origin) {
      throw new Error(
        `RELAY_CORS_ORIGINS entries must be bare origins (scheme://host[:port]); received ${origin}`,
      );
    }
  }
  return origins;
}

export function createRelayDevServerOptions(policy: RelayDevelopmentPolicy) {
  return {
    hostname: policy.hostname,
    port: policy.port,
    fetch(request: Request) {
      return handleRelayRequest(request, {
        authorization: policy.authorization,
        corsAllowedOrigins: policy.corsAllowedOrigins,
      });
    },
  };
}

function resolvePort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PORT;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`PORT must be an integer from 1 through 65535; received ${value}`);
  }
  const port = Number(normalized);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT must be an integer from 1 through 65535; received ${value}`);
  }
  return port;
}
