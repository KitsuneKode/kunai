/**
 * Release default-route provider signoff schema + redaction helpers.
 * Network-free so unit tests can lock completeness and privacy without live hosts.
 */

export type ReleaseSignoffLane = "movie" | "series" | "anime";

export type ReleaseSignoffFailureClass =
  | "provider-drift"
  | "environment-network"
  | "harness-failure";

export interface ReleaseProviderSignoffRoute {
  readonly lane: ReleaseSignoffLane;
  readonly configuredProvider: string;
  readonly successfulProvider: string | null;
  readonly resolved: boolean;
  readonly streamCandidates: number;
  readonly streamReachable: boolean | null;
  readonly failureClass: ReleaseSignoffFailureClass | null;
  readonly durationMs: number;
}

export interface ReleaseProviderSignoff {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly commitSha: string;
  readonly version: string;
  readonly routes: readonly ReleaseProviderSignoffRoute[];
}

export const RELEASE_SIGNOFF_REQUIRED_LANES: readonly ReleaseSignoffLane[] = [
  "movie",
  "series",
  "anime",
] as const;

export const RELEASE_SIGNOFF_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const SENSITIVE_JSON_PATTERN =
  /https?:\/\/|token=|cookie|authorization|\/home\/|\/Users\/|XDG_|profileRoot|streamUrl|subtitleUrl/i;

export function redactVolatileSignoffText(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"'\\]+/gi, "https://REDACTED")
    .replace(/(token|access_token|auth)=([^\s&"'\\]+)/gi, "$1=REDACTED")
    .replace(/\/tmp\/[^\s"'\\]+/gi, "/tmp/REDACTED")
    .replace(/\/home\/[^\s"'\\]+/gi, "/home/REDACTED")
    .replace(/\/Users\/[^\s"'\\]+/gi, "/Users/REDACTED");
}

export function buildReleaseProviderSignoff(input: {
  readonly generatedAt: string;
  readonly commitSha: string;
  readonly version: string;
  readonly routes: readonly ReleaseProviderSignoffRoute[];
}): ReleaseProviderSignoff {
  const signoff: ReleaseProviderSignoff = {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    commitSha: input.commitSha,
    version: input.version,
    routes: input.routes.map(sanitizeRoute),
  };
  assertReleaseProviderSignoffComplete(signoff);
  assertReleaseProviderSignoffRedacted(signoff);
  return signoff;
}

export function assertReleaseProviderSignoffComplete(signoff: ReleaseProviderSignoff): void {
  if (signoff.schemaVersion !== 1) {
    throw new Error(`Unexpected release signoff schemaVersion: ${String(signoff.schemaVersion)}`);
  }
  if (!signoff.commitSha.trim()) {
    throw new Error("Release signoff requires commitSha");
  }
  if (!signoff.version.trim()) {
    throw new Error("Release signoff requires version");
  }
  if (!Number.isFinite(Date.parse(signoff.generatedAt))) {
    throw new Error(
      `Release signoff generatedAt is not a valid ISO timestamp: ${signoff.generatedAt}`,
    );
  }

  const lanes = new Set<ReleaseSignoffLane>();
  for (const route of signoff.routes) {
    if (lanes.has(route.lane)) {
      throw new Error(`Duplicate release signoff lane: ${route.lane}`);
    }
    lanes.add(route.lane);
    assertRouteShape(route);
  }

  for (const required of RELEASE_SIGNOFF_REQUIRED_LANES) {
    if (!lanes.has(required)) {
      throw new Error(`Missing release signoff lane: ${required}`);
    }
  }
}

export function assertReleaseProviderSignoffRedacted(signoff: ReleaseProviderSignoff): void {
  const serialized = JSON.stringify(signoff);
  if (SENSITIVE_JSON_PATTERN.test(serialized)) {
    throw new Error(
      "Release signoff evidence must not include stream URLs, tokens, cookies, or home paths",
    );
  }
}

export function isReleaseProviderSignoffFresh(
  generatedAt: string,
  nowMs: number,
  maxAgeMs: number = RELEASE_SIGNOFF_MAX_AGE_MS,
): boolean {
  const generatedMs = Date.parse(generatedAt);
  if (!Number.isFinite(generatedMs)) return false;
  return nowMs - generatedMs <= maxAgeMs && generatedMs <= nowMs + 60_000;
}

export function isReleaseProviderSignoffAcceptable(
  signoff: ReleaseProviderSignoff,
  nowMs: number,
): boolean {
  assertReleaseProviderSignoffComplete(signoff);
  assertReleaseProviderSignoffRedacted(signoff);
  if (!isReleaseProviderSignoffFresh(signoff.generatedAt, nowMs)) return false;
  return signoff.routes.every(
    (route) => route.resolved && route.streamReachable === true && route.failureClass === null,
  );
}

export function classifyReleaseSignoffFailure(input: {
  readonly resolved: boolean;
  readonly streamReachable: boolean | null;
  readonly timedOut?: boolean;
  readonly harness?: boolean;
  readonly error?: string | null;
  readonly failureCodes?: readonly string[];
}): ReleaseSignoffFailureClass | null {
  if (input.resolved && input.streamReachable === true) return null;
  if (input.harness) return "harness-failure";

  const haystack = [input.error ?? "", ...(input.failureCodes ?? [])].join(" ").toLowerCase();
  if (
    input.timedOut ||
    /within \d+s|timed out|timeout|econn|enotfound|network|cannot connect|connection|403|waf|socket/.test(
      haystack,
    )
  ) {
    return "environment-network";
  }
  return "provider-drift";
}

function sanitizeRoute(route: ReleaseProviderSignoffRoute): ReleaseProviderSignoffRoute {
  return {
    lane: route.lane,
    configuredProvider: route.configuredProvider,
    successfulProvider: route.successfulProvider,
    resolved: route.resolved,
    streamCandidates: route.streamCandidates,
    streamReachable: route.streamReachable,
    failureClass: route.failureClass,
    durationMs: route.durationMs,
  };
}

function assertRouteShape(route: ReleaseProviderSignoffRoute): void {
  if (!route.configuredProvider.trim()) {
    throw new Error(`Release signoff lane ${route.lane} requires configuredProvider`);
  }
  if (!("successfulProvider" in route)) {
    throw new Error(`Release signoff lane ${route.lane} requires successfulProvider field`);
  }
  if (typeof route.resolved !== "boolean") {
    throw new Error(`Release signoff lane ${route.lane} requires resolved boolean`);
  }
  if (typeof route.streamCandidates !== "number" || !Number.isFinite(route.streamCandidates)) {
    throw new Error(`Release signoff lane ${route.lane} requires streamCandidates number`);
  }
  if (route.streamReachable !== null && typeof route.streamReachable !== "boolean") {
    throw new Error(`Release signoff lane ${route.lane} requires streamReachable boolean|null`);
  }
  if (typeof route.durationMs !== "number" || !Number.isFinite(route.durationMs)) {
    throw new Error(`Release signoff lane ${route.lane} requires durationMs number`);
  }
}
