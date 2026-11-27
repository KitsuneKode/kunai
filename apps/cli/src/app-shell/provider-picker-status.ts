import type { ProviderMetadata } from "@/domain/types";
import {
  formatProviderHealthAge,
  resolveEffectiveProviderHealth,
  type EffectiveProviderHealth,
} from "@/services/playback/provider-health-policy";
import type { ProviderHealth, ProviderId } from "@kunai/types";

import type { ShellStatusTone } from "./types";

/**
 * What the provider picker may say about one provider, and the evidence it is
 * allowed to say it from. Nothing here names a provider: a row reads broken
 * only because a store recorded a failure or its manifest declared a fault.
 */
export type ProviderPickerEvidence = {
  /** Global provider health after TTL healing; undefined when never recorded. */
  readonly health: EffectiveProviderHealth | undefined;
  /** Endpoints of this provider under an observed quarantine right now. */
  readonly quarantinedEndpoints?: number;
  /** Live failure streak on the title the picker was opened for. */
  readonly titleFailure?: {
    readonly consecutiveFailures: number;
    readonly errorClass?: string;
  } | null;
  /** Manifest-declared upstream fault (`CoreProviderManifest.knownIssue`). */
  readonly knownIssue?: { readonly since: string; readonly summary: string };
  readonly isCurrentProvider: boolean;
};

export type ProviderPickerStatus = {
  /** success: healthy · warning: failing · error: down or a known issue · neutral: unchecked. */
  readonly tone: ShellStatusTone;
  /** Trailing row state. Survives truncation, so it carries the verdict in words. */
  readonly badge: string;
  /** One- or two-word form for terminals too narrow for the full badge. */
  readonly compactBadge: string;
  /** Why, when the verdict alone does not say it. Leads the row detail. */
  readonly reason?: string;
  /** The whole story in one line, for the footer of the highlighted row. */
  readonly explanation: string;
};

type Clause = string | null | undefined;

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function join(parts: readonly Clause[]): string {
  return parts.filter(Boolean).join(" · ");
}

function state(
  tone: ShellStatusTone,
  badge: string,
  compactBadge: string,
  explanation: readonly Clause[],
  reason?: Clause,
): ProviderPickerStatus {
  return { tone, badge, compactBadge, reason: reason ?? undefined, explanation: join(explanation) };
}

export function resolveProviderPickerStatus(
  evidence: ProviderPickerEvidence,
  now: Date = new Date(),
): ProviderPickerStatus {
  const { health, knownIssue, titleFailure, isCurrentProvider } = evidence;
  const status = health?.effectiveStatus;
  const failures = health?.consecutiveFailures ?? 0;
  const streak = failures > 0 ? plural(failures, "failure") : null;
  const age = formatProviderHealthAge(health?.checkedAt, now);
  const quarantined = evidence.quarantinedEndpoints
    ? `${plural(evidence.quarantinedEndpoints, "endpoint")} quarantined`
    : null;
  const claim = knownIssue ? `known issue since ${knownIssue.since}: ${knownIssue.summary}` : null;
  const onTitle = titleFailure
    ? `${plural(titleFailure.consecutiveFailures, "failure")} on this title`
    : null;
  const stillSelectable = isCurrentProvider ? "in use now" : "Enter still tries it";

  if (status === "down") {
    // "Skipped" is false for the provider that is playing: it is running.
    const skipped = isCurrentProvider ? null : "skipped in auto-fallback";
    return state(
      "error",
      join(["down", streak, age]),
      "down",
      [
        `down · ${streak ? `${streak}, ` : ""}last ${age}`,
        skipped,
        quarantined,
        claim,
        stillSelectable,
      ],
      skipped,
    );
  }

  // TTL healing lifts a failure out of fallback's way; it is not a success.
  if (health && !health.healedByTtl && status !== "unknown") {
    const degraded = status === "degraded";
    if (degraded || streak) {
      return state(
        "warning",
        join([degraded ? "degraded" : null, streak, age]),
        degraded ? "degraded" : "failing",
        [
          degraded
            ? `degraded · ${streak ?? "most recent resolves failed"}, last ${age}`
            : `last resolve failed ${age}`,
          "still used in auto-fallback",
          quarantined,
          claim,
        ],
        quarantined,
      );
    }
    if (titleFailure) {
      const errorClass = titleFailure.errorClass;
      return state(
        "warning",
        "failing on this title",
        "failing",
        [
          `${onTitle}${errorClass ? ` (${errorClass})` : ""}`,
          `healthy elsewhere, last resolve ${age}`,
          quarantined,
        ],
        errorClass ? `${errorClass} on this title` : "failed on this title",
      );
    }
    return state(
      "success",
      `healthy · ${age}`,
      "healthy",
      ["healthy", `last resolve succeeded ${age}`, quarantined],
      quarantined,
    );
  }

  // From here on there is no local evidence that the provider works. A corrupt
  // timestamp is not evidence of a failure at any particular time either.
  const agedOut =
    health?.healedByTtl && age !== "unknown age" ? `last attempt failed ${age}` : null;

  if (knownIssue) {
    return state(
      "error",
      `known issue · ${knownIssue.since}`,
      "known issue",
      [claim, onTitle ?? agedOut ?? "not checked on this device", quarantined, stillSelectable],
      knownIssue.summary,
    );
  }
  if (onTitle || quarantined) {
    return state(
      "warning",
      onTitle ? "failing on this title" : (quarantined ?? ""),
      onTitle ? "failing" : "quarantined",
      [onTitle, quarantined, agedOut ?? "no successful resolve recorded"],
      onTitle ? quarantined : null,
    );
  }
  return state(
    "neutral",
    agedOut ? `not rechecked · failed ${age}` : "not checked yet",
    "not checked",
    agedOut
      ? [agedOut, "that failure has aged out, so it will be tried again"]
      : ["not checked yet", "no resolve recorded on this device"],
  );
}

/** The stores a picker row is read from; each is optional so a caller without one says less. */
export type ProviderPickerSources = {
  readonly getProviderHealth?: (providerId: ProviderId) => ProviderHealth | undefined;
  readonly getQuarantinedEndpoints?: (providerId: ProviderId) => number;
  readonly getTitleFailure?: (providerId: ProviderId) => ProviderPickerEvidence["titleFailure"];
};

export function providerPickerStatusFor(
  provider: Pick<ProviderMetadata, "id" | "knownIssue">,
  isCurrentProvider: boolean,
  sources: ProviderPickerSources,
  now?: Date,
): ProviderPickerStatus {
  return resolveProviderPickerStatus(
    {
      health: resolveEffectiveProviderHealth(sources.getProviderHealth?.(provider.id), now),
      quarantinedEndpoints: sources.getQuarantinedEndpoints?.(provider.id),
      titleFailure: sources.getTitleFailure?.(provider.id),
      knownIssue: provider.knownIssue,
      isCurrentProvider,
    },
    now,
  );
}
