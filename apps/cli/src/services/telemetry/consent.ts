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

/**
 * Resolve telemetry consent. Decline / timeout / non-TTY / CI / DO_NOT_TRACK → disabled.
 * Opt-in only: enabled solely when the user explicitly chooses yes in an interactive TTY.
 */
export function resolveTelemetryConsent(input: TelemetryConsentInput): TelemetryConsentDecision {
  if (isTruthyEnv(input.env.DO_NOT_TRACK) || isTruthyEnv(input.env.CI)) {
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
