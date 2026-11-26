import { alignSessionLane } from "@/app/playback/launch-lane";
import type { Container } from "@/container";
import {
  episodeInfoFromMediaItemIdentity,
  titleInfoFromMediaItemIdentity,
} from "@/domain/media/media-item-adapters";
import type { MediaItemIdentity } from "@/domain/media/media-item-identity";
import type { ShellMode } from "@/domain/types";

export function applyMediaItemSessionRouting(
  container: Pick<Container, "config" | "providerRegistry" | "stateManager">,
  item: MediaItemIdentity,
): void {
  // The item's own lane, in every direction: a series notice opened from anime
  // mode used to stay on the anime provider chain. A hinted provider is kept
  // only when it serves that lane; a saved title preference wins over both.
  alignSessionLane(container, {
    mode: mediaItemShellMode(item),
    preferredProviderId: item.providerHints?.[0]?.providerId,
    title: titleInfoFromMediaItemIdentity(item),
  });
}

function mediaItemShellMode(item: MediaItemIdentity): ShellMode {
  if (item.mediaKind === "video") return "youtube";
  if (item.mediaKind === "anime") return "anime";
  return "series";
}

export function playbackIntentFromMediaItem(item: MediaItemIdentity) {
  return {
    // "notification" marks the launch as an explicit episode pick — the entry
    // policy auto-plays it instead of deferring to the starting-point menu.
    title: { ...titleInfoFromMediaItemIdentity(item), launchSource: "notification" as const },
    episode: episodeInfoFromMediaItemIdentity(item),
  };
}
