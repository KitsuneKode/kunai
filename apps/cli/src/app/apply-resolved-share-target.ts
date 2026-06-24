import { resolveShareTarget, type ResolvedShareTarget } from "@/app/resolve-share-target";
import { setShareBootstrapStartSeconds } from "@/app/share-bootstrap-start";
import type { Container } from "@/container";
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
  if (resolved.mode === "anime") {
    container.stateManager.dispatch({
      type: "SET_MODE",
      mode: "anime",
      provider: container.config.animeProvider,
    });
  }
  const hintedProviderId = ref.hint?.providerId?.trim();
  if (hintedProviderId && !resolved.note?.includes("isn't available")) {
    const normalized = resolveProviderIdAlias(hintedProviderId);
    const provider = container.providerRegistry.get(normalized);
    if (provider) {
      if (resolved.mode === "anime" && provider.metadata.isAnimeProvider) {
        container.stateManager.dispatch({ type: "SET_MODE", mode: "anime", provider: normalized });
      } else if (resolved.mode !== "anime" && !provider.metadata.isAnimeProvider) {
        container.stateManager.dispatch({ type: "SET_PROVIDER", provider: normalized });
      }
    }
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
