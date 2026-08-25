import type { RelayAuthorizationPolicy } from "@kunai/relay";

import { handleRelayRequest } from "./relay-app";

const DEFAULT_HOSTNAME = "127.0.0.1";
const DEFAULT_PORT = 8787;

export interface RelayDevelopmentEnvironment {
  readonly PORT?: string;
  readonly RELAY_HOST?: string;
  readonly RELAY_TOKEN?: string;
}

export interface RelayDevelopmentPolicy {
  readonly hostname: string;
  readonly port: number;
  readonly authorization: RelayAuthorizationPolicy;
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
  };
}

export function createRelayDevServerOptions(policy: RelayDevelopmentPolicy) {
  return {
    hostname: policy.hostname,
    port: policy.port,
    fetch(request: Request) {
      return handleRelayRequest(request, { authorization: policy.authorization });
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
