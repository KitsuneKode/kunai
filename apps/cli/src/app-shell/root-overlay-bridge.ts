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
      | "queue"
      | "settings";
  }
>;

/**
 * What Enter on an inbox row produced.
 *
 * `playback` carries the playable target the row advertised; `details` carries
 * the identity for the details/search fallback. The overlay resolves this
 * through `resolveNotificationSelection` so EVERY open path — the awaited
 * `openNotificationsOverlay()` call and a direct `OPEN_OVERLAY` dispatch —
 * produces exactly one consumed outcome. The staged module-global it replaces
 * was read by only the awaited route, so the other route silently dropped the
 * intent and a stale one could later fire against an unrelated session.
 */
export type NotificationOverlayOutcome =
  | {
      readonly kind: "playback";
      readonly title: TitleInfo;
      readonly episode?: EpisodeInfo;
    }
  | {
      readonly kind: "details";
      readonly item: MediaItemIdentity;
    };

type NotificationResolver = (value: NotificationOverlayOutcome | null) => void;

let pendingNotificationResolver: NotificationResolver | null = null;

/**
 * Register the inbox outcome awaiter. Call BEFORE dispatching OPEN_OVERLAY —
 * mirroring `waitForRootQueueSelection` — so a selection cannot arrive before
 * anyone is listening. A leaked earlier awaiter is released with null instead
 * of holding two opens hostage to one resolution.
 */
export function waitForNotificationSelection(): Promise<NotificationOverlayOutcome | null> {
  pendingNotificationResolver?.(null);
  return new Promise<NotificationOverlayOutcome | null>((resolve) => {
    pendingNotificationResolver = resolve;
  });
}

export function resolveNotificationSelection(value: NotificationOverlayOutcome | null): void {
  const resolve = pendingNotificationResolver;
  pendingNotificationResolver = null;
  resolve?.(value);
}

/**
 * True while an awaited inbox open is listening. Row executors use this to pick
 * their delivery: pending → resolve the bridge and let the opener consume the
 * outcome; none → the row delivers the outcome itself (root-content handoff or
 * the player-control title switch), because nobody will ever read a bridge
 * resolution on that path.
 */
export function hasPendingNotificationSelection(): boolean {
  return pendingNotificationResolver !== null;
}

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

  // OPEN_OVERLAY pushes a different type and replaces only the same type
  // (see shouldReplaceOpenOverlay). Never REPLACE_TOP across types — that
  // erases Esc history (e.g. notifications → help cannot return to inbox).
  stateManager.dispatch({
    type: "OPEN_OVERLAY",
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

export type DiagnosticsOverlayPreparation = {
  readonly recordMemorySample: (container: Container, source: string) => void;
  readonly runYoutubeProbes: (container: Container) => Promise<void>;
};

async function loadDiagnosticsOverlayPreparation(): Promise<DiagnosticsOverlayPreparation> {
  const { recordDiagnosticsPanelMemorySample } = await import("./diagnostics-panel-source");
  const { runYoutubeDiagnosticsProbes } =
    await import("@/services/youtube/youtube-diagnostics-probes");
  return {
    recordMemorySample: recordDiagnosticsPanelMemorySample,
    runYoutubeProbes: async (container) => {
      // Probe results are recorded as normal diagnostic events; the overlay
      // reconstructs YouTube evidence via extractYoutubeProbeFromEvents.
      await runYoutubeDiagnosticsProbes(container);
    },
  };
}

export async function openDiagnosticsOverlay(
  container: Container,
  source: string,
  load: () => Promise<DiagnosticsOverlayPreparation> = loadDiagnosticsOverlayPreparation,
): Promise<void> {
  const preparation = await load();
  preparation.recordMemorySample(container, source);

  // Do not await the probes. They spawn yt-dlp and make a live HTTP request to
  // an Invidious instance, each bounded at 8s, so awaiting them here meant an
  // unreachable instance held the panel closed for eight seconds with nothing
  // on screen. The overlay never needed the wait: the probes record ordinary
  // diagnostic events and the surface reconstructs them through
  // extractYoutubeProbeFromEvents, so the evidence fills in when it lands.
  void preparation.runYoutubeProbes(container).catch(() => {
    // Probe failures are already recorded as diagnostic events; a rejection
    // here must not surface as an unhandled rejection.
  });

  await openRootOwnedOverlay(container, { type: "diagnostics" });
}

export async function openNotificationsOverlay(container: Container): Promise<{
  readonly outcome: NotificationOverlayOutcome | null;
}> {
  // Unread state is cleared explicitly inside the surface (r / A), not on open —
  // so the unread dots stay visible and the manual keys do something. The bell
  // hides once countUnread hits zero.
  const selection = waitForNotificationSelection();
  await openRootOwnedOverlay(container, { type: "notifications" });
  // Any close path that never produced an outcome (Esc, an overlay replacing
  // this one, teardown) still releases the awaiter.
  resolveNotificationSelection(null);
  return { outcome: await selection };
}
