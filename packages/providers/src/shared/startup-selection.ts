import type { ProviderSelectionDecision, StartupPriority, StreamCandidate } from "@kunai/types";

export const BALANCED_QUALITY_WAIT_BUDGET_MS = 1_000;
export const QUALITY_FIRST_WAIT_BUDGET_MS = 4_000;

// Local copy (providers package is standalone — avoid an app-layer import). Mirrors
// apps/cli/src/domain/playback/source-name.ts.
function normalizeSourceName(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeQualityPreferenceToken(value: string | undefined): string | undefined {
  const token = value?.trim().toLowerCase();
  if (!token || token === "auto" || token === "best" || token === "max") return undefined;
  return token.replace(/\s+/g, "");
}

function streamMatchesQualityPreference(stream: StreamCandidate, preference: string): boolean {
  const label = stream.qualityLabel?.toLowerCase() ?? "";
  const rank = stream.qualityRank;
  if (label.includes(preference)) return true;
  if (preference.endsWith("p") && label.includes(preference.slice(0, -1))) return true;
  const prefRank = Number.parseInt(preference.replace(/p$/i, ""), 10);
  if (Number.isFinite(prefRank) && rank === prefRank) return true;
  if (String(rank ?? "").includes(preference.replace(/p$/i, ""))) return true;
  return false;
}

export function selectReadyStream(
  streams: readonly StreamCandidate[],
  input: {
    readonly startupPriority?: StartupPriority;
    readonly qualityPreference?: string;
    readonly preferredStreamId?: string;
    readonly preferredSourceId?: string;
    readonly favoriteSourceNames?: readonly string[];
    readonly requiredFallback?: boolean;
    /**
     * Prefer provider-ranked ready order (streams[0]) over pure max quality.
     * Used by Miruro so active CDN hosts win over brittle direct rows.
     * Ignored when the user pinned stream/source/quality or uses quality-first.
     */
    readonly preferProviderReadyOrder?: boolean;
  },
): { readonly selected: StreamCandidate; readonly decision: ProviderSelectionDecision } {
  const startupPriority = input.startupPriority ?? "balanced";
  const explicit = streams.find((stream) =>
    input.preferredStreamId
      ? stream.id === input.preferredStreamId
      : input.preferredSourceId
        ? stream.sourceId === input.preferredSourceId
        : false,
  );
  const favoritePriority = new Map(
    (input.favoriteSourceNames ?? []).map((sourceName, index) => [sourceName, index]),
  );
  const favorite =
    favoritePriority.size > 0
      ? [...streams]
          .filter((stream) =>
            favoritePriority.has(
              normalizeSourceName(stream.serverName ?? stream.flavorLabel ?? stream.sourceId ?? ""),
            ),
          )
          .sort((left, right) => {
            const leftPriority =
              favoritePriority.get(
                normalizeSourceName(left.serverName ?? left.flavorLabel ?? left.sourceId ?? ""),
              ) ?? Number.MAX_SAFE_INTEGER;
            const rightPriority =
              favoritePriority.get(
                normalizeSourceName(right.serverName ?? right.flavorLabel ?? right.sourceId ?? ""),
              ) ?? Number.MAX_SAFE_INTEGER;
            if (leftPriority !== rightPriority) return leftPriority - rightPriority;
            return (right.qualityRank ?? 0) - (left.qualityRank ?? 0);
          })[0]
      : undefined;
  const normalizedQualityPreference = normalizeQualityPreferenceToken(input.qualityPreference);
  const ordered = [...streams].sort(
    (left, right) => (right.qualityRank ?? 0) - (left.qualityRank ?? 0),
  );
  // Prefer the *best* matching quality (not the first includes hit), so "1080"
  // still wins when labels are "1080p" / "1080P" / "ORG 1080".
  const preferredQuality =
    normalizedQualityPreference && normalizedQualityPreference !== "best"
      ? ordered.find((stream) =>
          streamMatchesQualityPreference(stream, normalizedQualityPreference),
        )
      : undefined;
  const useProviderReadyOrder =
    input.preferProviderReadyOrder === true &&
    startupPriority !== "quality-first" &&
    !normalizedQualityPreference;
  const selected =
    explicit ??
    favorite ??
    preferredQuality ??
    // "fast" and provider-ready order keep streams[0] ranking.
    // balanced/quality-first pick max rank unless preferProviderReadyOrder is set.
    (startupPriority === "fast" || useProviderReadyOrder ? streams[0] : ordered[0]);

  if (!selected) throw new Error("No ready stream candidates");

  const reason = explicit
    ? "explicit-source"
    : favorite
      ? "favorite-source"
      : input.requiredFallback
        ? "ak-required"
        : startupPriority === "fast"
          ? "fast-start"
          : startupPriority === "quality-first"
            ? "quality-first"
            : (selected.qualityRank ?? 0) >= 1080
              ? "balanced-1080"
              : "balanced-ready";

  return {
    selected,
    decision: {
      startupPriority,
      reason,
      waitBudgetMs:
        startupPriority === "quality-first"
          ? QUALITY_FIRST_WAIT_BUDGET_MS
          : startupPriority === "balanced"
            ? BALANCED_QUALITY_WAIT_BUDGET_MS
            : 0,
      selectedQualityRank: selected.qualityRank,
      enrichmentLane: startupPriority === "quality-first" ? "optional-foreground" : "required",
    },
  };
}
