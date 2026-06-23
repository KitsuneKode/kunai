import { chooseFromListShell } from "@/app-shell/pickers/choose-from-list-shell";
import type { Container } from "@/container";
import type { ProviderMetadata } from "@/domain/types";
import {
  formatProviderHealthBadge,
  resolveEffectiveProviderHealth,
} from "@/services/playback/provider-health-policy";
import type { ProviderId } from "@kunai/types";

export type ProviderHealthResetScope =
  | "current-provider"
  | "current-title"
  | "current-title-provider"
  | "anime-lane"
  | "series-lane"
  | "all"
  | false;

const RESET_SCOPE_LABELS: Record<Exclude<ProviderHealthResetScope, false>, string> = {
  "current-provider": "the active provider",
  "current-title": "this show",
  "current-title-provider": "this show on the active provider",
  "anime-lane": "all anime providers",
  "series-lane": "all series providers",
  all: "all providers and shows",
};

function describeResetResult(
  scope: Exclude<ProviderHealthResetScope, false>,
  clearedGlobal: number,
  clearedTitle: number,
): string {
  const target = RESET_SCOPE_LABELS[scope];
  if (clearedGlobal === 0 && clearedTitle === 0) {
    return `No failure memory found for ${target}. Playback can retry as-is, or use /recompute.`;
  }
  const parts: string[] = [];
  if (clearedGlobal > 0) {
    parts.push(
      clearedGlobal === 1
        ? "Cleared global provider failure memory"
        : `Cleared global failure memory for ${clearedGlobal} providers`,
    );
  }
  if (clearedTitle > 0) {
    parts.push("Cleared per-show provider memory");
  }
  return `${parts.join(". ")}. Retry playback or /recompute.`;
}

export async function chooseProviderHealthResetScope(
  container: Container,
): Promise<ProviderHealthResetScope> {
  const state = container.stateManager.getState();
  const title = state.currentTitle;
  const providerName =
    container.providerRegistry.get(state.provider)?.metadata.name ?? state.provider;
  const isAnime = state.mode === "anime";
  const laneOptions = isAnime
    ? [
        {
          value: "anime-lane" as const,
          label: "Reset all anime provider health",
          detail: "Global failure memory for every anime provider (current mode)",
        },
        {
          value: "series-lane" as const,
          label: "Reset all series provider health",
          detail: "Global failure memory for series and movie providers",
        },
      ]
    : [
        {
          value: "series-lane" as const,
          label: "Reset all series provider health",
          detail: "Global failure memory for every series/movie provider (current mode)",
        },
        {
          value: "anime-lane" as const,
          label: "Reset all anime provider health",
          detail: "Global failure memory for anime providers",
        },
      ];

  const choice = await chooseFromListShell<ProviderHealthResetScope>({
    title: "Reset provider health?",
    subtitle:
      "Forgets down/degraded status so auto-fallback can try those providers again. Does not clear cached stream URLs.",
    options: [
      {
        value: "current-provider" as const,
        label: `Forget failures for ${providerName}`,
        detail: "Global memory — removes down/degraded status for the active provider",
      },
      ...(title
        ? [
            {
              value: "current-title" as const,
              label: `Forget all provider memory for ${title.name}`,
              detail:
                "Per-show memory — clears failure suggestions for every provider on this title",
            },
            {
              value: "current-title-provider" as const,
              label: `Forget ${providerName} on ${title.name}`,
              detail: "Per-show memory — only this provider on the current title",
            },
          ]
        : []),
      ...laneOptions,
      {
        value: "all" as const,
        label: "Forget all provider failure memory",
        detail: "Global + per-show memory — use when multiple providers feel stuck",
      },
      { value: false, label: "Cancel" },
    ],
  });
  return choice ?? false;
}

export async function applyProviderHealthResetScope(
  container: Container,
  scope: Exclude<ProviderHealthResetScope, false>,
): Promise<{ readonly clearedGlobal: number; readonly clearedTitle: number }> {
  const state = container.stateManager.getState();
  const title = state.currentTitle;
  let clearedGlobal = 0;
  let clearedTitle = 0;

  const laneProviderIds = (isAnime: boolean): ProviderId[] =>
    container.providerRegistry
      .getAll()
      .filter((provider) => provider.metadata.isAnimeProvider === isAnime)
      .map((provider) => provider.metadata.id as ProviderId);

  switch (scope) {
    case "current-provider":
      clearedGlobal = container.providerHealth.delete(state.provider as ProviderId);
      break;
    case "current-title":
      if (title) {
        container.titleProviderHealth.clear(title.id);
        clearedTitle = 1;
      }
      break;
    case "current-title-provider":
      if (title) {
        container.titleProviderHealth.clear(title.id, state.provider);
        clearedTitle = 1;
      }
      break;
    case "anime-lane":
      clearedGlobal = container.providerHealth.deleteMany(laneProviderIds(true));
      break;
    case "series-lane":
      clearedGlobal = container.providerHealth.deleteMany(laneProviderIds(false));
      break;
    case "all":
      clearedGlobal = container.providerHealth.clearAll();
      container.titleProviderHealth.clearAll();
      clearedTitle = 1;
      break;
  }

  container.diagnosticsService.record({
    category: "provider",
    message: "Provider health memory reset",
    context: {
      scope,
      clearedGlobal,
      clearedTitle,
      titleId: title?.id ?? null,
      providerId: state.provider,
    },
  });

  container.stateManager.dispatch({
    type: "SET_PLAYBACK_FEEDBACK",
    note: describeResetResult(scope, clearedGlobal, clearedTitle),
  });

  return { clearedGlobal, clearedTitle };
}

export function buildEffectiveHealthByProviderId(
  providers: readonly ProviderMetadata[],
  getStoredHealth: (providerId: ProviderId) => import("@kunai/types").ProviderHealth | undefined,
  now: Date = new Date(),
): Map<string, ReturnType<typeof resolveEffectiveProviderHealth>> {
  const map = new Map<string, ReturnType<typeof resolveEffectiveProviderHealth>>();
  for (const provider of providers) {
    const effective = resolveEffectiveProviderHealth(
      getStoredHealth(provider.id as ProviderId),
      now,
    );
    if (effective) map.set(provider.id, effective);
  }
  return map;
}

export function formatProviderHealthPickerDetail(
  providerId: string,
  effectiveHealth: ReturnType<typeof resolveEffectiveProviderHealth> | undefined,
): string | undefined {
  void providerId;
  const badge = formatProviderHealthBadge(effectiveHealth ?? undefined);
  return badge ? `Health: ${badge}` : undefined;
}
