import { useLineEditor } from "@/app-shell/line-editor";
import type { ListShellActionContext, ShellOption } from "@/app-shell/pickers/list-shell-types";
import { switchSessionMode } from "@/app/mode-switch";
import { buildPlaybackEpisodePickerOptions } from "@/app/playback-episode-picker";
import {
  formatPlaybackSessionFactsStrip,
  formatPlaybackSessionKeysHint,
  isCurrentStreamSelection,
  streamSelectionFromTrackPick,
} from "@/app/source-quality";
import { describePlaybackSubtitleStatus } from "@/app/subtitle-status";
import type { Container } from "@/container";
import { mediaLanguageProfileFor, showsEpisodeLabel } from "@/domain/media/content-kind";
import { toErrorScenario } from "@/domain/playback/playback-problem";
import {
  describePlaybackTelemetrySnapshot,
  type PlaybackTelemetrySnapshot,
} from "@/domain/playback/playback-telemetry-snapshot";
import type { SessionStateManager } from "@/domain/session/SessionStateManager";
import { isKittyCompatible } from "@/image";
import { buildRuntimeHealthSnapshot } from "@/services/diagnostics/runtime-health";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { Box, Text, render, useInput, useStdout } from "ink";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { COMMAND_CONTEXTS, resolveCommandContext } from "./commands";
import { DiscoverShell, type DiscoverShellResult } from "./discover-shell";
import { ExitShell } from "./exit-shell";
import { registerExitHandler, requestHardExit } from "./graceful-exit";
import { deleteAllKittyImages, usePosterSurfaceBoundaryCleanup } from "./image-pane";
import { getPickerLayout } from "./layout-policy";
import { LoadingShell } from "./loading-shell";
import { PostPlayShell } from "./post-play-shell";
import { AppHeader } from "./primitives/AppHeader";
import { ClaudeTabRow } from "./primitives/ClaudeTabRow";
import { SegmentedControl } from "./primitives/SegmentedControl";
import {
  clearRootContentSession,
  mountRootContent,
  useRootContentSession,
} from "./root-content-state";
import { RootOverlayShell } from "./root-overlay-shell";
import { getRootOwnedOverlay, resolveRootShellSurface } from "./root-shell-state";
import { ErrorShell, RootIdleShell } from "./root-status-shells";
import { buildRootStatusSummary, type SyncHealth } from "./root-status-summary";
import { openSessionPicker } from "./session-picker";
import {
  CommandPalette,
  getListShellCommandPaletteMaxVisible,
  shouldHideCompanionForCommandPalette,
  fallbackCommandState,
  getCommandAutocompleteTarget,
  getCommandMatches,
  getHighlightedCommand,
} from "./shell-command-ui";
import { InputField, ShellFrame } from "./shell-frame";
import { LocalSection, ResizeBlocker, ShellFooter } from "./shell-primitives";
import { getWindowStart, truncateLine, wrapText } from "./shell-text";
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
import {
  toShellAction,
  type FooterAction,
  type ShellFooterMode,
  type PlaybackShellState,
  type LoadingShellState,
  type PlaybackShellResult,
  type ShellPanelLine,
  type ShellPickerOption,
  type ShellAction,
  type ShellStatusTone,
} from "./types";
import { usePosterPreview } from "./use-poster-preview";
import { useSessionSelector } from "./use-session-selector";
import { useDebouncedViewportPolicy } from "./use-viewport-policy";

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

const SCREEN_CLEAR_GRACE_MS = 0;

type MountedShell<TResult> = {
  close: (value: TResult) => void;
  result: Promise<TResult>;
};

type RootShellScreen = {
  id: number;
  element: React.ReactElement;
};

const rootShellSubscribers = new Set<() => void>();
let rootShellScreen: RootShellScreen | null = null;
let rootShellInk: ReturnType<typeof render> | null = null;
let rootShellExitPromise: Promise<unknown> | null = null;
let rootShellNextId = 1;

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

function notifyRootShellSubscribers() {
  for (const subscriber of rootShellSubscribers) {
    subscriber();
  }
}

function setRootShellScreen(screen: RootShellScreen | null) {
  rootShellScreen = screen;
  notifyRootShellSubscribers();
}

