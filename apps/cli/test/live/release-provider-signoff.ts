/**
 * Release default-route provider signoff schema + redaction helpers.
 * Network-free so unit tests can lock completeness and privacy without live hosts.
 */
import { z } from "zod";

export type ReleaseSignoffLane = "movie" | "series" | "anime";

export type ReleaseSignoffFailureClass =
  | "provider-drift"
  | "environment-network"
  | "harness-failure";

export interface ReleaseProviderSignoffRoute {
  readonly lane: ReleaseSignoffLane;
  readonly targetId: string;
  readonly targetTitle: string;
  readonly configuredProvider: string;
  readonly successfulProvider: string | null;
  readonly resolved: boolean;
  readonly streamCandidates: number;
  readonly streamReachable: boolean | null;
  readonly failureClass: ReleaseSignoffFailureClass | null;
  readonly durationMs: number;
}

export interface ReleaseAvailabilityDiagnostic {
  readonly lane: "movie";
  readonly targetId: string;
  readonly targetTitle: string;
  readonly provider: string;
  readonly status: "not-found" | "available" | "failed";
  readonly verifiedNotFound: boolean;
  readonly resolved: boolean;
  readonly streamCandidates: number;
  readonly streamReachable: boolean | null;
  readonly failureClass: ReleaseSignoffFailureClass | null;
  readonly durationMs: number;
}

export interface ReleaseProviderSignoff {
  readonly schemaVersion: 2;
  readonly generatedAt: string;
  readonly commitSha: string;
  readonly version: string;
  readonly routes: readonly ReleaseProviderSignoffRoute[];
  readonly diagnostics: readonly ReleaseAvailabilityDiagnostic[];
}

export const RELEASE_SIGNOFF_REQUIRED_CONTROLS = [
  { lane: "movie", targetId: "27205", targetTitle: "Inception" },
  { lane: "movie", targetId: "550", targetTitle: "Fight Club" },
  { lane: "series", targetId: "299167", targetTitle: "Dutton Ranch" },
  { lane: "anime", targetId: "search:Onigiri", targetTitle: "Onigiri" },
] as const;

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
  readonly diagnostics: readonly ReleaseAvailabilityDiagnostic[];
}): ReleaseProviderSignoff {
  const signoff: ReleaseProviderSignoff = {
    schemaVersion: 2,
    generatedAt: input.generatedAt,
    commitSha: input.commitSha,
    version: input.version,
    routes: input.routes.map(sanitizeRoute),
    diagnostics: input.diagnostics.map(sanitizeDiagnostic),
  };
  assertReleaseProviderSignoffComplete(signoff);
  assertReleaseProviderSignoffRedacted(signoff);
  return signoff;
}

