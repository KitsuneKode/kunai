import { useLineEditor } from "@/app-shell/line-editor";
import type { ListShellActionContext, ShellOption } from "@/app-shell/pickers/list-shell-types";
import { formatPlaybackSessionKeysHint } from "@/app-shell/playback-session-key-hints";
import { switchSessionMode } from "@/app/mode-switch";
import {
  buildPlaybackBootstrapPresentation,
  formatBootstrapInventorySummary,
} from "@/app/playback-bootstrap-presenter";
import { buildPlaybackEpisodePickerOptions } from "@/app/playback-episode-picker";
import {
  formatPlaybackSessionFactsStrip,
  formatPlaybackSourceLine,
  isCurrentStreamSelection,
  streamSelectionFromTrackPick,
} from "@/app/source-quality";
import {
  compactPlaybackSubtitleStatus,
  describePlaybackSubtitleStatus,
} from "@/app/subtitle-status";
import type { Container } from "@/container";
import { effectiveFooterHints } from "@/container";
import { mediaLanguageProfileFor, showsEpisodeLabel } from "@/domain/media/content-kind";
import { toErrorScenario } from "@/domain/playback/playback-problem";
import {
  describePlaybackTelemetrySnapshot,
  type PlaybackTelemetrySnapshot,
} from "@/domain/playback/playback-telemetry-snapshot";
import type { DecodedTrackSelection } from "@/domain/playback/track-capabilities";
import type { SessionStateManager } from "@/domain/session/SessionStateManager";
import { isKittyCompatible } from "@/image";
import { copyToClipboard } from "@/infra/clipboard";
import { peekTitleDetail } from "@/services/catalog/TitleDetailService";
import { buildRuntimeHealthSnapshot } from "@/services/diagnostics/runtime-health";
import { Box, Text, render, useInput } from "ink";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { dispatchAppCommand } from "./app-command-dispatcher";
import { COMMAND_CONTEXTS, resolveCommandContext } from "./commands";
import { recordRender } from "./diagnostics/render-trace";
import { ExitShell } from "./exit-shell";
import { registerExitHandler, requestHardExit } from "./graceful-exit";
import { useSettledValue } from "./hooks/use-settled-value";
import { deleteAllKittyImages, usePosterSurfaceBoundaryCleanup } from "./image-pane";
import { getPickerChromeRows, getPickerLayout, getPickerListMaxVisible } from "./layout-policy";
import { LoadingShell } from "./loading-shell";
import {
  createNotificationQueueState,
  NOTIFICATION_TOAST_TTL_MS,
  syncNotificationQueueFromActive,
  tickNotificationQueue,
  type NotificationPriority,
} from "./notification-queue";
import { buildPlaybackFailureWaterfall } from "./playback-failure-waterfall";
import { resolveNextEpisodeThumbUrl } from "./playback-playing-view";
import { clearPlaybackShellError, peekPlaybackShellError } from "./playback-shell-error-capture";
import { buildPostPlayFooterActions } from "./post-play-footer-actions";
import { PostPlayShell } from "./post-play-shell";
import {
  buildPostPlayView,
  isPostPlayPlaybackRestartResult,
  resolvePostPlayUnhandledInput,
  resolvePostPlayMenuAction,
} from "./post-play-view";
import { AppHeader } from "./primitives/AppHeader";
import { ClaudeTabRow } from "./primitives/ClaudeTabRow";
import { SegmentedControl } from "./primitives/SegmentedControl";
import {
  clearRootContentSession,
  mountRootContent,
  useRootContentSession,
} from "./root-content-state";
import { getRootOverlayResetKey } from "./root-overlay-model";
import { RootOverlayShell } from "./root-overlay-shell";
import { getRootOwnedOverlay, resolveRootShellSurface } from "./root-shell-state";
import { ErrorShell, RootIdleShell } from "./root-status-shells";
import { buildRootStatusSummary, type SyncHealth } from "./root-status-summary";
import { openSessionPicker } from "./session-picker";
import {
  fallbackCommandState,
  getCommandAutocompleteTarget,
  getCommandMatches,
  getHighlightedCommand,
  getListShellCommandPaletteMaxVisible,
  shouldHideCompanionForCommandPalette,
} from "./shell-command-model";
import { CommandPalette } from "./shell-command-ui";
import { InputField, ShellFrame } from "./shell-frame";
import { LocalSection, ResizeBlocker, ShellFooter, TransientRowSlot } from "./shell-primitives";
import { getWindowStart, padColumnsEnd, truncateLine, wrapText } from "./shell-text";
import { APP_LABEL, palette, statusColor } from "./shell-theme";
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
  type ShellFooterMode,
  type PlaybackShellState,
  type PlaybackShellResult,
  type ShellAction,
  type ShellStatusTone,
} from "./types";
import { usePosterPreview } from "./use-poster-preview";
import { useSessionSelector } from "./use-session-selector";
import { useTerminalResizeCleanup } from "./use-terminal-resize-cleanup";
import { useDebouncedViewportPolicy, useShellDimensions } from "./use-viewport-policy";

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
  if (process.stdout.isTTY) {
    deleteAllKittyImages();
  }
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
    const { resolveTracksPanelPick } = await import("@/app/tracks-panel-pick");
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
  const playbackSubtitle =
    state.currentEpisode && showsEpisodeLabel(state.currentTitle)
      ? `S${String(state.currentEpisode.season).padStart(2, "0")}E${String(
          state.currentEpisode.episode,
        ).padStart(2, "0")}`
      : undefined;
  const playbackSubtitleStatus = describePlaybackSubtitleStatus(
    state.stream,
    mediaLanguageProfileFor(state).subtitle,
  );
  const visiblePresenceBootLine = presenceProvider === "discord" ? presenceBootLine : null;
  const currentViewLabel =
    state.playbackStatus === "loading" || playbackIsActive
      ? "playback"
      : rootContent?.kind === "picker"
        ? "picker"
        : rootContent?.kind === "browse" || rootContent?.kind === "playback"
          ? rootContent.kind
          : state.view;
  const headerDestination =
    currentViewLabel === "playback"
      ? "Now Playing"
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
        recentEvents: container.diagnosticsStore.getRecent(40),
      }),
    [state.playbackStatus, state.playbackDetail, container.diagnosticsStore],
  );
  const playbackFailureWaterfall = useMemo(
    () =>
      state.playbackStatus === "error"
        ? buildPlaybackFailureWaterfall({
            state,
            recentEvents: container.diagnosticsStore.getRecent(40),
          })
        : null,
    [state, container.diagnosticsStore],
  );
  const playbackBootstrapStageDetail = useMemo(() => {
    const base =
      playbackBootstrapPresentation.stageDetail ?? state.playbackDetail?.trim() ?? undefined;
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
    playbackBootstrapPresentation.stageDetail,
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
          {rootSurface === "error" ? (
            <ErrorShell
              message={state.playbackError || "An unknown error occurred"}
              scenario={toErrorScenario(state.playbackProblem, {
                providerName: activeProvider?.metadata.name ?? state.provider,
                title: state.currentTitle?.name,
                resolveRetryCount: state.resolveRetryCount,
              })}
              waterfall={playbackFailureWaterfall}
              debugEnabled={Boolean(container.debugTracePath)}
              debugError={peekPlaybackShellError()}
              onResolve={() => {
                clearPlaybackShellError();
                stateManager.dispatch({ type: "CLEAR_PLAYBACK_PROBLEM" });
                stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
              }}
              onRetry={() => {
                clearPlaybackShellError();
                stateManager.dispatch({ type: "CLEAR_PLAYBACK_PROBLEM" });
                stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "loading" });
              }}
            />
          ) : rootSurface === "playback" ? (
            <LoadingShell
              key={`playback-ep-${state.currentTitle?.id ?? "none"}:${state.currentEpisode?.season ?? 0}:${state.currentEpisode?.episode ?? 0}`}
              state={{
                title: state.currentTitle?.name || "Resolving...",
                subtitle: playbackSubtitle,
                operation: playbackBootstrapPresentation.operation,
                stage: playbackBootstrapPresentation.stage,
                stageDetail: playbackBootstrapStageDetail,
                dominantPhaseLabel: playbackBootstrapPresentation.dominantPhaseLabel,
                details: state.playbackDetail ?? `Provider: ${state.provider}`,
                providerName: activeProvider?.metadata.name ?? state.provider,
                providerId: state.provider,
                subtitleStatus:
                  state.playbackStatus === "playing" ||
                  state.playbackStatus === "buffering" ||
                  state.playbackStatus === "seeking" ||
                  state.playbackStatus === "stalled"
                    ? playbackSubtitleStatus
                    : undefined,
                downloadStatus: downloadStatus ?? undefined,
                cancellable: playbackCanCancel,
                trace: playbackTrace,
                showMemory: container.config.showMemory,
                posterUrl: state.currentTitle?.posterUrl,
                getRuntimeHealth: () =>
                  state.playbackStatus === "playing" ||
                  state.playbackStatus === "buffering" ||
                  state.playbackStatus === "seeking" ||
                  state.playbackStatus === "stalled"
                    ? buildRuntimeHealthSnapshot({
                        recentEvents: container.diagnosticsStore.getRecent(25),
                        currentProvider: state.provider,
                      }).network
                    : buildRuntimeHealthSnapshot({
                        recentEvents: container.diagnosticsStore.getRecent(25),
                        currentProvider: state.provider,
                      }).provider,
                fallbackAvailable: Boolean(fallbackProvider),
                fallbackProviderName:
                  fallbackProvider?.metadata.name ?? fallbackProvider?.metadata.id,
                hasStreamCandidates,
                autoskipPaused: state.autoskipSessionPaused,
                autoplayPaused: state.autoplaySessionPaused,
                isSeriesPlayback,
                latestIssue: state.playbackNote,
                currentPosition: activePlaybackTelemetrySnapshot?.positionSeconds,
                duration: activePlaybackTelemetrySnapshot?.durationSeconds,
                bufferHealth:
                  state.playbackStatus === "stalled"
                    ? "stalled"
                    : state.playbackStatus === "buffering" ||
                        activePlaybackTelemetrySnapshot?.pausedForCache
                      ? "buffering"
                      : activePlaybackTelemetrySnapshot
                        ? "healthy"
                        : undefined,
                playbackSourceLine: formatPlaybackSourceLine(state.stream) ?? undefined,
                playbackFactsStrip:
                  state.playbackStatus === "playing" ||
                  state.playbackStatus === "buffering" ||
                  state.playbackStatus === "seeking" ||
                  state.playbackStatus === "stalled"
                    ? formatPlaybackSessionFactsStrip({
                        stream: state.stream,
                        autoplayPaused: state.autoplaySessionPaused,
                        autoskipPaused: state.autoskipSessionPaused,
                        canToggleAutoplay,
                        stopAfterCurrent: state.stopAfterCurrent,
                        isSeries: state.currentTitle?.type === "series",
                      })
                    : undefined,
                playbackKeysHint:
                  state.playbackStatus === "playing" ||
                  state.playbackStatus === "buffering" ||
                  state.playbackStatus === "seeking" ||
                  state.playbackStatus === "stalled"
                    ? formatPlaybackSessionKeysHint({
                        stream: state.stream,
                        autoplayPaused: state.autoplaySessionPaused,
                        autoskipPaused: state.autoskipSessionPaused,
                        canToggleAutoplay,
                        stopAfterCurrent: state.stopAfterCurrent,
                        isSeries: state.currentTitle?.type === "series",
                        hasNextEpisode: canGoNext,
                        hasPreviousEpisode: canGoPrevious,
                      })
                    : undefined,
                commands: resolveCommandContext(state, "activePlayback"),
                footerMode: effectiveFooterHints(container),
                qualityLabel: (() => {
                  const result = state.stream?.providerResolveResult;
                  const selected = result?.streams.find(
                    (candidate) => candidate.id === result.selectedStreamId,
                  );
                  return selected?.qualityLabel ?? selected?.container;
                })(),
                audioTrack: state.stream?.audioLanguages?.length
                  ? state.stream.audioLanguages.join(", ")
                  : undefined,
                subtitleTrack: compactPlaybackSubtitleStatus(playbackSubtitleStatus),
                nextEpisodeLabel: state.episodeNavigation.nextLabel,
                previousEpisodeLabel: state.episodeNavigation.previousLabel,
                hasNextEpisode: state.episodeNavigation.hasNext,
                hasPreviousEpisode: state.episodeNavigation.hasPrevious,
                // Up next = the next episode, else the Up Next queue head (a queued
                // title that will auto-play when this one finishes).
                upNextLabel: state.episodeNavigation.hasNext
                  ? state.episodeNavigation.nextLabel
                  : (() => {
                      const queued = container.queueService.peekNext();
                      if (!queued) return undefined;
                      const code =
                        queued.season && queued.episode
                          ? ` · S${String(queued.season).padStart(2, "0")}E${String(queued.episode).padStart(2, "0")}`
                          : "";
                      return `${queued.title}${code}`;
                    })(),
                titleDetail: playingTitleDetail,
                nextEpisodeThumbUrl: playingNextEpisodeThumbUrl,
                episodeLabel:
                  state.currentEpisode && state.currentTitle?.type === "series"
                    ? `S${String(state.currentEpisode.season).padStart(2, "0")}E${String(state.currentEpisode.episode).padStart(2, "0")}`
                    : undefined,
                currentSeason: state.currentEpisode?.season,
                onCommandAction: onCommandAction,
              }}
              onCancel={onCancel}
              onStop={onStop}
              onNext={canGoNext ? onNextHandler : undefined}
              onPrevious={canGoPrevious ? onPreviousHandler : undefined}
              onRecover={onRecover}
              onFallback={onFallback}
              onPickStreams={onPickStreams}
              onPickEpisode={state.currentTitle?.type === "series" ? onPickEpisode : undefined}
              onReloadSubtitles={onReloadSubtitles}
              onSkipSegment={onSkipSegment}
              onToggleAutoplay={canToggleAutoplay ? onToggleAutoplay : undefined}
              onToggleAutoskip={onToggleAutoskip}
              onStopAfterCurrent={canStopAfterCurrent ? onStopAfterCurrent : undefined}
              onPickSource={onPickSource}
              onPickQuality={onPickQuality}
              onReturnToSearch={onReturnToSearch}
            />
          ) : rootSurface === "root-content" && rootContent ? (
            <Box key={rootContent.id} flexGrow={1}>
              {rootContent.element}
            </Box>
          ) : rootSurface === "root-overlay" && rootOverlay ? (
            <RootOverlayShell
              key={getRootOverlayResetKey(rootOverlay)}
              overlay={rootOverlay}
              state={state}
              container={container}
              onRedraw={clearShellScreen}
            />
          ) : (
            <RootIdleShell state={state} />
          )}
        </Box>

        {rootSurface === "root-content" && rootOverlay ? (
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

function PlaybackShell({
  container,
  state,
  onResolve,
}: {
  container: Container;
  state: PlaybackShellState;
  onResolve: (result: PlaybackShellResult) => void;
}) {
  usePosterSurfaceBoundaryCleanup(true);
  const playbackViewport = useDebouncedViewportPolicy("playback");
  const overlayBlocksInput = useSessionSelector(
    container.stateManager,
    (session) => session.activeModals.length > 0,
    (left, right) => left === right,
  );
  // Live per-second countdown so the Next-Up hero ticks during auto-next.
  const autoNextCountdownSeconds = useSessionSelector(
    container.stateManager,
    (session) => session.autoNextCountdownSeconds,
    (left, right) => left === right,
  );
  const watchTimeSummary = useSessionSelector(
    container.stateManager,
    (session) => session.watchTimeSummary,
    (left, right) => left === right,
  );
  const commands = state.commands ?? fallbackCommandState(COMMAND_CONTEXTS.postPlayback);
  const postPlayState = state.postPlayState ?? { kind: "mid-series" as const };
  const canResume = Boolean(state.resumeLabel);
  const footerActions = buildPostPlayFooterActions(postPlayState, {
    canResume,
    autoplayPaused: state.autoplayPaused,
    autoskipPaused: state.autoskipPaused,
    stopAfterCurrent: state.stopAfterCurrent,
  });
  const contextStrip = [
    "post-play",
    state.provider,
    state.episodeLabel,
    state.mode === "anime" ? "anime" : null,
  ]
    .filter((item): item is string => Boolean(item))
    .join("  ·  ");
  const recommendations = state.recommendationRailItems ?? [];
  const postPlayView = buildPostPlayView({
    title: state.title,
    episodeLabel: state.episodeLabel ?? "",
    nextEpisodeLabel: state.nextEpisodeLabel,
    queueNextLabel: state.queueNextLabel,
    resumeLabel: state.resumeLabel,
    postPlayState,
    recommendations,
    totalEpisodes: state.totalEpisodes,
    watchedEpisodes: state.watchedEpisodes,
    currentSeason: state.currentSeason ?? state.season,
    titleDetail: state.titleDetail,
    autoplayPaused: state.autoplayPaused,
    autoskipPaused: state.autoskipPaused,
    stopAfterCurrent: state.stopAfterCurrent,
  });
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  // Reset the highlighted action when the post-play context changes. Done inline
  // during render with a prev-key compare (React's "adjust state on prop change"
  // pattern) rather than a useEffect, which would commit a stale selection first
  // and force an extra render. See react.dev/learn/you-might-not-need-an-effect.
  const postPlayResetKey = `${postPlayState.kind}|${state.episodeLabel ?? ""}|${state.resumeLabel ?? ""}`;
  const [prevPostPlayResetKey, setPrevPostPlayResetKey] = useState(postPlayResetKey);
  if (postPlayResetKey !== prevPostPlayResetKey) {
    setPrevPostPlayResetKey(postPlayResetKey);
    setSelectedActionIndex(0);
  }

  const openInlineTracks = useCallback(
    async (initialSection: DecodedTrackSelection["section"]) => {
      const stream = container.stateManager.getState().stream;
      if (!stream) {
        onResolve("source");
        return;
      }
      const { openTracksPanel } = await import("./workflows");
      const picked = await openTracksPanel(stream, { initialSection }, container);
      if (picked) {
        onResolve({ type: "track-selection", pick: picked });
      }
    },
    [container, onResolve],
  );

  const resolvePostPlayAction = useCallback(
    (result: PlaybackShellResult) => {
      if (
        result === "source" ||
        result === "quality" ||
        result === "audio" ||
        result === "subtitle"
      ) {
        void openInlineTracks(
          result === "source"
            ? "source"
            : result === "quality"
              ? "quality"
              : result === "audio"
                ? "audio"
                : "subtitle",
        );
        return;
      }
      // Flip to the playback surface before unmounting post-play so the root shell
      // never flashes the idle/home screen between menu close and resolve restart.
      if (isPostPlayPlaybackRestartResult(result)) {
        container.stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "loading" });
        container.stateManager.dispatch({
          type: "SET_PLAYBACK_FEEDBACK",
          detail: result === "resume" ? "Resuming playback" : "Preparing playback",
        });
      }
      onResolve(result);
    },
    [container.stateManager, onResolve, openInlineTracks],
  );

  const runSelectedPostPlayAction = useCallback(() => {
    const action = postPlayView.actions[selectedActionIndex];
    if (!action) return;
    const resolved = resolvePostPlayMenuAction(action);
    if (resolved) {
      resolvePostPlayAction(resolved);
    }
  }, [resolvePostPlayAction, postPlayView.actions, selectedActionIndex]);

  return (
    <ShellFrame
      eyebrow={APP_LABEL}
      title={state.title}
      subtitle={contextStrip}
      status={state.status}
      footerTask="Post-play"
      footerActions={footerActions}
      footerMode="minimal"
      commands={commands}
      inputLocked={overlayBlocksInput}
      escapeAction="back-to-results"
      onUnhandledInput={(input, key) => {
        // No overlay re-check here: ShellFrame already suppresses onUnhandledInput
        // while `inputLocked` (= overlayBlocksInput) is set — proven by
        // shell-frame-input-bridge.test.tsx. The resolver below still receives
        // `blockedByOverlay` as a defensive pure-function guard for direct callers.
        if (key.upArrow || input === "k") {
          setSelectedActionIndex((index) => Math.max(0, index - 1));
          return;
        }
        if (key.downArrow || input === "j") {
          setSelectedActionIndex((index) =>
            Math.min(Math.max(0, postPlayView.actions.length - 1), index + 1),
          );
          return;
        }
        const resolved = resolvePostPlayUnhandledInput(input, key, {
          blockedByOverlay: overlayBlocksInput,
          postPlayStateKind: postPlayState.kind,
          selectedActionAvailable: postPlayView.actions[selectedActionIndex] !== undefined,
          recommendationCount: recommendations.length,
        });
        if (!resolved) return;
        if (resolved.type === "run-selected-action") {
          runSelectedPostPlayAction();
          return;
        }
        if (resolved.type === "recommendation") {
          const item = recommendations[resolved.index];
          if (item) onResolve({ type: "play-recommendation", item });
          return;
        }
        if (resolved.type === "recommendation-actions") {
          const item = recommendations[resolved.index];
          if (item) onResolve({ type: "open-recommendation-actions", items: [item] });
          return;
        }
        if (resolved.result === "source") {
          void openInlineTracks("source");
          return;
        }
        onResolve(resolved.result);
      }}
      onResolve={resolvePostPlayAction}
    >
      {playbackViewport.tooSmall ? (
        <ResizeBlocker
          columns={playbackViewport.columns}
          rows={playbackViewport.rows}
          minColumns={playbackViewport.minColumns}
          minRows={playbackViewport.minRows}
          message="Resize terminal for post-play controls"
        />
      ) : (
        <PostPlayShell
          title={state.title}
          episodeLabel={state.episodeLabel ?? ""}
          nextEpisodeLabel={state.nextEpisodeLabel}
          queueNextLabel={state.queueNextLabel}
          resumeLabel={state.resumeLabel}
          postPlayState={postPlayState}
          recommendations={recommendations}
          totalEpisodes={state.totalEpisodes}
          watchedEpisodes={state.watchedEpisodes}
          currentSeason={state.currentSeason ?? state.season}
          posterUrl={state.posterUrl}
          nextEpisodeThumbUrl={state.nextEpisodeThumbUrl}
          titleDetail={state.titleDetail}
          autoplayPaused={state.autoplayPaused}
          autoskipPaused={state.autoskipPaused}
          stopAfterCurrent={state.stopAfterCurrent}
          selectedActionIndex={selectedActionIndex}
          autoNextCountdownSeconds={autoNextCountdownSeconds ?? undefined}
          watchTimeSummary={watchTimeSummary ?? undefined}
        />
      )}
    </ShellFrame>
  );
}