function RootShellHost() {
  const [, setRevision] = useState(0);

  useEffect(() => {
    const subscriber = () => setRevision((revision) => revision + 1);
    rootShellSubscribers.add(subscriber);
    return () => {
      rootShellSubscribers.delete(subscriber);
    };
  }, []);

  return rootShellScreen ? (
    <React.Fragment key={rootShellScreen.id}>{rootShellScreen.element}</React.Fragment>
  ) : null;
}

async function openPlaybackStreamSelectionPicker(
  container: Container,
  action: "streams" | "source" | "quality",
  reason: string,
): Promise<void> {
  const stream = container.stateManager.getState().stream;
  if (!stream) return;

  // One unified Tracks panel for all three commands; /source and /quality
  // deep-link a section, /streams opens the whole surface.
  const initialSection =
    action === "source" ? "source" : action === "quality" ? "quality" : undefined;
  const { openTracksPanel } = await import("./workflows");
  const picked = await openTracksPanel(stream, { initialSection }, container);
  const selection = picked ? streamSelectionFromTrackPick(picked) : null;
  if (!picked || !selection) return;
  if (isCurrentStreamSelection(container.stateManager.getState().stream, selection)) {
    return;
  }

  // Source switches restart the episode; quality/audio/hardsub swap the active
  // stream in place. Subtitles attach in mpv, so they never resolve here.
  const controlAction = picked.section === "source" ? "pick-source" : "pick-quality";
  await container.playerControl.selectCurrentPlaybackStream(controlAction, selection, reason);
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

function useRootShellScreen(): RootShellScreen | null {
  const [, setRevision] = useState(0);

  useEffect(() => {
    const subscriber = () => setRevision((revision) => revision + 1);
    rootShellSubscribers.add(subscriber);
    return () => {
      rootShellSubscribers.delete(subscriber);
    };
  }, []);

  return rootShellScreen;
}

function ensureRootShell() {
  if (rootShellInk && rootShellExitPromise) {
    return rootShellExitPromise;
  }

  stdinManager.enterShell();
  clearShellScreen();

  rootShellInk = render(<RootShellHost />, {
    exitOnCtrlC: false,
    alternateScreen: true,
  });
  rootShellExitPromise = rootShellInk.waitUntilExit();

  void (async () => {
    await rootShellExitPromise;
    rootShellInk = null;
    rootShellExitPromise = null;
    rootShellScreen = null;
    clearRootContentSession();
    stdinManager.exitShell();
  })();

  return rootShellExitPromise;
}

function mountShell<TResult>({
  renderShell,
  fallbackValue,
  clearOnResolve = true,
}: {
  renderShell: (finish: (value: TResult) => void) => React.ReactElement;
  fallbackValue: TResult;
  clearOnResolve?: boolean;
}): MountedShell<TResult> {
  const exitPromise = ensureRootShell();
  const screenId = rootShellNextId++;
  let settled = false;
  let resolveResult!: (value: TResult) => void;

  const result = new Promise<TResult>((resolve) => {
    resolveResult = resolve;
  });

  const settle = (value: TResult, shouldClear: boolean) => {
    if (settled) return;
    settled = true;

    if (shouldClear && rootShellScreen?.id === screenId) {
      setTimeout(() => {
        if (rootShellScreen?.id === screenId) {
          setRootShellScreen(null);
        }
      }, SCREEN_CLEAR_GRACE_MS);
    }

    resolveResult(value);
  };

  // With alternateScreen: true and SCREEN_CLEAR_GRACE_MS = 0, the previous
  // shell is removed immediately when the next mounts, preventing flicker.
  // The raw screen clear was removed to let Ink handle reconciliation.

  setRootShellScreen({
    id: screenId,
    element: renderShell((value) => settle(value, clearOnResolve)),
  });

  void (async () => {
    await exitPromise;
    if (!settled) {
      settled = true;
      resolveResult(fallbackValue);
    }
  })();

  return {
    close: (value: TResult) => settle(value, true),
    result,
  };
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
  const { stateManager } = container;
  const state = useSessionState(stateManager);
  const screen = useRootShellScreen();
  const rootContent = useRootContentSession();
  const { stdout } = useStdout();
  const [exiting, setExiting] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);
  const [streak, setStreak] = useState<number | undefined>(undefined);
  const [syncHealth, setSyncHealth] = useState<SyncHealth | undefined>(undefined);
  const [playlistCount, setPlaylistCount] = useState<number>(0);
  const [streakMilestoneAlert, setStreakMilestoneAlert] = useState<string | null>(null);
  const [streakAtRiskAlert, setStreakAtRiskAlert] = useState<string | null>(null);

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
          action === "pick-source" ? "source" : action === "pick-quality" ? "quality" : "streams";
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
      setPresenceBootLine(null);
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

  const activePlaybackStatuses = ["ready", "buffering", "seeking", "stalled", "playing"] as const;
  const playbackIsActive = activePlaybackStatuses.some((status) => status === state.playbackStatus);
  useEffect(() => {
    if (!playbackIsActive) {
      setPlaybackTelemetrySnapshot(null);
      return;
    }

    const refreshSnapshot = () => {
      setPlaybackTelemetrySnapshot(container.playerControl.getTelemetrySnapshot());
    };

    refreshSnapshot();
    const timer = setInterval(refreshSnapshot, 1_000);
    return () => clearInterval(timer);
  }, [container.playerControl, playbackIsActive]);

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
  const shellWidth = stdout.columns ?? 80;
  const shellHeight = stdout.rows ?? 24;
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
  const activeNotifications = container.notificationService.listActive();
  const rootStatusSummary = buildRootStatusSummary({
    state,
    currentViewLabel,
    rootStatus,
    downloadStatus,
    streak,
    syncHealth,
    playlistCount,
    notificationCount: activeNotifications.length,
    newEpisodeNotificationCount: activeNotifications.filter(
      (notification) => notification.kind === "new-episode",
    ).length,
  });
  const rootOverlay = getRootOwnedOverlay(state);
  const rootSurface = resolveRootShellSurface(state, {
    hasRootContent: Boolean(rootContent),
    hasMountedScreen: Boolean(screen),
  });
  const isSeriesPlayback =
    rootSurface === "playback" &&
    state.currentTitle?.type === "series" &&
    state.currentEpisode !== null;
  const playbackTrace =
    state.playbackNote ??
    (playbackTelemetrySnapshot
      ? describePlaybackTelemetrySnapshot(playbackTelemetrySnapshot)
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

  const onCommandAction = useCallback(
    (action: ShellAction) => {
      if (action === "command-mode") return;
      if (action === "next" && canGoNext) {
        void container.playerControl.nextCurrentPlayback("playback-loading-command-next");
        return;
      }
      if (action === "previous" && canGoPrevious) {
        void container.playerControl.previousCurrentPlayback("playback-loading-command-previous");
        return;
      }
      if (action === "toggle-autoplay" && canToggleAutoplay) {
        container.stateManager.dispatch({
          type: "SET_SESSION_AUTOPLAY_PAUSED",
          paused: !container.stateManager.getState().autoplaySessionPaused,
        });
        return;
      }
      if (action === "toggle-autoskip") {
        container.stateManager.dispatch({
          type: "SET_SESSION_AUTOSKIP_PAUSED",
          paused: !container.stateManager.getState().autoskipSessionPaused,
        });
        return;
      }
      if (action === "stop-after-current") {
        container.stateManager.dispatch({
          type: "SET_SESSION_STOP_AFTER_CURRENT",
          enabled: !container.stateManager.getState().stopAfterCurrent,
        });
        return;
      }
      if (action === "search") {
        void container.playerControl.returnToSearchFromPlayback("playback-loading-command-search");
        return;
      }
      if (action === "back-to-search") {
        void container.playerControl.returnToSearchFromPlayback("playback-loading-command-search");
        return;
      }
      if (action === "recover") {
        void container.playerControl.recoverCurrentPlayback("playback-loading-command-recover");
        return;
      }
      if (action === "recompute") {
        void container.playerControl.recomputeCurrentPlayback("playback-loading-command-recompute");
        return;
      }
      if (action === "fallback") {
        const cancelledWork = container.workControl.cancelActive(
          "playback-loading-command-fallback",
        );
        if (!cancelledWork) {
          void container.playerControl.fallbackCurrentPlayback("playback-loading-command-fallback");
        }
        return;
      }
      if (action === "streams") {
        void openPlaybackStreamSelectionPicker(
          container,
          "streams",
          "playback-loading-command-streams",
        );
        return;
      }
      if (action === "pick-episode") {
        void openActivePlaybackEpisodePicker(container, "playback-loading-command-episode");
        return;
      }
      if (action === "source") {
        void openPlaybackStreamSelectionPicker(
          container,
          "source",
          "playback-loading-command-source",
        );
        return;
      }
      if (action === "quality") {
        void openPlaybackStreamSelectionPicker(
          container,
          "quality",
          "playback-loading-command-quality",
        );
        return;
      }
      if (action === "download") {
        void (async () => {
          const { enqueueCurrentPlaybackDownload } = await import("./workflows");
          await enqueueCurrentPlaybackDownload({
            container,
            reason: "active-playback-command",
          });
        })();
        return;
      }
      if (action === "quit") {
        void container.playerControl.stopCurrentPlayback("playback-loading-command-stop");
        return;
      }
      if (action === "toggle-mode") {
        switchSessionMode(container.stateManager);
        return;
      }
      void (async () => {
        const { routeSearchShellAction } = await import("./command-router");
        const routed = await routeSearchShellAction({ action, container });
        if (routed === "quit") {
          setExiting(true);
        }
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
    void container.playerControl.stopCurrentPlayback("playback-shell-q");
  }, [container]);

  const onNextHandler = useCallback(() => {
    void container.playerControl.nextCurrentPlayback("playback-shell-n");
  }, [container]);

  const onPreviousHandler = useCallback(() => {
    void container.playerControl.previousCurrentPlayback("playback-shell-p");
  }, [container]);

  const onRecover = useCallback(() => {
    void container.playerControl.recoverCurrentPlayback("playback-shell-r");
  }, [container]);

  const onFallback = useCallback(() => {
    const cancelledWork = container.workControl.cancelActive("playback-shell-fallback");
    if (!cancelledWork) {
      void container.playerControl.fallbackCurrentPlayback("playback-shell-fallback");
    }
  }, [container]);

  const onPickStreams = useCallback(() => {
    void openPlaybackStreamSelectionPicker(container, "streams", "playback-shell-k");
  }, [container]);

  const onPickEpisode = useCallback(() => {
    void openActivePlaybackEpisodePicker(container, "playback-shell-e");
  }, [container]);

  const onReloadSubtitles = useCallback(() => {
    void container.playerControl.reloadCurrentSubtitles("playback-shell-s");
  }, [container]);

  const onSkipSegment = useCallback(() => {
    void container.playerControl.skipCurrentSegment("playback-shell-i");
  }, [container]);

  const onToggleAutoplay = useCallback(() => {
    container.stateManager.dispatch({
      type: "SET_SESSION_AUTOPLAY_PAUSED",
      paused: !container.stateManager.getState().autoplaySessionPaused,
    });
  }, [container]);

  const onToggleAutoskip = useCallback(() => {
    container.stateManager.dispatch({
      type: "SET_SESSION_AUTOSKIP_PAUSED",
      paused: !container.stateManager.getState().autoskipSessionPaused,
    });
  }, [container]);

  const onStopAfterCurrent = useCallback(() => {
    container.stateManager.dispatch({
      type: "SET_SESSION_STOP_AFTER_CURRENT",
      enabled: !container.stateManager.getState().stopAfterCurrent,
    });
  }, [container]);

  const onPickSource = useCallback(() => {
    void openPlaybackStreamSelectionPicker(container, "source", "playback-shell-o");
  }, [container]);

  const onPickQuality = useCallback(() => {
    void openPlaybackStreamSelectionPicker(container, "quality", "playback-shell-v");
  }, [container]);

  const onReturnToSearch = useCallback(() => {
    void container.playerControl.returnToSearchFromPlayback("playback-shell-shift-s");
  }, [container]);

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
        size={`${shellWidth}×${shellHeight}`}
        width={Math.max(0, shellWidth - 2)}
      />
      {/* Single transient alert — highest priority wins, null when idle */}
      {rootStatusSummary.alert ? (
        <Text color={statusColor(rootStatusSummary.alert.tone)} dimColor>
          {truncateLine(rootStatusSummary.alert.text, Math.max(36, shellWidth - 8))}
        </Text>
      ) : null}
      {/* Presence boot line renders as alert override when it fires.
          Error/warning tones stay at full intensity so they read as alarms;
          calm tones (connected/info) dim so they recede. */}
      {presenceBootLine && !rootStatusSummary.alert ? (
        <Text
          dimColor={presenceBootLine.tone !== "error" && presenceBootLine.tone !== "warning"}
          color={statusColor(presenceBootLine.tone)}
        >
          {truncateLine(presenceBootLine.text, Math.max(36, shellWidth - 8))}
        </Text>
      ) : null}
      {/* Streak milestone celebration */}
      {streakMilestoneAlert && !rootStatusSummary.alert && !presenceBootLine ? (
        <Text dimColor color={statusColor("warning")}>
          {truncateLine(streakMilestoneAlert, Math.max(36, shellWidth - 8))}
        </Text>
      ) : null}
      {/* Streak-at-risk: evening reminder when streak is active but nothing watched today */}
      {streakAtRiskAlert &&
      !rootStatusSummary.alert &&
      !presenceBootLine &&
      !streakMilestoneAlert ? (
        <Text dimColor color={statusColor("warning")}>
          {truncateLine(streakAtRiskAlert, Math.max(36, shellWidth - 8))}
        </Text>
      ) : null}
      {/* Weekly digest shows once per week when not mid-playback */}
      {weeklyDigestLine &&
      !rootStatusSummary.alert &&
      !presenceBootLine &&
      !streakMilestoneAlert &&
      !streakAtRiskAlert ? (
        <Text dimColor color={statusColor("info")}>
          {truncateLine(weeklyDigestLine, Math.max(36, shellWidth - 8))}
        </Text>
      ) : null}
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
              onResolve={() => {
                stateManager.dispatch({ type: "CLEAR_PLAYBACK_PROBLEM" });
                stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
              }}
              onRetry={() => {
                stateManager.dispatch({ type: "CLEAR_PLAYBACK_PROBLEM" });
                stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
              }}
            />
          ) : rootSurface === "playback" ? (
            <LoadingShell
              key={`playback-ep-${state.currentTitle?.id ?? "none"}:${state.currentEpisode?.season ?? 0}:${state.currentEpisode?.episode ?? 0}`}
              state={{
                title: state.currentTitle?.name || "Resolving...",
                subtitle: playbackSubtitle,
                operation:
                  state.playbackStatus === "playing" ||
                  state.playbackStatus === "buffering" ||
                  state.playbackStatus === "seeking" ||
                  state.playbackStatus === "stalled"
                    ? "playing"
                    : state.playbackStatus === "loading"
                      ? "loading"
                      : "resolving",
                stage:
                  state.playbackStatus === "playing" ||
                  state.playbackStatus === "buffering" ||
                  state.playbackStatus === "seeking" ||
                  state.playbackStatus === "stalled"
                    ? "starting-playback"
                    : state.playbackStatus === "ready"
                      ? "preparing-player"
                      : state.playbackStatus === "loading"
                        ? "preparing-provider"
                        : "finding-stream",
                stageDetail: state.playbackDetail ?? undefined,
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
                fallbackAvailable: state.resolveRetryCount > 0 && Boolean(fallbackProvider),
                fallbackProviderName:
                  fallbackProvider?.metadata.name ?? fallbackProvider?.metadata.id,
                autoskipPaused: state.autoskipSessionPaused,
                autoplayPaused: state.autoplaySessionPaused,
                latestIssue: state.playbackNote,
                currentPosition: playbackTelemetrySnapshot?.positionSeconds,
                duration: playbackTelemetrySnapshot?.durationSeconds,
                bufferHealth:
                  state.playbackStatus === "stalled"
                    ? "stalled"
                    : state.playbackStatus === "buffering" ||
                        playbackTelemetrySnapshot?.pausedForCache
                      ? "buffering"
                      : playbackTelemetrySnapshot
                        ? "healthy"
                        : undefined,
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
                footerMode: "minimal",
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
                subtitleTrack: playbackSubtitleStatus,
                nextEpisodeLabel: state.episodeNavigation.nextLabel,
                previousEpisodeLabel: state.episodeNavigation.previousLabel,
                hasNextEpisode: state.episodeNavigation.hasNext,
                hasPreviousEpisode: state.episodeNavigation.hasPrevious,
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
              overlay={rootOverlay}
              state={state}
              container={container}
              onRedraw={clearShellScreen}
            />
          ) : screen ? (
            <Box key={screen.id}>{screen.element}</Box>
          ) : (
            <RootIdleShell state={state} />
          )}
        </Box>

        {rootSurface === "root-content" && rootOverlay ? (
          <Box marginTop={1}>
            <RootOverlayShell
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
    rootShellScreen = null;
    clearRootContentSession();
    stdinManager.exitShell();
  })();

  return rootShellExitPromise;
}

export async function shutdownSessionApp(): Promise<void> {
  if (!rootShellInk || !rootShellExitPromise) {
    return;
  }

  const exitPromise = rootShellExitPromise;
  const ink = rootShellInk;
  ink.cleanup();
  await exitPromise.catch(() => {});
  deleteAllKittyImages();
}

function buildPostPlayFooterActions(
  postPlayState: NonNullable<PlaybackShellState["postPlayState"]>,
  canResume: boolean,
): readonly FooterAction[] {
  const commandAction: FooterAction = { key: "/", label: "commands", action: "command-mode" };
  const quitAction: FooterAction = { key: "q", label: "quit", action: "quit" };

  switch (postPlayState.kind) {
    case "did-not-start":
      // Nothing played — retry the same episode (provider recover refetch), never advance.
      return [
        { key: "r", label: "try again", action: "replay", primary: true },
        { key: "f", label: "fallback", action: "fallback" },
        { key: "o", label: "source", action: "source" },
        { key: "d", label: "diagnostics", action: "diagnostics" },
        { key: "s", label: "search", action: "search" },
        quitAction,
        commandAction,
      ];
    case "caught-up":
      return [
        { key: "w", label: "watchlist", action: "watchlist", primary: true },
        quitAction,
        commandAction,
      ];
    case "season-finale":
      return [
        { key: "n", label: "next season", action: "next-season", primary: true },
        { key: "r", label: "replay", action: "replay" },
        quitAction,
        commandAction,
      ];
    case "series-complete":
      return [
        { key: "r", label: "replay", action: "replay" },
        { key: "s", label: "search", action: "search" },
        quitAction,
        commandAction,
      ];
    case "mid-series":
    default:
      return [
        {
          key: "n",
          label: "continue",
          action: canResume ? "resume" : "next",
          primary: true,
        },
        { key: "r", label: "replay", action: "replay" },
        quitAction,
        commandAction,
      ];
  }
}

function PlaybackShell({
  state,
  episodePickerOptions: _episodePickerOptions,
  episodePickerSubtitle: _episodePickerSubtitle,
  episodePickerInitialIndex: _episodePickerInitialIndex = 0,
  providerOptions: _providerOptions,
  settings: _settings,
  settingsSeriesProviderOptions: _settingsSeriesProviderOptions,
  settingsAnimeProviderOptions: _settingsAnimeProviderOptions,
  onSaveSettings: _onSaveSettings,
  loadHistoryPanel: _loadHistoryPanel,
  loadDiagnosticsPanel: _loadDiagnosticsPanel,
  loadHelpPanel: _loadHelpPanel,
  loadAboutPanel: _loadAboutPanel,
  onChangeProvider: _onChangeProvider,
  onResolve,
}: {
  state: PlaybackShellState;
  providerOptions?: readonly ShellPickerOption<string>[];
  episodePickerOptions?: readonly ShellPickerOption<string>[];
  episodePickerSubtitle?: string;
  episodePickerInitialIndex?: number;
  settings?: KitsuneConfig;
  settingsSeriesProviderOptions?: readonly ShellPickerOption<string>[];
  settingsAnimeProviderOptions?: readonly ShellPickerOption<string>[];
  onSaveSettings?: (next: KitsuneConfig) => Promise<void>;
  loadHistoryPanel?: () => Promise<readonly ShellPanelLine[]>;
  loadDiagnosticsPanel?: () => Promise<readonly ShellPanelLine[]>;
  loadHelpPanel?: () => Promise<readonly ShellPanelLine[]>;
  loadAboutPanel?: () => Promise<readonly ShellPanelLine[]>;
  onChangeProvider?: (providerId: string) => Promise<void>;
  onResolve: (result: PlaybackShellResult) => void;
}) {
  usePosterSurfaceBoundaryCleanup(true);
  const playbackViewport = useDebouncedViewportPolicy("playback");
  const commands = state.commands ?? fallbackCommandState(COMMAND_CONTEXTS.postPlayback);
  const postPlayState = state.postPlayState ?? { kind: "mid-series" as const };
  const canResume = Boolean(state.resumeLabel);
  const footerActions = buildPostPlayFooterActions(postPlayState, canResume);
  const contextStrip = [
    "post-play",
    state.provider,
    state.episodeLabel,
    state.mode === "anime" ? "anime" : null,
  ]
    .filter((item): item is string => Boolean(item))
    .join("  ·  ");
  const recommendations = state.recommendationRailItems ?? [];

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
      inputLocked={false}
      escapeAction="back-to-results"
      onUnhandledInput={(input, key) => {
        if (key.return || input === "c") {
          if (postPlayState.kind === "did-not-start") {
            onResolve("replay"); // try again — recover-refetch same episode, never advance
            return;
          }
          if (postPlayState.kind === "mid-series") {
            onResolve(canResume ? "resume" : "next");
            return;
          }
          if (postPlayState.kind === "season-finale") {
            onResolve("next-season");
            return;
          }
          if (postPlayState.kind === "series-complete") {
            const item = recommendations[0];
            if (item) {
              onResolve({ type: "play-recommendation", item });
            }
            return;
          }
        }
        if (input === "w" && postPlayState.kind === "caught-up") {
          onResolve("watchlist");
          return;
        }
        if (postPlayState.kind === "did-not-start") {
          if (input === "r") {
            onResolve("replay");
            return;
          }
          if (input === "f") {
            onResolve("fallback");
            return;
          }
          if (input === "o") {
            onResolve("source");
            return;
          }
          if (input === "d") {
            onResolve("diagnostics");
            return;
          }
          if (input === "s") {
            onResolve("search");
            return;
          }
        }
        if (input === "1" || input === "2" || input === "3") {
          const item = recommendations[Number(input) - 1];
          if (item) {
            onResolve({ type: "play-recommendation", item });
          }
        }
        const actionIndex = input === "!" ? 0 : input === "@" ? 1 : input === "#" ? 2 : -1;
        if (actionIndex >= 0) {
          const item = recommendations[actionIndex];
          if (item) {
            onResolve({ type: "open-recommendation-actions", items: [item] });
          }
        }
      }}
      onResolve={onResolve}
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
        />
      )}
    </ShellFrame>
  );
}

