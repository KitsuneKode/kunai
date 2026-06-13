import { applyTitleProviderPreferenceToSession } from "@/app/playback-provider-switch";
import type { Container } from "@/container";
import {
  episodeInfoFromMediaItemIdentity,
  titleInfoFromMediaItemIdentity,
} from "@/domain/media/media-item-adapters";
import type { MediaItemIdentity } from "@/domain/media/media-item-identity";

export function applyMediaItemSessionRouting(
  container: Pick<Container, "config" | "providerRegistry" | "stateManager">,
  item: MediaItemIdentity,
): void {
  const appliedPreference = applyTitleProviderPreferenceToSession(container, item.titleId);
  if (appliedPreference) return;

  const hintedProviderId = item.providerHints?.[0]?.providerId;
  if (hintedProviderId) {
    const provider = container.providerRegistry.get(hintedProviderId);
    if (provider) {
      container.stateManager.dispatch({
        type: "SET_MODE",
        mode: provider.metadata.isAnimeProvider ? "anime" : "series",
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

  if (item.mediaKind === "anime") {
    container.stateManager.dispatch({
      type: "SET_MODE",
      mode: "anime",
      provider: container.config.animeProvider,
    });
  }
}

export function playbackIntentFromMediaItem(item: MediaItemIdentity) {
  return {
    title: titleInfoFromMediaItemIdentity(item),
    episode: episodeInfoFromMediaItemIdentity(item),
  };
}
