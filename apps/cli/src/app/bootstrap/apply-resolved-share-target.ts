import { resolveShareTarget, type ResolvedShareTarget } from "@/app/bootstrap/resolve-share-target";
import { setShareBootstrapStartSeconds } from "@/app/bootstrap/share-bootstrap-start";
import type { Container } from "@/container";
import type { KunaiShareAction, PlaybackTargetRef } from "@/domain/share/playback-target-ref";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";
import { resolveProviderIdAlias } from "@kunai/core";

export type ShareBootstrapLaunch = {
  readonly query?: string;
  /** A search link's episode, armed like `-e` once the search picks its title. */
  readonly requestedEpisode?: { readonly season: number; readonly episode: number };
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
      ...(resolved.episode
        ? {
            requestedEpisode: {
              season: resolved.episode.season,
              episode: resolved.episode.episode,
            },
          }
        : null),
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

/**
 * Feedback for `/watch`. A search link opens the query mid-session and leaves
 * the pick to the viewer, so the episode and time it names are said, not
 * silently dropped; `--open` arms them instead (see `requestedEpisode`).
 */
export function noteShareTarget(
  container: Pick<Container, "stateManager">,
  resolved: ResolvedShareTarget,
): void {
  const named = resolved.searchQuery ? shareCoordinates(resolved) : undefined;
  const pick = named ? `This link names ${named}: choose the title, then that episode.` : undefined;
  const note = [resolved.note, pick].filter(Boolean).join(" ");
  if (note) container.stateManager.dispatch({ type: "SET_PLAYBACK_FEEDBACK", note });
}

function shareCoordinates(resolved: ResolvedShareTarget): string | undefined {
  const { episode, startSeconds } = resolved;
  const code = episode
    ? `S${String(episode.season).padStart(2, "0")}E${String(episode.episode).padStart(2, "0")}`
    : undefined;
  const at =
    startSeconds !== undefined
      ? `${Math.floor(startSeconds / 60)}:${String(Math.floor(startSeconds % 60)).padStart(2, "0")}`
      : undefined;
  if (code && at) return `${code} at ${at}`;
  return code ?? (at ? `a start time of ${at}` : undefined);
}