export function openPlaybackShell({
  state,
  providerOptions,
  episodePickerOptions,
  episodePickerSubtitle,
  episodePickerInitialIndex,
  settings,
  settingsSeriesProviderOptions,
  settingsAnimeProviderOptions,
  onSaveSettings,
  loadHistoryPanel,
  loadDiagnosticsPanel,
  loadHelpPanel,
  loadAboutPanel,
  onChangeProvider,
}: {
  state: PlaybackShellState;
  providerOptions?: readonly ShellPickerOption<string>[];
  episodePickerOptions?: readonly ShellPickerOption<string>[];
  episodePickerSubtitle?: string;
  episodePickerInitialIndex?: number;
  settings?: KitsuneConfig;
  settingsSeriesProviderOptions?: readonly ShellPickerOption<string>[];
  settingsAnimeProviderOptions?: readonly ShellPickerOption<string>[];
  onSaveSettings?: (next: KitsuneConfig) => Promise<void>;
  loadHistoryPanel?: () => Promise<readonly ShellPanelLine[]>;
  loadDiagnosticsPanel?: () => Promise<readonly ShellPanelLine[]>;
  loadHelpPanel?: () => Promise<readonly ShellPanelLine[]>;
  loadAboutPanel?: () => Promise<readonly ShellPanelLine[]>;
  onChangeProvider?: (providerId: string) => Promise<void>;
}): Promise<PlaybackShellResult> {
  const session = mountRootContent<PlaybackShellResult>({
    kind: "playback",
    renderContent: (finish) => (
      <PlaybackShell
        state={state}
        providerOptions={providerOptions}
        episodePickerOptions={episodePickerOptions}
        episodePickerSubtitle={episodePickerSubtitle}
        episodePickerInitialIndex={episodePickerInitialIndex}
        settings={settings}
        settingsSeriesProviderOptions={settingsSeriesProviderOptions}
        settingsAnimeProviderOptions={settingsAnimeProviderOptions}
        onSaveSettings={onSaveSettings}
        loadHistoryPanel={loadHistoryPanel}
        loadDiagnosticsPanel={loadDiagnosticsPanel}
        loadHelpPanel={loadHelpPanel}
        loadAboutPanel={loadAboutPanel}
        onChangeProvider={onChangeProvider}
        onResolve={finish}
      />
    ),
    fallbackValue: "quit",
  });

  return session.result;
}