export function assertReleaseProviderSignoffComplete(signoff: ReleaseProviderSignoff): void {
  if (signoff.schemaVersion !== 2) {
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

  const controls = new Set<string>();
  for (const route of signoff.routes) {
    assertRoutePayload(route);
    const key = `${route.lane}:${route.targetId}`;
    if (controls.has(key)) {
      throw new Error(`Duplicate release signoff control: ${key}`);
    }
    controls.add(key);
    if (
      !RELEASE_SIGNOFF_REQUIRED_CONTROLS.some(
        (expected) =>
          expected.lane === route.lane &&
          expected.targetId === route.targetId &&
          expected.targetTitle === route.targetTitle,
      )
    ) {
      throw new Error(`Unexpected release signoff control: ${key}`);
    }
  }

  for (const required of RELEASE_SIGNOFF_REQUIRED_CONTROLS) {
    if (!controls.has(`${required.lane}:${required.targetId}`)) {
      throw new Error(
        `Missing release signoff control for lane: ${required.lane}, target: ${required.targetId}`,
      );
    }
  }
  if (!Array.isArray(signoff.diagnostics) || signoff.diagnostics.length !== 1) {
    throw new Error("Release signoff requires the Dune availability diagnostic");
  }
  const diagnostic = signoff.diagnostics[0];
  if (!diagnostic) throw new Error("Release signoff requires the Dune availability diagnostic");
  if (
    diagnostic.lane !== "movie" ||
    diagnostic.targetId !== "438631" ||
    diagnostic.targetTitle !== "Dune"
  ) {
    throw new Error("Unexpected release availability diagnostic target");
  }
  assertRoutePayload({
    ...diagnostic,
    configuredProvider: diagnostic.provider,
    successfulProvider: diagnostic.resolved ? diagnostic.provider : null,
  });
  if (
    !z.boolean().safeParse(diagnostic.verifiedNotFound).success ||
    !["not-found", "available", "failed"].includes(diagnostic.status)
  ) {
    throw new Error("Invalid release availability diagnostic status");
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
  // A different provider succeeding is still a failed release for the
  // CONFIGURED default, even though some stream played. Substitution is exactly
  // how signoff went green while the product's real default route was broken.
  const controlsPass = signoff.routes.every(
    (route) =>
      route.resolved &&
      route.streamReachable === true &&
      route.streamCandidates > 0 &&
      route.failureClass === null &&
      route.successfulProvider === route.configuredProvider,
  );
  const movieProvider = signoff.routes.find((route) => route.lane === "movie")?.configuredProvider;
  if (
    !controlsPass ||
    !movieProvider ||
    signoff.routes.some(
      (route) => route.lane !== "anime" && route.configuredProvider !== movieProvider,
    )
  )
    return false;
  return signoff.diagnostics.every(
    (diagnostic) =>
      diagnostic.provider === movieProvider &&
      diagnostic.failureClass === null &&
      (diagnostic.status === "not-found"
        ? diagnostic.verifiedNotFound &&
          !diagnostic.resolved &&
          diagnostic.streamCandidates === 0 &&
          diagnostic.streamReachable === null
        : diagnostic.status === "available" &&
          !diagnostic.verifiedNotFound &&
          diagnostic.resolved &&
          diagnostic.streamCandidates > 0 &&
          diagnostic.streamReachable === true),
  );
}

/** Only explicit observed absence plus clean not-found failures can waive availability. */
export function buildReleaseAvailabilityDiagnostic(input: {
  readonly route: ReleaseProviderSignoffRoute;
  readonly failureCodes: readonly string[];
  readonly catalogAbsenceObserved: boolean;
}): ReleaseAvailabilityDiagnostic {
  const { route } = input;
  const absent =
    input.catalogAbsenceObserved &&
    input.failureCodes.length > 0 &&
    input.failureCodes.every((code) => code === "not-found") &&
    route.failureClass !== "environment-network" &&
    route.failureClass !== "harness-failure" &&
    !route.resolved &&
    route.successfulProvider === null &&
    route.streamCandidates === 0 &&
    route.streamReachable === null;
  const available =
    route.resolved &&
    route.streamCandidates > 0 &&
    route.streamReachable === true &&
    route.failureClass === null &&
    route.successfulProvider === route.configuredProvider;
  return {
    lane: "movie",
    targetId: route.targetId,
    targetTitle: route.targetTitle,
    provider: route.configuredProvider,
    status: absent ? "not-found" : available ? "available" : "failed",
    verifiedNotFound: absent,
    resolved: route.resolved,
    streamCandidates: route.streamCandidates,
    streamReachable: route.streamReachable,
    failureClass: absent || available ? null : (route.failureClass ?? "provider-drift"),
    durationMs: route.durationMs,
  };
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
    // `cloudflare`/`just a moment`/`challenge` are as much a WAF-shaped block as
    // a bare 403, and the anidb client reports one in words rather than a status
    // code: "anidb blocked by Cloudflare (try curl-impersonate)". Without them a
    // runner refused on TLS fingerprint was filed as provider drift, which sent
    // a release investigation at a provider that was healthy the whole time.
    // A bare 5xx would match "episode 512" — statuses count only in HTTP-status
    // context ("HTTP 503", "status: 500"), the shape every provider emits.
    /within \d+s|timed out|timeout|econn|enotfound|network|cannot connect|connection|403|waf|socket|cloudflare|just a moment|challenge|blocked by|unreachable|unavailable|\b(?:http|status)\b[\s=:/]*(?:\d[\d.]*\s)?5\d{2}\b/.test(
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
    targetId: route.targetId,
    targetTitle: route.targetTitle,
    configuredProvider: route.configuredProvider,
    successfulProvider: route.successfulProvider,
    resolved: route.resolved,
    streamCandidates: route.streamCandidates,
    streamReachable: route.streamReachable,
    failureClass: route.failureClass,
    durationMs: route.durationMs,
  };
}

/** Copy only the diagnostic contract; raw provider evidence stays outside release artifacts. */
function sanitizeDiagnostic(
  diagnostic: ReleaseAvailabilityDiagnostic,
): ReleaseAvailabilityDiagnostic {
  return {
    lane: diagnostic.lane,
    targetId: diagnostic.targetId,
    targetTitle: diagnostic.targetTitle,
    provider: diagnostic.provider,
    status: diagnostic.status,
    verifiedNotFound: diagnostic.verifiedNotFound,
    resolved: diagnostic.resolved,
    streamCandidates: diagnostic.streamCandidates,
    streamReachable: diagnostic.streamReachable,
    failureClass: diagnostic.failureClass,
    durationMs: diagnostic.durationMs,
  };
}

function assertRoutePayload(route: ReleaseProviderSignoffRoute): void {
  const { lane } = route;
  if (!route.targetId?.trim() || !route.targetTitle?.trim()) {
    throw new Error(`Release signoff lane ${lane} requires target identity`);
  }
  if (!route.configuredProvider.trim()) {
    throw new Error(`Release signoff lane ${lane} requires configuredProvider`);
  }
  // Runtime completeness check — `in` would narrow the required field to `never`.
  if ((route as { successfulProvider?: unknown }).successfulProvider === undefined) {
    throw new Error(`Release signoff lane ${lane} requires successfulProvider field`);
  }
  if (typeof route.resolved !== "boolean") {
    throw new Error(`Release signoff lane ${lane} requires resolved boolean`);
  }
  if (typeof route.streamCandidates !== "number" || !Number.isFinite(route.streamCandidates)) {
    throw new Error(`Release signoff lane ${lane} requires streamCandidates number`);
  }
  if (
    !Number.isInteger(route.streamCandidates) ||
    route.streamCandidates < 0 ||
    route.durationMs < 0
  ) {
    throw new Error(`Release signoff lane ${lane} has invalid counts or duration`);
  }
  if (
    route.successfulProvider !== null &&
    !z.string().safeParse(route.successfulProvider).success
  ) {
    throw new Error(`Release signoff lane ${lane} has invalid successfulProvider`);
  }
  if (
    route.failureClass !== null &&
    !["provider-drift", "environment-network", "harness-failure"].includes(route.failureClass)
  ) {
    throw new Error(`Release signoff lane ${lane} has invalid failureClass`);
  }
  if (route.streamReachable !== null && typeof route.streamReachable !== "boolean") {
    throw new Error(`Release signoff lane ${lane} requires streamReachable boolean|null`);
  }
  if (typeof route.durationMs !== "number" || !Number.isFinite(route.durationMs)) {
    throw new Error(`Release signoff lane ${lane} requires durationMs number`);
  }
}
