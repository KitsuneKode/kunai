import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { useConnectivityOnline } from "@/app-shell/hooks/use-connectivity-online";
import { useLineEditor } from "@/app-shell/line-editor";
import { resolveHonestLoadingStageDetail } from "@/app-shell/loading-shell-model";
import type { ListShellActionContext, ShellOption } from "@/app-shell/pickers/list-shell-types";
import {
  buildPlaybackBootstrapPresentation,
  formatBootstrapInventorySummary,
  latestPlaybackStartupStage,
} from "@/app/playback/playback-bootstrap-presenter";
import { buildPlaybackEpisodePickerOptions } from "@/app/playback/playback-episode-picker";
import { isLocalPlaybackStream } from "@/app/playback/playback-source-ui";
import {
  isCurrentStreamSelection,
  streamSelectionFromTrackPick,
} from "@/app/playback/source-quality";
import { setSessionLane, switchSessionMode } from "@/app/session/mode-switch";
import type { Container } from "@/container";
import {
  describePlaybackTelemetrySnapshot,
  type PlaybackTelemetrySnapshot,
} from "@/domain/playback/playback-telemetry-snapshot";
import type { SessionStateManager } from "@/domain/session/SessionStateManager";
import { isKittyCompatible } from "@/image";
import { copyToClipboard } from "@/infra/clipboard";
import { peekTitleDetail } from "@/services/catalog/TitleDetailService";
import { Box, Text, render, useInput } from "ink";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { dispatchAppCommand } from "./command-router";
import { recordRender } from "./diagnostics/render-trace";
import { ExitShell } from "./exit-shell";
import { registerExitHandler, requestHardExit } from "./graceful-exit";
import { useSettledValue } from "./hooks/use-settled-value";
import { deleteAllKittyImages } from "./image-pane";
import { getPickerChromeRows, getPickerLayout, getPickerListMaxVisible } from "./layout-policy";
import {
  createNotificationQueueState,
  NOTIFICATION_TOAST_TTL_MS,
  syncNotificationQueueFromActive,
  tickNotificationQueue,
  type NotificationPriority,
} from "./notification-queue";
import {
  buildPlaybackSubtitleLine,
  buildPlaybackSubtitleStatusLine,
  type PlaybackRootContentHandlers,
} from "./playback-mount-shell";
import { resolveNextEpisodeThumbUrl } from "./playback-playing-view";
import { AppHeader } from "./primitives/AppHeader";
import { ClaudeTabRow } from "./primitives/ClaudeTabRow";
import { SegmentedControl } from "./primitives/SegmentedControl";
import { RootContentBody } from "./root-content-shell";
import {
  clearRootContentSession,
  mountRootContent,
  resolveRootContentFromSession,
  useRootContentSession,
} from "./root-content-state";
import { getRootOverlayResetKey } from "./root-overlay-model";
import { RootOverlayShell } from "./root-overlay-shell";
import {
  getRootOwnedOverlay,
  resolveRootShellSurface,
  type RootOwnedOverlay,
} from "./root-shell-state";
import { buildRootStatusSummary, type SyncHealth } from "./root-status-summary";
import { openSessionPicker } from "./session-picker";
import {
  getCommandAutocompleteTarget,
  getCommandMatches,
  getHighlightedCommand,
  getListShellCommandPaletteMaxVisible,
  shouldHideCompanionForCommandPalette,
} from "./shell-command-model";
import { CommandPalette } from "./shell-command-ui";
import { InputField } from "./shell-frame";
import { LocalSection, ResizeBlocker, ShellFooter, TransientRowSlot } from "./shell-primitives";
import { clearShellScreenArtifacts } from "./shell-screen-clear";
import { getWindowStart, padColumnsEnd, truncateLine, wrapText } from "./shell-text";
import { palette, statusColor } from "./shell-theme";
import {
  buildStatsView,
  STATS_KINDS,
  STATS_RANGES,
  STATS_TABS,
  statsKindFromIndex,
  statsRangeFromIndex,
  statsTabFromIndex,
} from "./stats-view";
import { getNextStreakMilestone } from "./streak-milestone";
import { selectTransientRow } from "./transient-row";
import {
  toShellAction,
  type FooterAction,
  type ShellAction,
  type ShellFooterMode,
  type ShellStatusTone,
} from "./types";
import { usePosterPreview } from "./use-poster-preview";
import { useSessionSelector } from "./use-session-selector";
import { useTerminalResizeCleanup } from "./use-terminal-resize-cleanup";
import { useDebouncedViewportPolicy, useShellDimensions } from "./use-viewport-policy";

export { openPlaybackShell } from "./playback-mount-shell";

const ACTIVE_PLAYBACK_STATUSES = ["ready", "buffering", "seeking", "stalled", "playing"] as const;
const ROOT_STATUS_DEBOUNCE_MS = 250;
const LIST_SHELL_FOOTER_ACTIONS: readonly FooterAction[] = [
  { key: "/", label: "commands", action: "command-mode" },
  { key: "esc", label: "back", action: "quit" },
];

// =============================================================================
// STDIN LIFECYCLE MANAGER
// =============================================================================
// Prevents event loop drainage during shell transitions.
// Ink calls unref when unmounting, which can drain the loop before
// the next shell mounts. We keep one persistent ref throughout the app.
// =============================================================================

const stdinManager = {
  _refCount: 0,
  _isSetup: false,

  setup() {
    if (this._isSetup || !process.stdin.isTTY) return;
    this._isSetup = true;
    // Keep one persistent ref to prevent event loop drainage between shell
    // transitions. We do NOT add a "data" listener here — doing so puts stdin
    // into flowing mode, which conflicts with Ink's "readable" + read() pattern
    // and prevents Ink from receiving key events in the built binary. Ctrl+C is
    // handled inside the AppRoot useInput hook instead.
    process.stdin.ref();
  },

  // Track shell nesting (for debugging/monitoring)
  enterShell() {
    this._refCount++;
    this.setup();
  },

  exitShell() {
    this._refCount--;
    // Never unref - we keep stdin alive until app exits
  },

  cleanup() {
    if (!process.stdin.isTTY) return;
    process.stdin.unref();
  },
};

// Initialize on module load
stdinManager.setup();

let rootShellInk: ReturnType<typeof render> | null = null;
let rootShellExitPromise: Promise<unknown> | null = null;

/**
 * Clears terminal image artifacts. With alternateScreen: true, Ink owns the
 * screen buffer so we only need to clean up Kitty/Ghostty image placements.
 * The raw ANSI clear (\x1b[2J\x1b[H) is intentionally omitted to avoid
 * flicker — Ink's reconciler handles repaint.
 */
export function clearShellScreen() {
  clearShellScreenArtifacts();
}

async function openPlaybackStreamSelectionPicker(
  container: Container,
  action: "source" | "quality" | "audio" | "subtitle" | "provider",
  reason: string,
): Promise<void> {
  const stream = container.stateManager.getState().stream;
  if (!stream) return;

  // One unified Tracks panel; each command deep-links its section. From any
  // section the left pane reaches the others (no separate umbrella command).
  const initialSection =
    action === "provider"
      ? "provider"
      : action === "source"
        ? "source"
        : action === "quality"
          ? "quality"
          : action === "audio"
            ? "audio"
            : "subtitle";
  const { openTracksPanel } = await import("./workflows");
  const picked = await openTracksPanel(stream, { initialSection }, container);
  if (!picked) return;
  const selection = streamSelectionFromTrackPick(picked);
  if (!selection && picked.section !== "subtitle") return;
  if (selection && isCurrentStreamSelection(container.stateManager.getState().stream, selection)) {
    return;
  }

  const sessionState = container.stateManager.getState();
  const title = sessionState.currentTitle;
  const episode = sessionState.currentEpisode;
  if (
    title &&
    episode &&
    selection &&
    (picked.section === "provider" ||
      selection.audioMode ||
      selection.crossProviderSource ||
      selection.providerId)
  ) {
    const { resolveTracksPanelPick } = await import("@/app/playback/tracks-panel-pick");
    const resolved = await resolveTracksPanelPick(picked, selection, {
      container,
      title,
      episode,
      currentProviderId: sessionState.provider,
      resumeSeconds: 0,
      reason,
    });
    if (resolved.kind === "noop") return;
    if (resolved.kind === "cross-provider-source") {
      await container.episodePlaybackSelection
        .set({
          providerId: resolved.providerId,
          titleId: title.id,
          season: episode.season,
          episode: episode.episode,
          sourceId: resolved.sourceId,
          streamId: null,
        })
        .catch(() => undefined);
    }
    if (container.playerControl.getActive()) {
      void container.playerControl.recomputeCurrentPlayback(reason);
      return;
    }
    container.workControl.cancelActive(`${reason}-abort-resolve`);
    return;
  }

  if (!selection) return;

  // Source switches restart the episode; quality/audio/hardsub swap the active
  // stream in place. Subtitles attach in mpv, so they never resolve here.
  const controlAction = picked.section === "source" ? "pick-source" : "pick-quality";
  const applySelection = async (): Promise<boolean> =>
    container.playerControl.selectCurrentPlaybackStream(controlAction, selection, reason);

  if (container.playerControl.getActive()) {
    await applySelection();
    return;
  }

  const playbackStatus = container.stateManager.getState().playbackStatus;
  const isBootstrap = playbackStatus === "loading" || playbackStatus === "ready";
  const queued = await applySelection();
  if (!queued) return;

  // During bootstrap there is no active player yet — abort the in-flight resolve so
  // PlaybackPhase can re-run with the user's preferred source/stream.
  if (isBootstrap) {
    container.workControl.cancelActive(`${reason}-abort-resolve`);
    return;
  }

  const active = await container.playerControl.waitForActivePlayer({ timeoutMs: 12_000 });
  if (active) {
    await applySelection();
  }
}

