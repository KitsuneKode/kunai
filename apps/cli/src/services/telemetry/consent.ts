export type TelemetryConsentChoice = "enabled" | "disabled" | "timeout";

export type TelemetryConsentDecision = "enabled" | "disabled";

export type TelemetryConsentInput = {
  readonly env: {
    readonly DO_NOT_TRACK?: string;
    readonly CI?: string;
  };
  readonly isTty: boolean;
  readonly choice: TelemetryConsentChoice;
};

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export type TelemetryEnvFlags = {
  readonly DO_NOT_TRACK?: string | undefined;
  readonly CI?: string | undefined;
};

/**
 * Hard gate for send and enable paths — not only consent.
 * When DO_NOT_TRACK or CI is set, telemetry must never fetch, even if config says enabled.
 */
export function isTelemetryEnvBlocked(
  env: TelemetryEnvFlags = {
    DO_NOT_TRACK: process.env.DO_NOT_TRACK,
    CI: process.env.CI,
  },
): boolean {
  return isTruthyEnv(env.DO_NOT_TRACK) || isTruthyEnv(env.CI);
}

/**
 * Resolve telemetry consent. Decline / timeout / non-TTY / CI / DO_NOT_TRACK → disabled.
 * Opt-in only: enabled solely when the user explicitly chooses yes in an interactive TTY.
 */
export function resolveTelemetryConsent(input: TelemetryConsentInput): TelemetryConsentDecision {
  if (isTelemetryEnvBlocked(input.env)) {
    return "disabled";
  }
  if (!input.isTty) {
    return "disabled";
  }
  if (input.choice === "enabled") {
    return "enabled";
  }
  return "disabled";
}
