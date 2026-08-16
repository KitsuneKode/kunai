/**
 * The single definition of analytics consent.
 *
 * Pure: no I/O, no `process.env` default parameter. Callers pass the
 * environment in, which is what makes the truth table in the tests
 * exhaustible. Three earlier copies of this logic disagreed about what a
 * "set" env var means, and `CI=0` was read as blocking — which permanently
 * persisted `disabled` for anyone whose environment said "no".
 */

import type { AnalyticsPreference } from "@kunai/config";

export type ConsentEnv = {
  readonly DO_NOT_TRACK?: string | undefined;
  readonly CI?: string | undefined;
};

export type ConsentState =
  | { readonly kind: "blocked-by-env"; readonly flag: "DO_NOT_TRACK" | "CI" }
  | { readonly kind: "undisclosed-non-interactive" }
  | { readonly kind: "awaiting-disclosure" }
  | { readonly kind: "enabled" }
  | { readonly kind: "disabled" };

/** A flag counts as set only when it affirmatively says yes. `0` means no. */
export function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function envBlockFlag(env: ConsentEnv): "DO_NOT_TRACK" | "CI" | null {
  if (isTruthyEnv(env.DO_NOT_TRACK)) return "DO_NOT_TRACK";
  if (isTruthyEnv(env.CI)) return "CI";
  return null;
}

export function resolveConsentState(inputs: {
  readonly env: ConsentEnv;
  readonly isInteractive: boolean;
  readonly stored: AnalyticsPreference;
}): ConsentState {
  const flag = envBlockFlag(inputs.env);
  if (flag) return { kind: "blocked-by-env", flag };
  if (inputs.stored === "disabled") return { kind: "disabled" };
  // A prior opt-in does not permit a scripted or piped invocation to emit a
  // ping. Keeping this before the enabled preference makes non-TTY a hard
  // delivery gate while preserving an explicit disabled state.
  if (!inputs.isInteractive) return { kind: "undisclosed-non-interactive" };
  if (inputs.stored === "enabled") return { kind: "enabled" };
  return { kind: "awaiting-disclosure" };
}

export function canSend(state: ConsentState): boolean {
  return state.kind === "enabled";
}

export function canPersistEnabled(state: ConsentState): boolean {
  return state.kind !== "blocked-by-env";
}
