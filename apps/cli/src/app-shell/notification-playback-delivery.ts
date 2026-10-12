import type { Container } from "@/container";
import { isPlaybackSessionActive } from "@/domain/session/SessionState";
import type { EpisodeInfo, SearchResult, TitleInfo } from "@/domain/types";

import { forceCloseRootContent, getRootContentSession } from "./root-content-state";
import type { BrowseShellResult, PlaybackShellResult } from "./types";

export type NotificationPlaybackDelivery =
  | "browse-launch"
  | "post-play-launch"
  | "title-switch"
  | "undeliverable";

/**
 * Direct-route counterpart of the notifications outcome bridge.
 *
 * When nobody awaits `waitForNotificationSelection()` (the inbox was opened by
 * a bare `OPEN_OVERLAY` dispatch), the row's "Play now" outcome has to be
 * delivered from inside the overlay — the equivalent of the awaited route's
 * `history-entry` result, spoken in whatever channel the current root content
 * understands:
 *
 * - A retained **browse** session settles with `launch-playback`, the channel
 *   offline playback already uses.
 * - A mounted **post-play** session settles with the same object; the menu
 *   translates it into a `history_entry` phase outcome.
 * - With playback **live or resolving**, a `switch-title` intent replaces the
 *   title in place: cancel the in-flight resolve and arm the abort tail, or
 *   stop the current file so the phase loop exits with the new title.
 * - Nothing to deliver to is an honest failure, not a silent drop.
 */
export async function deliverNotificationPlayback(
  container: Pick<
    Container,
    "playerControl" | "workControl" | "stateManager" | "diagnosticsService"
  >,
  intent: { readonly title: TitleInfo; readonly episode?: EpisodeInfo },
): Promise<NotificationPlaybackDelivery> {
  const session = getRootContentSession();
  if (session?.kind === "browse" || session?.kind === "post-playback") {
    const launch: BrowseShellResult<SearchResult> | PlaybackShellResult = {
      type: "launch-playback",
      launch: {
        title: intent.title,
        ...(intent.episode ? { episode: intent.episode } : {}),
      },
    };
    if (forceCloseRootContent(launch)) {
      return session.kind === "browse" ? "browse-launch" : "post-play-launch";
    }
  }

  if (!isPlaybackSessionActive(container.stateManager.getState().playbackStatus)) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: `Could not play ${intent.title.name} — nothing is browsing or playing right now.`,
    });
    container.diagnosticsService.record({
      category: "playback",
      message: "Notification play-now had no delivery target",
      context: { titleId: intent.title.id },
    });
    return "undeliverable";
  }

  const selection = {
    title: intent.title,
    ...(intent.episode ? { episode: intent.episode } : {}),
  };
  // A resolve in flight owns no player to stop — abort it and arm the intent
  // for the aborted-resolve tail. Otherwise stop the file; the file-stop
  // decision consumes the armed selection and exits to the new title.
  if (container.workControl.cancelActive("notifications-play-now")) {
    container.playerControl.signalTitleSwitch(selection);
    return "title-switch";
  }
  const delivered = await container.playerControl.switchToTitlePlayback(
    selection,
    "notifications-play-now",
  );
  if (!delivered) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: `Could not switch to ${intent.title.name} — the active player is already gone.`,
    });
    return "undeliverable";
  }
  return "title-switch";
}