async function openActivePlaybackEpisodePicker(
  container: Container,
  reason: string,
): Promise<void> {
  const state = container.stateManager.getState();
  const title = state.currentTitle;
  const currentEpisode = state.currentEpisode;
  if (!title || title.type !== "series" || !currentEpisode) return;

  const watchedEntries = container.historyRepository.listByTitle(title.id);
  const picker = await buildPlaybackEpisodePickerOptions({
    title,
    currentEpisode,
    isAnime: state.mode === "anime",
    animeEpisodeCount: title.episodeCount,
    watchedEntries,
  });
  if (picker.options.length === 0) return;

  const picked = await openSessionPicker(container.stateManager, {
    type: "episode_picker",
    season: currentEpisode.season,
    initialIndex: picker.initialIndex,
    options: picker.options,
  });
  if (!picked) return;

  const selection = decodeEpisodeSelectionValue(picked);
  if (!selection) return;
  if (selection.season === currentEpisode.season && selection.episode === currentEpisode.episode) {
    return;
  }

  await container.playerControl.selectCurrentPlaybackEpisode(selection, reason);
}

// =============================================================================
// STATE-DRIVEN APP HOST
// =============================================================================

/** Library/queue overlays own their chrome; stacking them under pickers duplicates footers. */
function shouldStackOverlayUnderRootContent(overlay: RootOwnedOverlay): boolean {
  return overlay.type !== "library" && overlay.type !== "downloads";
}

/**
 * Hook to subscribe to the global session state.
 */
export function useSessionState(stateManager: SessionStateManager) {
  return useSessionSelector(stateManager, (state) => state);
}

/**
 * Persistent root of the state-driven UI.
 * Holds the identity logo and renders the appropriate shell based on state.
 */

