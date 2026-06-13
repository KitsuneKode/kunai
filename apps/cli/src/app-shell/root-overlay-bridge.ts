import type { Container } from "@/container";
import type { MediaItemIdentity } from "@/domain/media/media-item-identity";
import type { OverlayState } from "@/domain/session/SessionState";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";

export type RootOwnedOverlay = Extract<
  OverlayState,
  {
    type:
      | "help"
      | "about"
      | "diagnostics"
      | "downloads"
      | "notifications"
      | "provider_picker"
      | "history"
      | "settings";
  }
>;

export type NotificationPlaybackIntent = {
  readonly title: TitleInfo;
  readonly episode?: EpisodeInfo;
};

let pendingPlaybackIntent: NotificationPlaybackIntent | null = null;
let pendingDetailsItem: MediaItemIdentity | null = null;
const detailsListeners = new Set<() => void>();

export function subscribeNotificationDetails(listener: () => void): () => void {
  detailsListeners.add(listener);
  return () => {
    detailsListeners.delete(listener);
  };
}

export function getNotificationDetailsPending(): boolean {
  return pendingDetailsItem !== null;
}

export function stageNotificationPlaybackIntent(intent: NotificationPlaybackIntent): void {
  pendingPlaybackIntent = intent;
}

export function takeNotificationPlaybackIntent(): NotificationPlaybackIntent | null {
  const intent = pendingPlaybackIntent;
  pendingPlaybackIntent = null;
  return intent;
}

export function stageNotificationDetailsItem(item: MediaItemIdentity): void {
  pendingDetailsItem = item;
  for (const listener of detailsListeners) {
    listener();
  }
}

export function takeNotificationDetailsItem(): MediaItemIdentity | null {
  const item = pendingDetailsItem;
  pendingDetailsItem = null;
  return item;
}

export async function openRootOwnedOverlay(
  container: Container,
  overlay: RootOwnedOverlay,
): Promise<void> {
  const { stateManager } = container;

  stateManager.dispatch({
    type: stateManager.getState().activeModals.length > 0 ? "REPLACE_TOP_OVERLAY" : "OPEN_OVERLAY",
    overlay,
  });
  await new Promise<void>((resolve) => {
    const unsubscribe = stateManager.subscribe((state) => {
      const top = state.activeModals.at(-1);
      if (!top || top.type !== overlay.type) {
        unsubscribe();
        resolve();
      }
    });
  });
}

export async function openNotificationsOverlay(container: Container): Promise<{
  readonly playback: NotificationPlaybackIntent | null;
}> {
  await openRootOwnedOverlay(container, { type: "notifications" });
  return {
    playback: takeNotificationPlaybackIntent(),
  };
}