export type LoadingShellHandle = {
  close: () => void;
  update: (state: LoadingShellState) => void;
  result: Promise<"done" | "cancelled">;
};

export function openLoadingShell({
  state: initialState,
  cancellable = false,
}: {
  state: LoadingShellState;
  cancellable?: boolean;
}): LoadingShellHandle {
  let externalSetState: ((s: LoadingShellState) => void) | null = null;

  function LiveLoadingShell({ finish }: { finish: (value: "done" | "cancelled") => void }) {
    const [state, setState] = useState(initialState);
    useEffect(() => {
      externalSetState = setState;
      return () => {
        externalSetState = null;
      };
    }, []);
    return (
      <LoadingShell state={state} onCancel={cancellable ? () => finish("cancelled") : undefined} />
    );
  }

  const session = mountShell<"done" | "cancelled">({
    renderShell: (finish) => <LiveLoadingShell finish={finish} />,
    fallbackValue: "done",
  });

  return {
    close: () => session.close("done"),
    update: (state) => externalSetState?.(state),
    result: session.result,
  };
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

  useEffect(() => {
    if (!commandMode) {
      setHighlightedCommandIndex(0);
      return;
    }

    const matches = getCommandMatches(commandInput, actionContext?.commands ?? []);
    setHighlightedCommandIndex((current) => {
      if (matches.length === 0) return 0;
      return Math.min(current, matches.length - 1);
    });
  }, [commandInput, commandMode, actionContext]);

  const selectedOption = filteredOptions[index];

  const { ultraCompact, tooSmall, minColumns, minRows, maxVisibleRows: maxVisible } = viewport;
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
  const { poster, posterState } = usePosterPreview(selectedOption?.previewImageUrl, {
    rows: 9,
    cols: Math.max(18, Math.min(30, companionWidth - 4)),
    enabled: showCompanion,
    debounceMs: 120,
  });

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
  const footerActions: readonly FooterAction[] = [
    { key: "/", label: "commands", action: "command-mode" },
    { key: "esc", label: "back", action: "quit" },
  ];

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
                        {rowText.padEnd(rowWidth - 2)}
                      </Text>
                    </Box>
                  );
                })}
                {windowEnd < filteredOptions.length && <Text color={palette.dim}> ▼ ...</Text>}
              </Box>
              {!ultraCompact && showCompanion ? (
                <Box marginLeft={2} flexDirection="column" width={companionWidth}>
                  <LocalSection title="Current Selection" tone="success" marginTop={0}>
                    {poster.kind !== "none" ? (
                      <Box flexDirection="column" marginBottom={1}>
                        <Text>{poster.placeholder}</Text>
                      </Box>
                    ) : selectedOption?.previewImageUrl && posterState === "loading" ? (
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

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    let cmd: string[];
    if (process.platform === "darwin") {
      cmd = ["pbcopy"];
    } else if (process.env["WAYLAND_DISPLAY"]) {
      cmd = ["wl-copy"];
    } else {
      cmd = ["xclip", "-selection", "clipboard"];
    }
    const proc = Bun.spawn(cmd, { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
    proc.stdin.write(text);
    proc.stdin.end();
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

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
  const { stdout } = useStdout();
  const rows = stdout.rows ?? 24;
  const cols = stdout.columns ?? 80;
  const innerWidth = Math.max(30, cols - 6);
  const available = rows - 4;

  const activeTab = statsTabFromIndex(tabIdx);
  const activeRange = statsRangeFromIndex(rangeIdx);
  const activeKind = statsKindFromIndex(kindIdx);
  const windowDays = activeRange === "all" ? 99_999 : activeRange === "7d" ? 7 : 30;
  const mediaKindFilter = activeKind === "all" ? undefined : activeKind;

  const stats = useMemo(
    () => statsService.getStats(windowDays, mediaKindFilter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rangeIdx, kindIdx],
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
    if ((key.tab || input === "\t") && key.shift) {
      setKindIdx((i) => (i + 1) % STATS_KINDS.length);
      return;
    }
    if (key.tab || input === "\t") {
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

export function openDiscoverShell(
  sections: import("@/services/recommendations/RecommendationService").RecommendationSection[],
  onRefresh?: () => Promise<
    readonly import("@/services/recommendations/RecommendationService").RecommendationSection[]
  >,
): Promise<DiscoverShellResult> {
  const session = mountShell<DiscoverShellResult>({
    renderShell: (finish) => (
      <DiscoverShell
        sections={sections}
        onRefresh={onRefresh}
        onResult={(result) => {
          finish(result);
        }}
      />
    ),
    fallbackValue: { type: "back" },
  });

  return session.result;
}
