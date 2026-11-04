export class CompanionServeArgsError extends Error {
  override readonly name = "CompanionServeArgsError";
}

const LOOPBACK = "127.0.0.1";

export interface ServeCommandOptions {
  readonly port: number;
  readonly host: string;
}

function normalizeHost(raw: string): string {
  const host = raw.trim().toLowerCase();
  if (host === "localhost" || host === LOOPBACK || host === "[::1]" || host === "::1") {
    return LOOPBACK;
  }
  throw new CompanionServeArgsError("Companion must bind to numeric loopback only.");
}

function parsePort(value: string): number {
  if (!/^\d+$/.test(value.trim())) {
    throw new CompanionServeArgsError("Invalid companion port.");
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    throw new CompanionServeArgsError("Invalid companion port.");
  }
  return parsed;
}

export function parseServeArgs(argv: readonly string[]): ServeCommandOptions {
  let port = 4141;
  let host = LOOPBACK;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const nextArg = argv[i + 1];
    if (arg === "-p" || arg === "--port") {
      if (nextArg === undefined) throw new CompanionServeArgsError("Missing value for --port.");
      port = parsePort(nextArg);
      i++;
      continue;
    }
    if (arg === "-h" || arg === "--host") {
      if (nextArg === undefined) throw new CompanionServeArgsError("Missing value for --host.");
      host = normalizeHost(nextArg);
      i++;
      continue;
    }
    throw new CompanionServeArgsError(`Unknown companion option: ${arg}`);
  }

  return { port, host };
}
