import { applyTitleProviderPreferenceToSession } from "@/app/playback/playback-provider-switch";
import type { Container } from "@/container";
import { providerLaneToShellMode, resolveProviderLaneFromMetadata } from "@/domain/provider-lane";
import type { QueuePlaybackIntent } from "@/domain/queue/queue-playback-intent";
import type { ShellMode, TitleInfo } from "@/domain/types";
import { resolveProviderIdAlias } from "@kunai/core";

type LaneContainer = Pick<Container, "config" | "providerRegistry" | "stateManager">;

/**
 * Put the session in the lane a launch belongs to, before the title is handed
 * to playback. Playback reads mode and provider from the session, so a title
 * launched from the "wrong" lane — an anime Up Next row opened in series mode,
 * a YouTube share link opened in a series session — ran on the previous lane's
 * provider chain (Sol review #4, #5). Every launch that knows its lane goes
 * through here: queue rows from browse, the overlay and post-play, share links,
 * `/watch`, and inbox play-now.
 *
 * The provider is, in order: the title's saved preference for that lane, a
 * hinted provider when it serves that lane, the current provider when the
 * session is already in it, else the lane's default.
 */
export function alignSessionLane(
  container: LaneContainer,
  input: {
    readonly mode: ShellMode;
    readonly preferredProviderId?: string;
    readonly title?: Pick<TitleInfo, "id" | "type" | "externalIds" | "isAnime">;
  },
): void {
  const { stateManager } = container;
  const state = stateManager.getState();
  const hinted = input.preferredProviderId
    ? container.providerRegistry.get(resolveProviderIdAlias(input.preferredProviderId.trim()))
    : undefined;
  const hintedId =
    hinted &&
    providerLaneToShellMode(resolveProviderLaneFromMetadata(hinted.metadata)) === input.mode
      ? hinted.metadata.id
      : undefined;
  const provider =
    hintedId ?? (state.mode === input.mode ? state.provider : state.defaultProviders[input.mode]);

  if (state.mode !== input.mode) {
    stateManager.dispatch({ type: "SET_MODE", mode: input.mode, provider });
  } else if (state.provider !== provider) {
    stateManager.dispatch({ type: "SET_PROVIDER", provider });
  }
  if (input.title) {
    applyTitleProviderPreferenceToSession(container, input.title.id, input.title, input.mode);
  }
}

/** The lane a queued row plays in: its stored kind, never the session's current mode. */
export function shellModeForQueueIntent(intent: Pick<QueuePlaybackIntent, "mediaKind">): ShellMode {
  if (intent.mediaKind === "anime") return "anime";
  if (intent.mediaKind === "video") return "youtube";
  return "series";
}
