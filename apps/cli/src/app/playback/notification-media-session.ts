import { applyTitleProviderPreferenceToSession } from "@/app/playback/playback-provider-switch";
import type { Container } from "@/container";
import {
  episodeInfoFromMediaItemIdentity,
  titleInfoFromMediaItemIdentity,
} from "@/domain/media/media-item-adapters";
import type { MediaItemIdentity } from "@/domain/media/media-item-identity";
import { providerLaneToShellMode, resolveProviderLaneFromMetadata } from "@/domain/provider-lane";
import type { ShellMode } from "@/domain/types";

export function applyMediaItemSessionRouting(
  container: Pick<Container, "config" | "providerRegistry" | "stateManager">,
  item: MediaItemIdentity,
): void {
  const mode = mediaItemShellMode(item);
  const appliedPreference = applyTitleProviderPreferenceToSession(
    container,
    item.titleId,
    titleInfoFromMediaItemIdentity(item),
    mode,
  );
  if (appliedPreference) return;

  const hintedProviderId = item.providerHints?.[0]?.providerId;
  if (hintedProviderId) {
    const provider = container.providerRegistry.get(hintedProviderId);
    if (provider) {
      container.stateManager.dispatch({
        type: "SET_MODE",
        mode: providerLaneToShellMode(resolveProviderLaneFromMetadata(provider.metadata)),
        provider: provider.metadata.id,
      });
      return;
    }
    container.stateManager.dispatch({
      type: "SET_PROVIDER",
      provider: hintedProviderId,
    });
    return;
  }

  if (mode === "anime" || mode === "youtube") {
    container.stateManager.dispatch({
      type: "SET_MODE",
      mode,
      provider:
        mode === "youtube"
          ? container.stateManager.getState().defaultProviders.youtube
          : container.config.animeProvider,
    });
  }
}

function mediaItemShellMode(item: MediaItemIdentity): ShellMode {
  if (item.mediaKind === "video") return "youtube";
  if (item.mediaKind === "anime") return "anime";
  return "series";
}

export function playbackIntentFromMediaItem(item: MediaItemIdentity) {
  return {
    title: titleInfoFromMediaItemIdentity(item),
    episode: episodeInfoFromMediaItemIdentity(item),
  };
}