export function openPlaybackShell({
  state,
  container,
}: {
  state: PlaybackShellState;
  container: Container;
}): Promise<PlaybackShellResult> {
  const session = mountRootContent<PlaybackShellResult>({
    kind: "playback",
    renderContent: (finish) => (
      <PlaybackShell container={container} state={state} onResolve={finish} />
    ),
    fallbackValue: "quit",
  });

  return session.result;
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
    <Box flexDirection="column" paddingX={1}>
      <Box flexDirection="column">
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
                      backgroundColor={selected ? palette.surfaceActive : undefined}
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
  onBack,
}: {
  statsService: import("@/domain/lists/StatsService").StatsService;
  statsFormatter: import("@/domain/lists/StatsFormatter").StatsFormatter;
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

  const view = useMemo(
    () =>
      buildStatsView({
        stats,
        statsFormatter,
        tab: activeTab,
        range: activeRange,
        kind: activeKind,
        innerWidth,
        availableRows: available,
      }),
    [stats, statsFormatter, activeTab, activeRange, activeKind, innerWidth, available],
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
                  <Text color={palette.muted}>This watch year</Text>
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

          {view.topTitles.length > 0 ? (
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

export function openStatsShell(container: Container): Promise<void> {
  const session = mountRootContent<undefined>({
    kind: "picker",
    renderContent: (finish) => (
      <StatsShell
        statsService={container.statsService}
        statsFormatter={container.statsFormatter}
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
