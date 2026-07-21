export type OfflineBetaSmokeCheckId =
  | "enqueue"
  | "cancel"
  | "shutdown-pause"
  | "restart-recovery"
  | "artifact-discovery"
  | "subtitle-sidecar"
  | "timing-metadata"
  | "local-playback-start"
  | "clean-shutdown";

export type OfflineBetaSmokeCheck = {
  readonly id: OfflineBetaSmokeCheckId;
  readonly ok: boolean;
  readonly detail?: string;
};

export type OfflineBetaSmokeReport = {
  readonly ok: boolean;
  readonly skipped: boolean;
  readonly profileRoot: string;
  readonly checks: readonly OfflineBetaSmokeCheck[];
};

export const OFFLINE_BETA_SMOKE_REQUIRED_CHECKS: readonly OfflineBetaSmokeCheckId[] = [
  "enqueue",
  "cancel",
  "shutdown-pause",
  "restart-recovery",
  "artifact-discovery",
  "subtitle-sidecar",
  "timing-metadata",
  "local-playback-start",
  "clean-shutdown",
] as const;

export function buildOfflineBetaSmokeReport(
  checks: readonly OfflineBetaSmokeCheck[],
  profileRoot: string,
): OfflineBetaSmokeReport {
  const seen = new Set<OfflineBetaSmokeCheckId>();
  for (const check of checks) {
    if (seen.has(check.id)) {
      throw new Error(`Duplicate offline beta smoke check: ${check.id}`);
    }
    seen.add(check.id);
  }

  for (const required of OFFLINE_BETA_SMOKE_REQUIRED_CHECKS) {
    if (!seen.has(required)) {
      throw new Error(`Missing offline beta smoke check: ${required}`);
    }
  }

  for (const check of checks) {
    if (!(OFFLINE_BETA_SMOKE_REQUIRED_CHECKS as readonly string[]).includes(check.id)) {
      throw new Error(`Unexpected offline beta smoke check: ${check.id}`);
    }
  }

  return {
    ok: checks.every((check) => check.ok),
    skipped: false,
    profileRoot,
    checks,
  };
}

export function buildOfflineBetaSmokeSkippedReport(reason: string): {
  readonly ok: true;
  readonly skipped: true;
  readonly reason: string;
} {
  return {
    ok: true,
    skipped: true,
    reason,
  };
}

/** Strip fixture URLs and temp paths before printing smoke JSON (parity with provider-matrix). */
export function redactVolatileText(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"']+/gi, "https://REDACTED")
    .replace(/\/tmp\/[^\s"']+/gi, "/tmp/REDACTED");
}