function AppRoot({ container }: { container: Container }) {
  // Counts root-shell commits. With no keystroke recorded for this surface, the
  // tracer flags every AppRoot render as an "idle render", so `--debug` exposes
  // background-timer-driven full-frame redraws while parked on /calendar.
  recordRender("ink-shell");
  const { stateManager } = container;
  const state = useSessionState(stateManager);
  const rootOverlay = useSessionSelector(stateManager, getRootOwnedOverlay);
  const rootContent = useRootContentSession();
  const { cols: shellWidth, rows: shellHeight } = useShellDimensions();
  useTerminalResizeCleanup();
  const [exiting, setExiting] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);
  const [streak, setStreak] = useState<number | undefined>(undefined);
  const [syncHealth, setSyncHealth] = useState<SyncHealth | undefined>(undefined);
  const [playlistCount, setPlaylistCount] = useState<number>(0);
  const [streakMilestoneAlert, setStreakMilestoneAlert] = useState<string | null>(null);
  const [streakAtRiskAlert, setStreakAtRiskAlert] = useState<string | null>(null);
  const [notificationToast, setNotificationToast] = useState<string | null>(null);
  const [notificationToastPriority, setNotificationToastPriority] =
    useState<NotificationPriority | null>(null);
  const notificationSeenKeysRef = useRef<ReadonlySet<string>>(new Set());
  const notificationQueueRef = useRef(createNotificationQueueState());
  const notificationQueueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [weeklyDigestLine, setWeeklyDigestLine] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => {
      let currentStreak: number | undefined;
      try {
        const { current } = container.statsService.computeStreak();
        currentStreak = current;
        setStreak(current);
      } catch {
        setStreak(undefined);
      }
      setSyncHealth(container.syncService.getHealth());
      try {
        setPlaylistCount(container.queueService.getStatus().unplayedCount);
      } catch {
        // best-effort
      }

      if (currentStreak !== undefined && currentStreak >= 3) {
        const days = currentStreak;
        const lastCelebrated = container.config.lastStreakMilestoneDays ?? 0;
        const nextMilestone = getNextStreakMilestone(days, lastCelebrated);
        if (nextMilestone) {
          setStreakMilestoneAlert(`🔥 ${nextMilestone}-day streak! Keep it going.`);
          void container.config.update({ lastStreakMilestoneDays: nextMilestone });
          setTimeout(() => setStreakMilestoneAlert(null), 6_000);
        }

        // Streak-at-risk: after 20:00 local time, if user hasn't watched today
        const hour = new Date().getHours();
        if (hour >= 20) {
          try {
            const watchedToday = container.statsService.watchedToday();
            if (!watchedToday) {
              setStreakAtRiskAlert(`🔥 ${days}d streak at risk — watch something tonight`);
              setTimeout(() => setStreakAtRiskAlert(null), 10_000);
            }
          } catch {
            // best-effort
          }
        }
      }
    };
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  }, [container.statsService, container.syncService, container.queueService, container.config]);

  // Live notification queue. Seed the seen-set on mount so pre-existing
  // notifications never toast; arrivals are sequenced with priority, fold, and TTL.
  useEffect(() => {
    notificationSeenKeysRef.current = new Set(
      container.notificationService.listActive(200, 0).map((n) => n.dedupKey),
    );
    notificationQueueRef.current = createNotificationQueueState();
    setNotificationToast(null);
    setNotificationToastPriority(null);

    const scheduleQueueTick = () => {
      if (notificationQueueTimerRef.current) {
        clearTimeout(notificationQueueTimerRef.current);
      }
      notificationQueueTimerRef.current = setTimeout(
        () => {
          const ticked = tickNotificationQueue(notificationQueueRef.current, Date.now());
          notificationQueueRef.current = ticked.state;
          setNotificationToast(ticked.toast);
          setNotificationToastPriority(ticked.state.current?.priority ?? null);
          if (ticked.state.current) {
            scheduleQueueTick();
          }
        },
        Math.min(500, NOTIFICATION_TOAST_TTL_MS),
      );
    };

    const handleChange = () => {
      const active = container.notificationService.listActive(200, 0);
      const synced = syncNotificationQueueFromActive({
        state: notificationQueueRef.current,
        active,
        seenKeys: notificationSeenKeysRef.current,
        now: Date.now(),
      });
      notificationQueueRef.current = synced.state;
      notificationSeenKeysRef.current = synced.seenKeys;
      setNotificationToast(synced.toast);
      setNotificationToastPriority(synced.currentPriority);
      if (synced.state.current) {
        scheduleQueueTick();
      }
    };

    const unsubscribe = container.notificationService.subscribe(handleChange);
    return () => {
      unsubscribe();
      if (notificationQueueTimerRef.current) {
        clearTimeout(notificationQueueTimerRef.current);
      }
    };
  }, [container.notificationService]);

  useEffect(() => {
    const lastShown = container.config.lastWeeklyDigestShownAt;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const shouldShow = !lastShown || Date.now() - new Date(lastShown).getTime() > sevenDaysMs;
    if (!shouldShow) return;

    let cancelled = false;
    void (async () => {
      try {
        const stats = container.statsService.getStats(7);
        if (stats.totalEpisodes === 0) return;
        const text = container.statsFormatter.formatWeeklyDigest(stats);
        if (!cancelled) {
          setWeeklyDigestLine(text);
          await container.config.update({ lastWeeklyDigestShownAt: new Date().toISOString() });
          setTimeout(() => {
            if (!cancelled) setWeeklyDigestLine(null);
          }, 8_000);
        }
      } catch {
        // digest is best-effort
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [container.statsService, container.statsFormatter, container.config]);

  // Resize repaint is owned by Ink's reconciler in alternate-screen mode (its
  // own resize handler clears + relayouts on width decrease, and replaces the
  // buffer cleanly otherwise). A manual `\x1b[2J\x1b[H` here double-clears and
  // forces a blank intermediate frame, so it is intentionally omitted — see the
  // clearShellScreen doctrine above.
  const [playbackTelemetrySnapshot, setPlaybackTelemetrySnapshot] =
    useState<PlaybackTelemetrySnapshot | null>(null);
  const presenceBootTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPresenceProviderRef = useRef(container.config.presenceProvider);
  latestPresenceProviderRef.current = container.config.presenceProvider;
  const [presenceBootLine, setPresenceBootLine] = useState<{
    readonly text: string;
    readonly tone: ShellStatusTone;
  } | null>(null);

  // Global Ctrl+C handler. Ink normalizes control characters to their
  // letter name with key.ctrl=true, so we check both forms for safety.
  // Instead of calling requestHardExit (which skips presence/mpv cleanup),
  // emit SIGINT to self so the signal handler in main.ts runs the full
  // cleanup sequence (pause downloads, disconnect Discord, kill mpv,
  // clean socket files, unmount Ink).
  useInput((input, key) => {
    if ((input === "c" && key.ctrl) || input === "\x03") {
      stdinManager.cleanup();
      process.kill(process.pid, "SIGINT");
    }
  });

  // Register cleanup as pre-exit handlers for the /quit path.
  // The OS signal handler (SIGINT/SIGTERM) pauses downloads separately,
  // so this handler covers only requestHardExit callers (e.g. /quit).
  useEffect(
    () =>
      registerExitHandler(async () => {
        await container.presence.shutdown();
      }),
    [container],
  );

  useEffect(
    () =>
      registerExitHandler(async () => {
        await container.player.releasePersistentSession();
      }),
    [container],
  );

  useEffect(
    () =>
      registerExitHandler(async () => {
        await container.downloadService.pauseActiveJobsForShutdown("download paused by exit");
      }),
    [container],
  );

  useEffect(() => {
    stateManager.dispatch({
      type: "SET_IMAGE_SUPPORT",
      supported: isKittyCompatible(),
    });
  }, [stateManager]);

  useEffect(
    () =>
      container.playerControl.subscribePickerRequest((action) => {
        const shellAction =
          action === "pick-source" ? "source" : action === "pick-quality" ? "quality" : "source";
        void openPlaybackStreamSelectionPicker(container, shellAction, "mpv-picker-request");
      }),
    [container],
  );

  // Eager Discord presence: choosing Discord in settings opens the local IPC pipe here and
  // after saves that enable Discord / change the Discord app id (applySettings disconnects first).
  // Failures backoff inside PresenceServiceImpl; never block Ink on this task.
  const presenceProvider = container.config.presenceProvider;
  const presenceDiscordClientId = container.config.presenceDiscordClientId;
  useEffect(() => {
    const clearPresenceBootTimer = () => {
      if (presenceBootTimerRef.current) {
        clearTimeout(presenceBootTimerRef.current);
        presenceBootTimerRef.current = null;
      }
    };

    clearPresenceBootTimer();
    if (presenceProvider !== "discord") {
      return () => {
        clearPresenceBootTimer();
      };
    }

    let cancelled = false;
    void (async () => {
      const snapshot = await container.presence.connect();
      if (cancelled) return;
      if (latestPresenceProviderRef.current !== "discord") return;

      clearPresenceBootTimer();
      if (snapshot.status === "ready") {
        setPresenceBootLine({ text: "Discord presence · connected", tone: "success" });
      } else if (snapshot.status === "disabled") {
        return;
      } else {
        // Presence is opt-in, so if Discord is enabled but can't connect
        // ("unavailable" / error), a transient warning is accurate feedback — it
        // auto-dismisses after ~6s, warning the user without nagging.
        const rawDetail = snapshot.detail.trim() || snapshot.status;
        const detail = rawDetail.length > 56 ? `${rawDetail.slice(0, 53).trimEnd()}…` : rawDetail;
        const tone: ShellStatusTone = snapshot.status === "error" ? "error" : "warning";
        setPresenceBootLine({
          text: `Discord presence · ${snapshot.status} · ${detail}`,
          tone,
        });
      }

      presenceBootTimerRef.current = setTimeout(() => {
        presenceBootTimerRef.current = null;
        setPresenceBootLine(null);
      }, 6200);
    })();

    return () => {
      cancelled = true;
      clearPresenceBootTimer();
    };
  }, [container.presence, presenceDiscordClientId, presenceProvider]);

  useEffect(() => {
    const resolveStatus = () => {
      const snapshot = stateManager.getState();
      const currentTitle = snapshot.currentTitle;
      if (!currentTitle) {
        setDownloadStatus(container.downloadService.describeQueueSummary());
        return;
      }
      const line = container.downloadService.describeActiveDownloadForPlayback({
        titleId: currentTitle.id,
        contentType: currentTitle.type,
        season: snapshot.currentEpisode?.season,
        episode: snapshot.currentEpisode?.episode,
      });
      setDownloadStatus(line ?? container.downloadService.describeQueueSummary());
    };

    resolveStatus();
    const timer = setInterval(resolveStatus, 2000);
    return () => clearInterval(timer);
  }, [
    container.downloadService,
    stateManager,
    state.currentTitle?.id,
    state.currentTitle?.type,
    state.currentEpisode?.season,
    state.currentEpisode?.episode,
  ]);

  const playbackIsActive = ACTIVE_PLAYBACK_STATUSES.some(
    (status) => status === state.playbackStatus,
  );
  useEffect(() => {
    if (!playbackIsActive) {
      return;
    }

    const refreshSnapshot = () => {
      setPlaybackTelemetrySnapshot(container.playerControl.getTelemetrySnapshot());
    };

    refreshSnapshot();
    const timer = setInterval(refreshSnapshot, 1_000);
    return () => clearInterval(timer);
  }, [container.playerControl, playbackIsActive]);
  const activePlaybackTelemetrySnapshot = playbackIsActive ? playbackTelemetrySnapshot : null;

  const rootStatus = playbackIsActive
    ? state.playbackStatus
    : state.playbackStatus === "loading"
      ? "loading"
      : state.searchState === "loading"
        ? "searching"
        : state.playbackStatus === "error"
          ? "error"
          : "ready";
  const playbackSubtitle = buildPlaybackSubtitleLine(state);
  const playbackSubtitleStatus = buildPlaybackSubtitleStatusLine(state);
  const visiblePresenceBootLine = presenceProvider === "discord" ? presenceBootLine : null;
  const currentViewLabel =
    state.playbackStatus === "loading" || playbackIsActive
      ? "playback"
      : rootContent?.kind === "picker"
        ? "picker"
        : rootContent?.kind === "browse" ||
            rootContent?.kind === "playback" ||
            rootContent?.kind === "post-playback"
          ? rootContent.kind
          : state.view;
  const headerDestination =
    currentViewLabel === "playback"
      ? "Now Playing"
      : currentViewLabel === "post-playback"
        ? "Up Next"
        : currentViewLabel.charAt(0).toUpperCase() + currentViewLabel.slice(1);
  // Bell reflects UNREAD notifications and hides at zero (root-status-summary only
  // renders the bell when notificationCount > 0).
  const activeNotifications = container.notificationService.listActive(200, 0);
  const unreadNotifications = activeNotifications.filter((notification) => !notification.readAt);
  const unreadNotificationCount = unreadNotifications.length;
  const newEpisodeNotificationCount = useMemo(
    () => unreadNotifications.filter((notification) => notification.kind === "new-episode").length,
    [unreadNotifications],
  );
  const playbackIsLocal = isLocalPlaybackStream(state.stream);
  const networkAvailable = useConnectivityOnline(container.connectivity);
  const rootStatusSummaryInput = useMemo(
    () => ({
      currentViewLabel,
      rootStatus,
      downloadStatus,
      streak,
      syncHealth,
      playlistCount,
      notificationCount: unreadNotificationCount,
      newEpisodeNotificationCount,
      offlineMode: container.config.offlineMode,
      networkAvailable,
      playbackIsLocal,
      playbackProblem: state.playbackProblem,
      autoplaySessionPaused: state.autoplaySessionPaused,
      autoskipSessionPaused: state.autoskipSessionPaused,
      stopAfterCurrent: state.stopAfterCurrent,
      provider: state.provider,
      currentTitle: state.currentTitle,
      mode: state.mode,
      streamProviderId: state.stream?.providerResolveResult?.providerId,
    }),
    [
      currentViewLabel,
      rootStatus,
      downloadStatus,
      streak,
      syncHealth,
      playlistCount,
      unreadNotificationCount,
      newEpisodeNotificationCount,
      container.config.offlineMode,
      networkAvailable,
      playbackIsLocal,
      state.playbackProblem,
      state.autoplaySessionPaused,
      state.autoskipSessionPaused,
      state.stopAfterCurrent,
      state.provider,
      state.currentTitle,
      state.mode,
      state.stream?.providerResolveResult?.providerId,
    ],
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const [rootStatusSummary, setRootStatusSummary] = useState(() =>
    buildRootStatusSummary({
      state,
      currentViewLabel,
      rootStatus,
      downloadStatus,
      streak,
      syncHealth,
      playlistCount,
      notificationCount: unreadNotificationCount,
      newEpisodeNotificationCount,
      offlineMode: container.config.offlineMode,
      networkAvailable,
      playbackIsLocal,
    }),
  );
  useEffect(() => {
    const timer = setTimeout(() => {
      setRootStatusSummary(
        buildRootStatusSummary({
          state: stateRef.current,
          currentViewLabel: rootStatusSummaryInput.currentViewLabel,
          rootStatus: rootStatusSummaryInput.rootStatus,
          downloadStatus: rootStatusSummaryInput.downloadStatus,
          streak: rootStatusSummaryInput.streak,
          syncHealth: rootStatusSummaryInput.syncHealth,
          playlistCount: rootStatusSummaryInput.playlistCount,
          notificationCount: rootStatusSummaryInput.notificationCount,
          newEpisodeNotificationCount: rootStatusSummaryInput.newEpisodeNotificationCount,
          offlineMode: rootStatusSummaryInput.offlineMode,
          networkAvailable: rootStatusSummaryInput.networkAvailable,
          playbackIsLocal: rootStatusSummaryInput.playbackIsLocal,
        }),
      );
    }, ROOT_STATUS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [rootStatusSummaryInput]);
  const rootSurface = resolveRootShellSurface(state, {
    hasRootContent: Boolean(rootContent),
    hasMountedScreen: false,
  });
  const isSeriesPlayback =
    rootSurface === "playback" &&
    state.currentTitle?.type === "series" &&
    state.currentEpisode !== null;
  const playbackTrace =
    state.playbackNote ??
    (activePlaybackTelemetrySnapshot
      ? describePlaybackTelemetrySnapshot(activePlaybackTelemetrySnapshot)
      : undefined) ??
    (state.playbackStatus === "playing"
      ? "Auto-skip and live playback controls stay available while mpv is active"
      : undefined);
  const canGoNext = Boolean(isSeriesPlayback && state.episodeNavigation.hasNext);
  const canGoPrevious = Boolean(isSeriesPlayback && state.episodeNavigation.hasPrevious);
  const canToggleAutoplay = Boolean(isSeriesPlayback);
  const canStopAfterCurrent = Boolean(isSeriesPlayback);
  const playbackCanCancel = state.playbackStatus === "loading" || state.playbackStatus === "ready";
  const fallbackProvider =
    state.currentTitle && state.currentEpisode
      ? container.providerRegistry
          .getCompatible(state.currentTitle, state.mode)
          .find((candidate) => candidate.metadata.id !== state.provider)
      : undefined;
  const activeProvider = container.providerRegistry.get(state.provider);
  const hasStreamCandidates = Boolean(state.stream?.providerResolveResult);
  const playbackBootstrapPresentation = useMemo(
    () =>
      buildPlaybackBootstrapPresentation({
        playbackStatus: state.playbackStatus,
        playbackDetail: state.playbackDetail,
        recentEvents: container.diagnosticsService.getRecent(40),
      }),
    [state.playbackStatus, state.playbackDetail, container.diagnosticsService],
  );
  const playbackBootstrapStageDetail = useMemo(() => {
    const startupStage = latestPlaybackStartupStage(container.diagnosticsService.getRecent(40));
    const base = resolveHonestLoadingStageDetail({
      startupStage,
      playbackDetail: playbackBootstrapPresentation.stageDetail ?? state.playbackDetail,
      mode: state.mode,
    });
    if (
      !state.stream?.providerResolveResult ||
      (state.playbackStatus !== "loading" && state.playbackStatus !== "ready")
    ) {
      return base;
    }
    const inventorySummary = formatBootstrapInventorySummary(state.stream);
    if (!inventorySummary) return base;
    return base ? `${base} · ${inventorySummary}` : inventorySummary;
  }, [
    container.diagnosticsService,
    playbackBootstrapPresentation.stageDetail,
    state.mode,
    state.playbackDetail,
    state.playbackStatus,
    state.stream,
  ]);
  const playingTitleDetail = useMemo(() => {
    const title = state.currentTitle;
    if (!title) return undefined;
    return peekTitleDetail(title.id, title.type);
  }, [state.currentTitle]);
  const playingNextEpisodeThumbUrl = useMemo(
    () => resolveNextEpisodeThumbUrl(playingTitleDetail, state.episodeNavigation.nextLabel),
    [playingTitleDetail, state.episodeNavigation.nextLabel],
  );

  const onCommandAction = useCallback(
    (action: ShellAction) => {
      void (async () => {
        const result = await dispatchAppCommand({
          action,
          source: "runtime",
          activePlayback: {
            deps: {
              playerControl: container.playerControl,
              workControl: container.workControl,
              stateManager: container.stateManager,
              openStreamSelectionPicker: async (_deps, pickerAction, reason) => {
                await openPlaybackStreamSelectionPicker(container, pickerAction, reason);
              },
              openEpisodePicker: async (_deps, reason) => {
                await openActivePlaybackEpisodePicker(container, reason);
              },
              enqueueCurrentPlaybackDownload: async (_deps, reason) => {
                const { enqueueCurrentPlaybackDownload } = await import("./workflows");
                await enqueueCurrentPlaybackDownload({
                  container,
                  reason,
                });
              },
              switchSessionMode: () => {
                switchSessionMode(container.stateManager);
              },
              setSessionLane: (_sm, mode) => {
                setSessionLane(container.stateManager, mode);
              },
              routeSearchShellAction: async (nextAction) => {
                const { routeSearchShellAction } = await import("./command-router");
                return routeSearchShellAction({ action: nextAction, container });
              },
              setExiting,
            },
            canGoNext,
            canGoPrevious,
            canToggleAutoplay,
          },
        });
        if (result.status !== "ignored" || !result.reason) return;
        container.stateManager.dispatch({
          type: "SET_PLAYBACK_FEEDBACK",
          detail: result.reason,
        });
      })();
    },
    [container, canGoNext, canGoPrevious, canToggleAutoplay, setExiting],
  );

  const onCancel = useCallback(() => {
    const cancelledWork = container.workControl.cancelActive("playback-loading-esc");
    if (!cancelledWork) {
      void container.playerControl.stopCurrentPlayback("playback-loading-esc");
    }
  }, [container]);

  const onStop = useCallback(() => {
    onCommandAction("quit");
  }, [onCommandAction]);

  const onNextHandler = useCallback(() => {
    onCommandAction("next");
  }, [onCommandAction]);

  const onPreviousHandler = useCallback(() => {
    onCommandAction("previous");
  }, [onCommandAction]);

  const onRecover = useCallback(() => {
    onCommandAction("recover");
  }, [onCommandAction]);

  const onFallback = useCallback(() => {
    onCommandAction("fallback");
  }, [onCommandAction]);

  const onPickStreams = useCallback(() => {
    onCommandAction("source");
  }, [onCommandAction]);

  const onPickEpisode = useCallback(() => {
    onCommandAction("pick-episode");
  }, [onCommandAction]);

  const onReloadSubtitles = useCallback(() => {
    void container.playerControl.reloadCurrentSubtitles("playback-shell-s");
  }, [container]);

  const onSkipSegment = useCallback(() => {
    void container.playerControl.skipCurrentSegment("playback-shell-i");
  }, [container]);

  const onToggleAutoplay = useCallback(() => {
    onCommandAction("toggle-autoplay");
  }, [onCommandAction]);

  const onToggleAutoskip = useCallback(() => {
    onCommandAction("toggle-autoskip");
  }, [onCommandAction]);

  const onStopAfterCurrent = useCallback(() => {
    onCommandAction("stop-after-current");
  }, [onCommandAction]);

  const onPickSource = useCallback(() => {
    onCommandAction("source");
  }, [onCommandAction]);

  const onPickQuality = useCallback(() => {
    onCommandAction("quality");
  }, [onCommandAction]);

  const onReturnToSearch = useCallback(() => {
    onCommandAction("search");
  }, [onCommandAction]);

  const onExitDone = useCallback(() => requestHardExit(0), []);

  const playbackHandlers = useMemo<PlaybackRootContentHandlers>(
    () => ({
      onCommandAction,
      onCancel,
      onStop,
      onNext: onNextHandler,
      onPrevious: onPreviousHandler,
      onRecover,
      onFallback,
      onPickStreams,
      onPickEpisode,
      onReloadSubtitles,
      onSkipSegment,
      onToggleAutoplay,
      onToggleAutoskip,
      onStopAfterCurrent,
      onPickSource,
      onPickQuality,
      onReturnToSearch,
    }),
    [
      onCommandAction,
      onCancel,
      onStop,
      onNextHandler,
      onPreviousHandler,
      onRecover,
      onFallback,
      onPickStreams,
      onPickEpisode,
      onReloadSubtitles,
      onSkipSegment,
      onToggleAutoplay,
      onToggleAutoskip,
      onStopAfterCurrent,
      onPickSource,
      onPickQuality,
      onReturnToSearch,
    ],
  );

  const playbackRootInput = useMemo(
    () => ({
      container,
      state,
      playbackSubtitle,
      playbackSubtitleStatus,
      playbackBootstrapPresentation,
      playbackBootstrapStageDetail,
      downloadStatus,
      playbackCanCancel,
      playbackTrace,
      fallbackProvider,
      activeProvider,
      hasStreamCandidates,
      isSeriesPlayback,
      activePlaybackTelemetrySnapshot,
      canGoNext,
      canGoPrevious,
      canToggleAutoplay,
      canStopAfterCurrent,
      playingTitleDetail,
      playingNextEpisodeThumbUrl,
      handlers: playbackHandlers,
    }),
    [
      container,
      state,
      playbackSubtitle,
      playbackSubtitleStatus,
      playbackBootstrapPresentation,
      playbackBootstrapStageDetail,
      downloadStatus,
      playbackCanCancel,
      playbackTrace,
      fallbackProvider,
      activeProvider,
      hasStreamCandidates,
      isSeriesPlayback,
      activePlaybackTelemetrySnapshot,
      canGoNext,
      canGoPrevious,
      canToggleAutoplay,
      canStopAfterCurrent,
      playingTitleDetail,
      playingNextEpisodeThumbUrl,
      playbackHandlers,
    ],
  );

  const resolvedRootContent = useMemo(
    () => resolveRootContentFromSession(state, { rootContent }),
    [state, rootContent],
  );

  if (exiting) {
    return <ExitShell onDone={onExitDone} />;
  }

  return (
    <Box
      flexDirection="column"
      width={shellWidth}
      height={shellHeight}
      backgroundColor={palette.bg}
      paddingX={1}
      paddingY={0}
    >
      {/* Single canonical header: brand · destination pill · crumb · status · size */}
      <AppHeader
        destination={headerDestination}
        context={rootStatusSummary.crumb}
        status={
          container.config.minimalMode && currentViewLabel === "browse"
            ? undefined
            : rootStatusSummary.header.label
        }
        statusColor={statusColor(rootStatusSummary.header.tone)}
        // Terminal size is noise at a comfortable size — only surface it when the
        // terminal is cramped enough to actually affect the layout (then it reads
        // as a useful "resize me" hint rather than permanent header clutter).
        size={shellWidth < 100 || shellHeight < 30 ? `${shellWidth}×${shellHeight}` : undefined}
        width={Math.max(0, shellWidth - 2)}
      />
      <TransientRowSlot width={Math.max(36, shellWidth - 8)}>
        {(() => {
          const transient = selectTransientRow({
            alert: rootStatusSummary.alert ?? null,
            notificationToast,
            notificationToastPriority,
            streakMilestoneAlert,
            presenceBootLine: visiblePresenceBootLine,
            streakAtRiskAlert,
            weeklyDigestLine,
          });
          if (!transient) return null;
          return (
            <Text
              dimColor={transient.dim}
              bold={transient.accent}
              color={transient.accent ? palette.accent : statusColor(transient.tone)}
            >
              {truncateLine(transient.text, Math.max(36, shellWidth - 8))}
            </Text>
          );
        })()}
      </TransientRowSlot>
      <Box marginTop={1} flexDirection="column" flexGrow={1} justifyContent="space-between">
        <Box flexDirection="column" flexGrow={1}>
          <RootContentBody
            resolved={resolvedRootContent}
            ctx={{
              container,
              state,
              stateManager,
              rootOverlay,
              playbackRootInput,
              clearShellScreen,
            }}
          />
        </Box>

        {rootSurface === "root-content" &&
        rootOverlay &&
        shouldStackOverlayUnderRootContent(rootOverlay) ? (
          <Box marginTop={1}>
            <RootOverlayShell
              key={getRootOverlayResetKey(rootOverlay)}
              overlay={rootOverlay}
              state={state}
              container={container}
              onRedraw={clearShellScreen}
            />
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

/**
 * Launches the persistent state-driven app shell.
 */
export async function launchSessionApp(container: Container) {
  if (rootShellInk && rootShellExitPromise) {
    return rootShellExitPromise;
  }

  stdinManager.enterShell();
  clearShellScreen();

  rootShellInk = render(<AppRoot container={container} />, {
    exitOnCtrlC: false,
    alternateScreen: true,
  });
  rootShellExitPromise = rootShellInk.waitUntilExit();

  void (async () => {
    await rootShellExitPromise;
    rootShellInk = null;
    rootShellExitPromise = null;
    clearRootContentSession();
    stdinManager.exitShell();
  })();

  return rootShellExitPromise;
}

export async function shutdownSessionApp(): Promise<void> {
  if (!rootShellInk || !rootShellExitPromise) {
    return;
  }

  const { forceSettleAllRootContent } = await import("./root-content-state");
  forceSettleAllRootContent("session-shutdown");

  const exitPromise = rootShellExitPromise;
  const ink = rootShellInk;
  ink.cleanup();
  await exitPromise.catch(() => {});
  deleteAllKittyImages();
}

type ListShellActionResult = {
  type: "action";
  action: ShellAction;
  filterQuery: string;
  selectedIndex: number;
};

type ListShellSubmitResult<T> =
  | { type: "selected"; value: T }
  | { type: "cancelled" }
  | ListShellActionResult;

function normalizeReservedCommandInput(nextValue: string): {
  value: string;
  openCommandPalette: boolean;
} {
  if (!nextValue.includes("/")) {
    return { value: nextValue, openCommandPalette: false };
  }

  return {
    value: nextValue.replaceAll("/", ""),
    openCommandPalette: true,
  };
}

function decodeEpisodeSelectionValue(value: string): { season: number; episode: number } | null {
  const [seasonText, episodeText] = value.split(":");
  const season = Number.parseInt(seasonText ?? "", 10);
  const episode = Number.parseInt(episodeText ?? "", 10);
  if (!Number.isFinite(season) || !Number.isFinite(episode)) {
    return null;
  }
  return { season, episode };
}

function ListShell<T>({
  title,
  subtitle,
  options,
  initialFilter,
  initialSelectedIndex,
  actionContext,
  onSubmit,
  onCancel,
  onAction,
}: {
  title: string;
  subtitle: string;
  options: readonly ShellOption<T>[];
  initialFilter?: string;
  initialSelectedIndex?: number;
  actionContext?: ListShellActionContext;
  onSubmit: (value: T) => void;
  onCancel: () => void;
  onAction?: (result: ListShellActionResult) => void;
}) {
  const [index, setIndex] = useState(initialSelectedIndex ?? 0);
  const [confirmed, setConfirmed] = useState(false);
  const [filterQuery, setFilterQuery] = useState(initialFilter ?? "");
  const [commandMode, setCommandMode] = useState(false);
  const [commandInput, setCommandInput] = useState("");
  const [highlightedCommandIndex, setHighlightedCommandIndex] = useState(0);
  const viewport = useDebouncedViewportPolicy("picker");
  const normalizedFilter = filterQuery.trim().toLowerCase();
  const filteredOptions = useMemo(() => {
    return options.filter((option) => {
      if (normalizedFilter.length === 0) return true;
      const haystack = `${option.label} ${option.detail ?? ""}`.toLowerCase();
      return haystack.includes(normalizedFilter);
    });
  }, [options, normalizedFilter]);

  useEffect(() => {
    if (filteredOptions.length === 0) {
      setIndex(0);
      return;
    }
    setIndex((current) => Math.min(current, filteredOptions.length - 1));
  }, [filteredOptions.length]);

  const selectedOption = filteredOptions[index];
  // Label/detail stay live (cheap text) so the highlight reads instantly; only the
  // heavy poster pipeline is gated on the settled selection so a run of ↑/↓ never
  // spawns a chafa/Kitty subprocess mid-navigation.
  const settledOption = useSettledValue(selectedOption);
  const navigating = selectedOption !== settledOption;

  const { ultraCompact, tooSmall, minColumns, minRows } = viewport;
  const maxVisible = getPickerListMaxVisible(
    viewport.rows,
    getPickerChromeRows({
      hasSubtitle: subtitle.length > 0,
      commandMode,
    }),
  );
  const pickerLayout = getPickerLayout(viewport.columns, viewport.rows);
  const {
    innerWidth,
    listWidth,
    companionWidth,
    rowWidth,
    showCompanion: showSelectionCompanion,
  } = pickerLayout;
  const showCompanion =
    showSelectionCompanion && !shouldHideCompanionForCommandPalette(commandMode);
  const selectedLabel = selectedOption?.label ?? "Nothing selected";
  const selectedDetail =
    selectedOption?.detail ??
    (filteredOptions.length > 0
      ? "Use ↑↓ to move through results"
      : "No matching results. Keep typing or press Esc to clear the filter.");
  const detailLines = wrapText(selectedDetail, Math.max(20, companionWidth - 2), 7);
  const { poster, posterState } = usePosterPreview(settledOption?.previewImageUrl, {
    rows: 9,
    cols: Math.max(18, Math.min(30, companionWidth - 4)),
    enabled: showCompanion && Boolean(settledOption?.previewImageUrl),
    // `settledOption` already absorbs the rapid-navigation burst; the hook only
    // needs a tiny guard on top rather than re-debouncing.
    debounceMs: 16,
  });
  // Suppress the heavy chafa block while navigating (the companion shares output
  // lines with the shifting list, so Ink re-emits it every keystroke). Kitty
  // posters are tiny out-of-band placeholders, so leave them in place.
  const showHeavyPoster = poster.kind !== "none" && !(navigating && poster.kind === "text");

  const windowStart = getWindowStart(index, filteredOptions.length, maxVisible);
  const windowEnd = Math.min(windowStart + maxVisible, filteredOptions.length);
  const visibleOptions = filteredOptions.slice(windowStart, windowEnd);
  const footerTask =
    normalizedFilter.length > 0
      ? "Refine the filter or confirm the highlighted match"
      : (actionContext?.taskLabel ?? "Filter this list and confirm a selection");
  // List/picker shells use the minimal footer: the surface is a focused filter +
  // select, and the command palette ("/") plus Esc-back are the only chrome.
  const effectiveFooterMode: ShellFooterMode = "minimal";
  const footerActions = LIST_SHELL_FOOTER_ACTIONS;

  const updateFilterQuery = (nextValue: string) => {
    const normalized = normalizeReservedCommandInput(nextValue);
    setFilterQuery(normalized.value);
    if (normalized.openCommandPalette && actionContext) {
      setCommandMode(true);
      setCommandInput("");
      setHighlightedCommandIndex(0);
    }
  };
  const commandEditor = useLineEditor({
    value: commandInput,
    onChange: (nextValue) => {
      setCommandInput(nextValue);
      setHighlightedCommandIndex(0);
    },
  });

  useInput((input, key) => {
    if ((input === "c" && key.ctrl) || input === "\x03") {
      requestHardExit(0);
    }

    if (commandMode) {
      const matches = getCommandMatches(commandInput, actionContext?.commands ?? []);

      if (key.escape) {
        setCommandMode(false);
        setCommandInput("");
        setHighlightedCommandIndex(0);
        return;
      }
      if (key.return) {
        const resolved = getHighlightedCommand(
          commandInput,
          actionContext?.commands ?? [],
          highlightedCommandIndex,
        );
        if (resolved?.enabled) {
          onAction?.({
            type: "action",
            action: toShellAction(resolved.id),
            filterQuery,
            selectedIndex: index,
          });
        }
        return;
      }
      if (key.tab) {
        const target = getCommandAutocompleteTarget(
          commandInput,
          actionContext?.commands ?? [],
          highlightedCommandIndex,
        );
        if (target) {
          commandEditor.setValue(target.aliases[0] ?? target.id);
          const nextIndex = matches.findIndex((candidate) => candidate.id === target.id);
          setHighlightedCommandIndex(nextIndex >= 0 ? nextIndex : 0);
        }
        return;
      }
      if (key.upArrow) {
        if (matches.length > 0) {
          setHighlightedCommandIndex((current) => (current - 1 + matches.length) % matches.length);
        }
        return;
      }
      if (key.downArrow) {
        if (matches.length > 0) {
          setHighlightedCommandIndex((current) => (current + 1) % matches.length);
        }
        return;
      }
      if (commandEditor.handleInput(input, key)) {
        return;
      }
      return;
    }

    if (input === "/" && actionContext) {
      setCommandMode(true);
      setCommandInput("");
      setHighlightedCommandIndex(0);
      return;
    }

    if (key.escape) {
      if (filterQuery.length > 0) {
        setFilterQuery("");
        return;
      }
      onCancel();
      return;
    }
    if (key.return) {
      const selected = filteredOptions[index];
      if (selected && !confirmed) {
        setConfirmed(true);
        setTimeout(() => onSubmit(selected.value), 150);
      }
      return;
    }
    if (key.upArrow && filteredOptions.length > 0) {
      setIndex((current) => (current - 1 + filteredOptions.length) % filteredOptions.length);
      return;
    }
    if (key.downArrow && filteredOptions.length > 0) {
      setIndex((current) => (current + 1) % filteredOptions.length);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      <Box flexDirection="column" flexGrow={1}>
        <Box flexDirection="column">
          <Text bold color={confirmed ? palette.ok : palette.text}>
            {confirmed ? "Selected" : title}
          </Text>
          <Text color={palette.muted}>{confirmed ? selectedLabel : subtitle}</Text>
        </Box>
        <InputField
          label="Filter"
          value={filterQuery}
          onChange={updateFilterQuery}
          placeholder="Type to narrow this list"
          focus={!commandMode}
          hint={actionContext ? "Type to filter · / opens commands" : undefined}
          onRedraw={clearShellScreen}
        />
        {tooSmall ? (
          <ResizeBlocker
            columns={viewport.columns}
            rows={viewport.rows}
            minColumns={minColumns}
            minRows={minRows}
          />
        ) : (
          <>
            <Text color={palette.dim} dimColor>
              {`${filteredOptions.length > 0 ? index + 1 : 0} of ${filteredOptions.length}`}
            </Text>
            <Box
              flexDirection={showCompanion ? "row" : "column"}
              marginTop={1}
              justifyContent="space-between"
            >
              <Box flexDirection="column" width={showCompanion ? listWidth : undefined}>
                {windowStart > 0 && <Text color={palette.dim}> ▲ ...</Text>}
                {visibleOptions.map((option) => {
                  const selected = option === selectedOption;
                  const isConfirmed = confirmed && selected;
                  const itemPrefix = isConfirmed ? "✓" : selected ? "▌" : " ";
                  const itemTone = isConfirmed
                    ? palette.ok
                    : selected
                      ? palette.accent
                      : palette.dim;
                  const secondary = option.detail
                    ? `  ${truncateLine(option.detail, Math.max(12, rowWidth - option.label.length - 4))}`
                    : "";
                  const rowText = truncateLine(`${option.label}${secondary}`, rowWidth - 2);
                  return (
                    <Box
                      key={`${option.label}-${option.detail ?? ""}`}
                      width={rowWidth}
                      backgroundColor={selected ? palette.accentFill : undefined}
                    >
                      <Text
                        color={selected || isConfirmed ? palette.text : palette.textDim}
                        bold={selected || isConfirmed}
                        dimColor={!selected && !isConfirmed}
                      >
                        <Text color={itemTone}>{`${itemPrefix} `}</Text>
                        {padColumnsEnd(rowText, rowWidth - 2)}
                      </Text>
                    </Box>
                  );
                })}
                {windowEnd < filteredOptions.length && <Text color={palette.dim}> ▼ ...</Text>}
              </Box>
              {!ultraCompact && showCompanion ? (
                <Box marginLeft={2} flexDirection="column" width={companionWidth}>
                  <LocalSection title="Current Selection" tone="success" marginTop={0}>
                    {showHeavyPoster ? (
                      <Box flexDirection="column" marginBottom={1}>
                        <Text>{poster.placeholder}</Text>
                      </Box>
                    ) : selectedOption?.previewImageUrl &&
                      (navigating || posterState === "loading") ? (
                      <Box marginBottom={1}>
                        <Text color={palette.muted} dimColor>
                          Loading artwork…
                        </Text>
                      </Box>
                    ) : null}
                    <Text bold color={palette.text}>
                      {truncateLine(selectedLabel, companionWidth)}
                    </Text>
                    <Box marginTop={1} flexDirection="column">
                      {detailLines.map((line) => (
                        <Text key={`detail-${selectedLabel}-${line}`} color={palette.muted}>
                          {line}
                        </Text>
                      ))}
                    </Box>
                  </LocalSection>
                </Box>
              ) : null}
            </Box>
          </>
        )}
      </Box>

      {commandMode && actionContext ? (
        <CommandPalette
          input={commandInput}
          cursor={commandEditor.cursor}
          commands={actionContext.commands}
          highlightedIndex={highlightedCommandIndex}
          maxVisible={getListShellCommandPaletteMaxVisible(
            viewport.rows,
            subtitle.split("\n").length,
          )}
          width={innerWidth}
        />
      ) : null}
      <ShellFooter
        taskLabel={`${footerTask}  ·  ${subtitle}`}
        actions={footerActions}
        mode={effectiveFooterMode}
        commandMode={commandMode}
      />
    </Box>
  );
}

export { openBrowseShell } from "./browse-shell";

// ─── StatsShell ─────────────────────────────────────────────────────────────

function StatsShell({
  statsService,
  statsFormatter,
  exportDir,
  onBack,
}: {
  statsService: import("@/domain/lists/StatsService").StatsService;
  statsFormatter: import("@/domain/lists/StatsFormatter").StatsFormatter;
  exportDir: string;
  onBack: () => void;
}) {
  const [tabIdx, setTabIdx] = useState(0);
  const [rangeIdx, setRangeIdx] = useState(0);
  const [kindIdx, setKindIdx] = useState(0);
  const [copiedFlash, setCopiedFlash] = useState<string | null>(null);
  const { cols, rows } = useShellDimensions();
  const innerWidth = Math.max(30, cols - 6);
  const available = rows - 4;

  const activeTab = statsTabFromIndex(tabIdx);
  const activeRange = statsRangeFromIndex(rangeIdx);
  const activeKind = statsKindFromIndex(kindIdx);
  const windowDays = activeRange === "all" ? 99_999 : activeRange === "7d" ? 7 : 30;
  const mediaKindFilter = activeKind === "all" ? undefined : activeKind;

  const stats = useMemo(
    () => statsService.getStats(windowDays, mediaKindFilter),
    [statsService, windowDays, mediaKindFilter],
  );
  const [statsWithGenres, setStatsWithGenres] = useState(stats);

  useEffect(() => {
    setStatsWithGenres(stats);
    let cancelled = false;
    void statsService.fetchGenreBreakdown(windowDays, mediaKindFilter).then((breakdown) => {
      if (cancelled) return undefined;
      setStatsWithGenres(statsService.applyGenreBreakdown(stats, breakdown));
      return undefined;
    });
    return () => {
      cancelled = true;
    };
  }, [stats, statsService, windowDays, mediaKindFilter]);

  const view = useMemo(
    () =>
      buildStatsView({
        stats: statsWithGenres,
        statsFormatter,
        tab: activeTab,
        range: activeRange,
        kind: activeKind,
        innerWidth,
        availableRows: available,
      }),
    [statsWithGenres, statsFormatter, activeTab, activeRange, activeKind, innerWidth, available],
  );

  useInput((input, key) => {
    if (key.ctrl && (input === "c" || input === "\x03")) {
      requestHardExit(0);
      return;
    }
    if (key.escape || input === "q") {
      onBack();
      return;
    }
    if (key.leftArrow) {
      setTabIdx((i) => (i + STATS_TABS.length - 1) % STATS_TABS.length);
      return;
    }
    if (key.rightArrow) {
      setTabIdx((i) => (i + 1) % STATS_TABS.length);
      return;
    }
    if (key.tab && key.shift) {
      setKindIdx((i) => (i + 1) % STATS_KINDS.length);
      return;
    }
    if (key.tab) {
      setRangeIdx((i) => (i + 1) % STATS_RANGES.length);
      return;
    }
    if (input === "1") setRangeIdx(0);
    else if (input === "2") setRangeIdx(1);
    else if (input === "3") setRangeIdx(2);
    else if (input === "s") {
      const shareText = [
        statsFormatter.formatSummaryLine(stats),
        statsFormatter.formatWeeklyDigest(stats),
        "",
        statsFormatter.formatTopShows(stats.topShows.slice(0, 5)),
      ]
        .join("\n")
        .trim();
      void (async () => {
        const ok = await copyToClipboard(shareText);
        setCopiedFlash(ok ? "Copied to clipboard!" : "Copy failed — clipboard tool not found");
        setTimeout(() => setCopiedFlash(null), 2_000);
      })();
    } else if (input === "e") {
      void (async () => {
        const dir = join(exportDir, "stats");
        await mkdir(dir, { recursive: true });
        const stamp = new Date().toISOString().slice(0, 10);
        const base = `kunai-stats-${stamp}`;
        const jsonPath = join(dir, `${base}.json`);
        const csvPath = join(dir, `${base}.csv`);
        await Bun.write(jsonPath, statsService.exportStatsJson(windowDays, mediaKindFilter));
        await Bun.write(csvPath, statsService.exportStatsCsv(windowDays, mediaKindFilter));
        setCopiedFlash(`Exported to ${dir}`);
        setTimeout(() => setCopiedFlash(null), 3_000);
      })();
    }
  });

  const metricsPairs: {
    left: (typeof view.metrics)[number] | null;
    right: (typeof view.metrics)[number] | null;
  }[] = [];
  for (let i = 0; i < view.metrics.length; i += 2) {
    metricsPairs.push({ left: view.metrics[i] ?? null, right: view.metrics[i + 1] ?? null });
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between" alignItems="flex-start">
        <ClaudeTabRow labels={view.tabLabels} activeIndex={view.tabIndex} />
        <SegmentedControl
          labels={view.rangeLabels}
          activeIndex={view.rangeIndex}
          activeFg={palette.text}
          activeBg={palette.accentFill}
        />
      </Box>

      <Box marginBottom={1}>
        <SegmentedControl
          labels={view.kindLabels}
          activeIndex={view.kindIndex}
          activeFg={palette.text}
          activeBg={palette.accentFill}
        />
      </Box>

      {view.state === "empty" ? (
        <Box marginTop={1} flexDirection="column">
          <Text bold color={palette.text}>
            No watch stats yet
          </Text>
          <Text color={palette.muted}>Watch an episode and Kunai will build your rhythm here.</Text>
        </Box>
      ) : (
        <>
          <Box marginTop={1} flexDirection="column">
            {view.streakHero ? (
              <Text>
                <Text color={palette.accentDeep}>{"🔥 " + view.streakHero}</Text>
                {view.streakDetail ? (
                  <Text color={palette.muted}>{" · " + view.streakDetail}</Text>
                ) : null}
              </Text>
            ) : (
              <Text color={palette.muted}>{view.streakDetail}</Text>
            )}
            <Text color={palette.dim}>{view.weeklyLine}</Text>
          </Box>

          {view.tab === "overview" ? (
            <>
              {(() => {
                const heatmap = view.heatmap;
                if (!heatmap) return null;
                return (
                  <Box marginTop={1} flexDirection="column">
                    <Box>
                      <Text color={palette.dim}>{"    "}</Text>
                      {heatmap.grid.map((week) => {
                        const monthEntry = heatmap.monthLabels.find(
                          (m) => m.weekStartDate === week.weekStartDate,
                        );
                        return (
                          <Text key={`month-${week.weekStartDate}`} color={palette.dim}>
                            {(monthEntry?.label ?? " ") + " "}
                          </Text>
                        );
                      })}
                    </Box>
                    {heatmap.dayLabels.map((dayLabel, dayIdx) => {
                      const firstCellDate = heatmap.grid.find((week) => week.cells[dayIdx])?.cells[
                        dayIdx
                      ]?.date;
                      return (
                        <Box key={`dow-${dayLabel || firstCellDate || "blank"}`}>
                          <Text color={palette.dim}>{(dayLabel || "  ").padEnd(4)}</Text>
                          {heatmap.grid.map((week) => {
                            const cell = week.cells[dayIdx];
                            return (
                              <Text
                                key={cell?.date ?? `${week.weekStartDate}:empty`}
                                color={cell?.color ?? palette.dim}
                              >
                                {(cell?.char ?? " ") + " "}
                              </Text>
                            );
                          })}
                        </Box>
                      );
                    })}
                    <Box marginTop={1}>
                      <Text color={palette.muted}>Less </Text>
                      {heatmap.legend.slice(1).map((entry) => (
                        <Text key={`legend-${entry.color}:${entry.char}`} color={entry.color}>
                          {entry.char}
                        </Text>
                      ))}
                      <Text color={palette.muted}> More · hue = what you watched</Text>
                    </Box>
                  </Box>
                );
              })()}

              {view.typeBreakdownBar.length > 0 ? (
                <Box marginTop={1} flexDirection="column">
                  <Text color={palette.muted}>{view.typeBreakdownTitle}</Text>
                  <Box>
                    {view.typeBreakdownBar.map((segment) => (
                      <Text
                        key={segment.color}
                        color={segment.color}
                        backgroundColor={segment.color}
                      >
                        {"█".repeat(Math.max(1, Math.round((segment.widthPct / 100) * 24)))}
                      </Text>
                    ))}
                  </Box>
                  {view.typeBreakdownLabel ? (
                    <Text color={palette.dim}>{view.typeBreakdownLabel}</Text>
                  ) : null}
                </Box>
              ) : null}

              <Box marginTop={1} flexDirection="column">
                {metricsPairs.map((pair) => (
                  <Box key={pair.left?.label ?? pair.right?.label ?? "metric-row"}>
                    <Box width={Math.floor(innerWidth / 2)}>
                      {pair.left ? (
                        <>
                          <Text color={palette.muted}>{pair.left.label.padEnd(18)}</Text>
                          <Text bold color={palette.text}>
                            {pair.left.value}
                            {pair.left.suffix ? (
                              <Text color={palette.muted}>{pair.left.suffix}</Text>
                            ) : null}
                          </Text>
                        </>
                      ) : null}
                    </Box>
                    <Box width={Math.floor(innerWidth / 2)}>
                      {pair.right ? (
                        <>
                          <Text color={palette.muted}>{pair.right.label.padEnd(18)}</Text>
                          <Text bold color={palette.text}>
                            {pair.right.value}
                            {pair.right.suffix ? (
                              <Text color={palette.muted}>{pair.right.suffix}</Text>
                            ) : null}
                          </Text>
                        </>
                      ) : null}
                    </Box>
                  </Box>
                ))}
              </Box>

              {view.comparisonLine ? (
                <Box marginTop={1}>
                  <Text color={palette.ok}>{view.comparisonLine}</Text>
                </Box>
              ) : null}
            </>
          ) : null}

          {view.tab === "insights" ? (
            <Box marginTop={1} flexDirection="column">
              {view.insights.map((row) => (
                <Box key={row.label}>
                  <Text color={palette.muted}>{row.label.padEnd(18)}</Text>
                  <Text bold color={palette.text}>
                    {row.value}
                  </Text>
                  {row.detail ? <Text color={palette.dim}>{" · " + row.detail}</Text> : null}
                </Box>
              ))}
              {view.genreRows.length > 0 ? (
                <Box marginTop={1} flexDirection="column">
                  <Text color={palette.muted}>Top genres</Text>
                  {view.genreRows.map((genre) => (
                    <Box key={genre.label}>
                      <Text color={palette.text}>{genre.label}</Text>
                      <Text color={palette.dim}>{"  "}</Text>
                      <Text color={palette.accentDeep}>{genre.barFilled}</Text>
                      <Text color={palette.dim}>{genre.barEmpty}</Text>
                      <Text color={palette.dim}>{`  ${genre.durationLabel}`}</Text>
                    </Box>
                  ))}
                  {view.genreAffinityNote ? (
                    <Text color={palette.dim}>{view.genreAffinityNote}</Text>
                  ) : null}
                </Box>
              ) : (
                <Box marginTop={1}>
                  <Text color={palette.dim}>
                    Genre affinity unavailable offline or without TMDB ids.
                  </Text>
                </Box>
              )}
            </Box>
          ) : null}

          {view.tab === "titles" || view.tab === "overview" ? (
            view.topTitles.length > 0 ? (
              <Box marginTop={1} flexDirection="column">
                <Text color={palette.muted}>Top titles</Text>
                {view.topTitles.map((show) => (
                  <Box key={show.titleId}>
                    <Text color={palette.text}>{show.title}</Text>
                    <Text color={palette.dim}>{"  "}</Text>
                    <Text color={palette.accentDeep}>{show.barFilled}</Text>
                    <Text color={palette.dim}>{show.barEmpty}</Text>
                    <Text color={palette.dim}>{`  ${show.meta}`}</Text>
                  </Box>
                ))}
              </Box>
            ) : null
          ) : null}
        </>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text color={palette.dim}>{"─".repeat(Math.min(innerWidth, cols - 4))}</Text>
        {copiedFlash ? (
          <Box marginTop={1}>
            <Text color={copiedFlash.startsWith("Copied") ? palette.ok : palette.danger}>
              {copiedFlash}
            </Text>
          </Box>
        ) : (
          <Box marginTop={1}>
            <Text color={palette.dim}>{view.footerHints}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function TextInputShell({
  title,
  subtitle,
  initialValue,
  placeholder,
  label,
  onSubmit,
  onCancel,
}: {
  title: string;
  subtitle: string;
  initialValue: string;
  placeholder?: string;
  label: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const { cols } = useShellDimensions();
  const clearTextInputScreen = useCallback(() => {
    clearShellScreenArtifacts();
  }, []);

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      <Box flexDirection="column" flexGrow={1}>
        <Text bold color={palette.text}>
          {title}
        </Text>
        <Text color={palette.muted}>{truncateLine(subtitle, Math.max(20, cols - 6))}</Text>
        <InputField
          label={label}
          value={value}
          onChange={setValue}
          placeholder={placeholder}
          hint="Enter confirms · Esc cancels"
          onSubmit={(nextValue) => {
            const normalized = nextValue.trim();
            if (normalized.length > 0) {
              onSubmit(normalized);
            }
          }}
          onRedraw={clearTextInputScreen}
          focus
        />
      </Box>
      <ShellFooter
        taskLabel="Enter a name and press Return to confirm"
        actions={[
          { key: "enter", label: "confirm", primary: true },
          { key: "esc", label: "cancel", action: "quit" },
        ]}
        mode="minimal"
      />
    </Box>
  );
}

export function openTextInputShell({
  title,
  subtitle,
  initialValue = "",
  placeholder,
  label = "Name",
}: {
  title: string;
  subtitle: string;
  initialValue?: string;
  placeholder?: string;
  label?: string;
}): Promise<string | null> {
  const session = mountRootContent<string | null>({
    kind: "picker",
    renderContent: (finish) => (
      <TextInputShell
        title={title}
        subtitle={subtitle}
        initialValue={initialValue}
        placeholder={placeholder}
        label={label}
        onSubmit={(value) => finish(value)}
        onCancel={() => finish(null)}
      />
    ),
    fallbackValue: null,
  });
  return session.result;
}

export function openStatsShell(container: Container): Promise<void> {
  const session = mountRootContent<undefined>({
    kind: "picker",
    renderContent: (finish) => (
      <StatsShell
        statsService={container.statsService}
        statsFormatter={container.statsFormatter}
        exportDir={container.dataDir}
        onBack={() => finish(undefined)}
      />
    ),
    fallbackValue: undefined,
  });
  return session.result;
}

export function openListShell<T>({
  title,
  subtitle,
  options,
  initialFilter,
  initialSelectedIndex,
  actionContext,
}: {
  title: string;
  subtitle: string;
  options: readonly ShellOption<T>[];
  initialFilter?: string;
  initialSelectedIndex?: number;
  actionContext?: ListShellActionContext;
}): Promise<T | null> {
  let filterQuery = initialFilter ?? "";
  let selectedIndex = initialSelectedIndex ?? 0;

  const run = async (): Promise<T | null> => {
    while (true) {
      const session = mountRootContent<ListShellSubmitResult<T>>({
        kind: "picker",
        renderContent: (finish) => (
          <ListShell
            title={title}
            subtitle={subtitle}
            options={options}
            initialFilter={filterQuery}
            initialSelectedIndex={selectedIndex}
            actionContext={actionContext}
            onSubmit={(value) => finish({ type: "selected", value })}
            onCancel={() => finish({ type: "cancelled" })}
            onAction={(action) => finish(action)}
          />
        ),
        fallbackValue: { type: "cancelled" },
      });

      const result = await session.result;
      if (result.type === "selected") return result.value;
      if (result.type === "cancelled") return null;

      const actionResult = await Promise.resolve(
        actionContext?.onAction(result.action) ?? "unhandled",
      );
      if (actionResult === "quit") {
        requestHardExit(0);
      }
      filterQuery = result.filterQuery;
      selectedIndex = result.selectedIndex;
    }
  };

  return run();
}
