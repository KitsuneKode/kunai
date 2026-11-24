import { resolveShareTarget, type ResolvedShareTarget } from "@/app/bootstrap/resolve-share-target";
import { setShareBootstrapStartSeconds } from "@/app/bootstrap/share-bootstrap-start";
import type { Container } from "@/container";
import { providerMetadataMatchesLane, shellModeToProviderLane } from "@/domain/provider-lane";
import { sessionTargetForMode } from "@/domain/session/mode-target";
import type { KunaiShareAction, PlaybackTargetRef } from "@/domain/share/playback-target-ref";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";
import { resolveProviderIdAlias } from "@kunai/core";

export type ShareBootstrapLaunch = {
  readonly query?: string;
  readonly title?: TitleInfo | null;
  readonly episode?: EpisodeInfo | null;
  readonly autoPickSearchResultIndex?: number;
  readonly download?: boolean;
};

export async function applyShareRefLaunch(
  container: Container,
  input: { readonly action: KunaiShareAction; readonly ref: PlaybackTargetRef },
): Promise<ShareBootstrapLaunch> {
  const resolved = await resolveShareTarget(input.ref, container, { action: input.action });
  applyResolvedShareSideEffects(container, resolved, input.ref);
  return resolvedShareToBootstrap(resolved);
}

export function applyResolvedShareSideEffects(
  container: Container,
  resolved: ResolvedShareTarget,
  ref: PlaybackTargetRef,
): void {
  if (resolved.note) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: resolved.note,
    });
  }
  if (resolved.startSeconds !== undefined) {
    setShareBootstrapStartSeconds(resolved.startSeconds);
  }
  applyShareLaneAndProviderHint(container, resolved, ref);
}

/**
 * Put the session in the share's lane, then honour a provider hint that belongs
 * to that lane.
 *
 * Every lane switches, not only anime: a TMDB movie link opened while the
 * session is in anime mode would otherwise resolve through anime providers and
 * fail before the first frame. Already in the right lane, the session keeps the
 * provider it has. Shared by launch-time links and `/watch`, which must not
 * also prime the start mailbox (its caller carries `startSeconds` itself).
 */
export function applyShareLaneAndProviderHint(
  container: Pick<Container, "stateManager" | "providerRegistry">,
  resolved: Pick<ResolvedShareTarget, "mode" | "note">,
  ref: Pick<PlaybackTargetRef, "hint">,
): void {
  const state = container.stateManager.getState();
  if (state.mode !== resolved.mode) {
    container.stateManager.dispatch({
      type: "SET_MODE",
      ...sessionTargetForMode(state, resolved.mode),
    });
  }
  const hintedProviderId = ref.hint?.providerId?.trim();
  if (!hintedProviderId || resolved.note?.includes("isn't available")) return;
  const normalized = resolveProviderIdAlias(hintedProviderId);
  const provider = container.providerRegistry.get(normalized);
  if (
    provider &&
    providerMetadataMatchesLane(provider.metadata, shellModeToProviderLane(resolved.mode))
  ) {
    container.stateManager.dispatch({ type: "SET_PROVIDER", provider: normalized });
  }
}

function resolvedShareToBootstrap(resolved: ResolvedShareTarget): ShareBootstrapLaunch {
  if (resolved.searchQuery) {
    return {
      query: resolved.searchQuery,
      autoPickSearchResultIndex: resolved.autoPickIndex,
      ...(resolved.download ? { download: true } : {}),
    };
  }
  return {
    title: resolved.title,
    episode: resolved.episode ?? null,
    ...(resolved.download ? { download: true } : {}),
  };
}
