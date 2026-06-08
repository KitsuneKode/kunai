import type { ProviderMetadata } from "@/domain/types";

import type { TrackCapability, TrackCapabilityGroup } from "./track-capabilities";

export type ProviderHealthHint = {
  readonly errorClass?: string;
  readonly consecutiveFailures?: number;
  readonly suggestedProviderId?: string;
};

export type BuildProviderTrackCapabilitiesInput = {
  readonly providers: readonly ProviderMetadata[];
  readonly mode: "anime" | "series";
  readonly currentProviderId: string;
  readonly healthByProviderId?: Readonly<Record<string, ProviderHealthHint>>;
};

function formatProviderLabel(provider: ProviderMetadata): string {
  if (provider.status === "candidate") {
    return `${provider.name}  ·  candidate`;
  }
  return provider.name;
}

function healthDetail(providerId: string, health?: ProviderHealthHint): string | undefined {
  if (!health) return undefined;
  const parts: string[] = [];
  if (health.errorClass) {
    parts.push(`last failure: ${health.errorClass}`);
  }
  if (health.consecutiveFailures && health.consecutiveFailures > 0) {
    parts.push(`${health.consecutiveFailures} recent failures`);
  }
  if (health.suggestedProviderId && health.suggestedProviderId !== providerId) {
    parts.push(`try ${health.suggestedProviderId} instead`);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * Build the Provider section for the unified Tracks panel. Provider switching is
 * intentionally separate from source/quality/audio inventory rows.
 */
export function buildProviderTrackCapabilities(
  input: BuildProviderTrackCapabilitiesInput,
): TrackCapabilityGroup {
  const rows: TrackCapability[] = input.providers
    .filter((provider) =>
      input.mode === "anime" ? provider.isAnimeProvider : !provider.isAnimeProvider,
    )
    .map((provider) => {
      const selected = provider.id === input.currentProviderId;
      const health = input.healthByProviderId?.[provider.id];
      return {
        section: "provider",
        label: formatProviderLabel(provider),
        value: provider.id,
        selected,
        enabled: !selected,
        detail:
          [provider.description, healthDetail(provider.id, health)].filter(Boolean).join(" · ") ||
          undefined,
        risk: health?.errorClass ? "failed" : "normal",
        reason: selected ? "Current provider" : undefined,
      };
    });

  return {
    section: "provider",
    title: "Provider",
    rows,
    selectable: rows.some((row) => row.enabled),
    emptyReason: rows.length === 0 ? "No compatible providers for this mode" : undefined,
  };
}
