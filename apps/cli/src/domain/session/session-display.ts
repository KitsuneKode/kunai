import { isYoutubeShellMode } from "@/domain/media/content-kind";
import { providerMetadataMatchesLane, shellModeToProviderLane } from "@/domain/provider-lane";
import type { ShellMode } from "@/domain/types";

import type { SessionState } from "./SessionState";

type SessionProviderLaneMetadata = {
  readonly id: string;
  readonly isAnimeProvider: boolean;
  readonly isYoutubeProvider: boolean;
};

export type SessionProviderLaneLookup = {
  readonly get: (
    providerId: string,
  ) => { readonly metadata: SessionProviderLaneMetadata } | undefined;
  readonly getDefaultForMode: (mode: ShellMode) => {
    readonly metadata: SessionProviderLaneMetadata;
  };
};

/** User-facing lane label in header crumbs (YouTube mode is not "video"). */
export function formatSessionLaneLabel(mode: ShellMode): string {
  if (isYoutubeShellMode(mode)) return "YouTube";
  if (mode === "anime") return "anime";
  return "series";
}

/** User-facing provider label — YouTube lane always reads "YouTube". */
export function formatSessionProviderLabel(
  mode: ShellMode,
  providerId: string,
  providerName?: string | null,
): string {
  if (isYoutubeShellMode(mode)) return "YouTube";
  return providerName?.trim() || providerId;
}

/** Header destination pill while the browse shell is mounted (fallback). */
export function describeBrowseHeaderDestination(
  state: Pick<SessionState, "searchQuery" | "searchResults">,
): string {
  // Prefer the live browse-destination store when BrowseShell is mounted;
  // this helper remains for session-only callers / tests.
  const first = state.searchResults[0] as { readonly calendar?: unknown } | undefined;
  if (first?.calendar) return "Schedule";
  if (state.searchQuery.trim().length > 0) return "Search";
  if (state.searchResults.length > 0) return "Trending";
  return "Browse";
}

export function resolveProviderIdForSessionLane(
  state: Pick<SessionState, "mode" | "provider" | "defaultProviders">,
  providerRegistry: SessionProviderLaneLookup,
): string {
  const lane = shellModeToProviderLane(state.mode);
  const current = providerRegistry.get(state.provider);
  if (current && providerMetadataMatchesLane(current.metadata, lane)) {
    return state.provider;
  }
  return providerRegistry.getDefaultForMode(state.mode).metadata.id;
}

export function sessionProviderMatchesLane(
  state: Pick<SessionState, "mode" | "provider">,
  providerRegistry: Pick<SessionProviderLaneLookup, "get">,
): boolean {
  const lane = shellModeToProviderLane(state.mode);
  const current = providerRegistry.get(state.provider);
  return Boolean(current && providerMetadataMatchesLane(current.metadata, lane));
}

export function ensureSessionProviderMatchesLane(
  stateManager: Pick<import("./SessionStateManager").SessionStateManager, "getState" | "dispatch">,
  providerRegistry: SessionProviderLaneLookup,
): string {
  const state = stateManager.getState();
  const providerId = resolveProviderIdForSessionLane(state, providerRegistry);
  if (providerId !== state.provider) {
    stateManager.dispatch({ type: "SET_PROVIDER", provider: providerId });
  }
  return providerId;
}
