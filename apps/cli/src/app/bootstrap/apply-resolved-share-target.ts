import { resolveShareTarget, type ResolvedShareTarget } from "@/app/bootstrap/resolve-share-target";
import { setShareBootstrapStartSeconds } from "@/app/bootstrap/share-bootstrap-start";
import { alignSessionLane } from "@/app/playback/launch-lane";
import type { Container } from "@/container";
import type { KunaiShareAction, PlaybackTargetRef } from "@/domain/share/playback-target-ref";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";

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
  alignSessionToShareTarget(container, resolved, ref);
}

/**
 * The lane a share link plays in — every lane, not only anime. A YouTube or
 * TMDB link opened in another lane used to keep the recipient's previous mode
 * and provider. Shared by `--open`, protocol handoff and `/watch`.
 */
export function alignSessionToShareTarget(
  container: Container,
  resolved: ResolvedShareTarget,
  ref: PlaybackTargetRef,
): void {
  const hintedProviderId = ref.hint?.providerId?.trim();
  alignSessionLane(container, {
    mode: resolved.mode,
    preferredProviderId:
      hintedProviderId && !resolved.note?.includes("isn't available")
        ? hintedProviderId
        : undefined,
    title: resolved.title ?? undefined,
  });
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
