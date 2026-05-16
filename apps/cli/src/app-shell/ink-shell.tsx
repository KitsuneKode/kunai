import { useLineEditor } from "@/app-shell/line-editor";
import type { ListShellActionContext, ShellOption } from "@/app-shell/pickers/list-shell-types";
import { addSearchQuery, getSearchHistory } from "@/app-shell/search-history";
import { switchSessionMode } from "@/app/mode-switch";
import { buildPlaybackEpisodePickerOptions } from "@/app/playback-episode-picker";
import {
  buildQualityPickerOptions,
  buildSourcePickerOptions,
  buildStreamPickerOptions,
  isCurrentStreamSelection,
  streamSelectionFromSource,
  streamSelectionFromStream,
  type StreamSelectionIntent,
} from "@/app/source-quality";
import { describePlaybackSubtitleStatus } from "@/app/subtitle-status";
import type { Container } from "@/container";
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

import {
  applyBrowseResultFilters,
  describeBrowseResultFilters,
  hasBrowseResultFilters,
  parseBrowseFilterQuery,
} from "./browse-filters";
import type { ResolvedAppCommand } from "./commands";
import { COMMAND_CONTEXTS, resolveCommandContext } from "./commands";
import { buildBrowseCompanionPanel, buildBrowseDetailsPanel } from "./details-panel";
import { DiscoverShell, type DiscoverShellResult } from "./discover-shell";
import { registerExitHandler, requestHardExit } from "./graceful-exit";
import { deleteAllKittyImages } from "./image-pane";
import { LoadingShell, useSpinner } from "./loading-shell";
import { OverlayPanel } from "./overlay-panel";
import type { BrowseOverlay } from "./overlay-panel";
import {
  clearRootContentSession,
  mountRootContent,
  useRootContentSession,
} from "./root-content-state";
import { RootOverlayShell } from "./root-overlay-shell";
import { getRootOwnedOverlay, resolveRootShellSurface } from "./root-shell-state";
import { ErrorShell, RootIdleShell } from "./root-status-shells";
import { buildRootStatusSummary } from "./root-status-summary";
import { openSessionPicker } from "./session-picker";
import {
  CommandPalette,
  fallbackCommandState,
  getCommandMatches,
  getHighlightedCommand,
} from "./shell-command-ui";
import { footerActionFromCommand, getCommandLabel, InputField, ShellFrame } from "./shell-frame";
import {
  BrowseTitle,
  ContextStrip,
  DetailLine,
  InlineBadge,
  LocalSection,
  ResizeBlocker,
  ShellFooter,
} from "./shell-primitives";
import { getWindowStart, truncateLine, wrapText } from "./shell-text";
import { APP_LABEL, palette, statusColor } from "./shell-theme";
import {
  toShellAction,
  type FooterAction,
  type PlaybackShellState,
  type LoadingShellState,
  type BrowseShellOption,
  type BrowseShellResult,
  type BrowseShellSearchResponse,
  type PlaybackShellResult,
  type ShellPanelLine,
  type ShellPickerOption,
  type ShellAction,
  type ShellFooterMode,
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

  const picker =
    action === "source"
      ? {
          type: "source_picker" as const,
          options: buildSourcePickerOptions(stream),
          toSelection: streamSelectionFromSource,
          controlAction: "pick-source" as const,
        }
      : action === "quality"
        ? {
            type: "quality_picker" as const,
            options: buildQualityPickerOptions(stream),
            toSelection: streamSelectionFromStream,
            controlAction: "pick-quality" as const,
          }
        : {
            type: "quality_picker" as const,
            options: buildStreamPickerOptions(stream),
            toSelection: streamSelectionFromStream,
            controlAction: "pick-stream" as const,
          };

  if (picker.options.length === 0) return;
  const value = await openSessionPicker(container.stateManager, {
    type: picker.type,
    options: picker.options.map((option) => ({
      value: option.value,
      label: option.label,
      detail: option.detail,
    })),
  });
  if (!value) return;

  const selection: StreamSelectionIntent = picker.toSelection(value);
  if (isCurrentStreamSelection(container.stateManager.getState().stream, selection)) {
    return;
  }

  await container.playerControl.selectCurrentPlaybackStream(
    picker.controlAction,
    selection,
    reason,
  );
}

async function openActivePlaybackEpisodePicker(
  container: Container,
  reason: string,
): Promise<void> {
  const state = container.stateManager.getState();
  const title = state.currentTitle;
  const currentEpisode = state.currentEpisode;
  if (!title || title.type !== "series" || !currentEpisode) return;

  const watchedEntries = await container.historyStore.listByTitle(title.id);
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
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);
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

  // Register download pause as a pre-exit handler for the /quit path.
  // The OS signal handler (SIGINT/SIGTERM) pauses downloads separately,
  // so this handler covers only requestHardExit callers (e.g. /quit).
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

  // Eager Discord RPC: choosing Discord presence in settings opens the local IPC pipe here and
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
  const playbackSubtitle = state.currentEpisode
    ? `S${String(state.currentEpisode.season).padStart(2, "0")}E${String(
        state.currentEpisode.episode,
      ).padStart(2, "0")}`
    : undefined;
  const playbackSubtitleStatus = describePlaybackSubtitleStatus(
    state.stream,
    state.mode === "anime"
      ? state.animeLanguageProfile.subtitle
      : state.seriesLanguageProfile.subtitle,
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
  const rootStatusSummary = buildRootStatusSummary({
    state,
    currentViewLabel,
    rootStatus,
    downloadStatus,
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
          requestHardExit(0);
        }
      })();
    },
    [container, canGoNext, canGoPrevious, canToggleAutoplay],
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

  return (
    <Box
      flexDirection="column"
      width={shellWidth}
      height={shellHeight}
      paddingX={1}
      paddingY={0}
      backgroundColor={palette.bg}
    >
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={palette.gray}
        width="100%"
        height="100%"
        paddingX={1}
        paddingY={0}
      >
        <Box justifyContent="space-between">
          <Text color={palette.amber}>{APP_LABEL}</Text>
          <Text color={statusColor(rootStatusSummary.header.tone)}>
            {container.config.minimalMode && currentViewLabel === "browse"
              ? undefined
              : rootStatusSummary.header.label}
          </Text>
        </Box>
        <Box marginTop={0} flexWrap="wrap">
          {rootStatusSummary.badges.map((badge) => (
            <InlineBadge
              key={`${badge.label}-${badge.tone}`}
              label={truncateLine(badge.label, badge.label === state.currentTitle?.name ? 34 : 28)}
              tone={badge.tone}
            />
          ))}
        </Box>
        {presenceBootLine ? (
          <Box marginTop={0}>
            <Text dimColor color={statusColor(presenceBootLine.tone)}>
              {truncateLine(presenceBootLine.text, Math.max(36, shellWidth - 8))}
            </Text>
          </Box>
        ) : null}
        <Box marginTop={1} flexDirection="column" flexGrow={1} justifyContent="space-between">
          <Box flexDirection="column" flexGrow={1}>
            {rootSurface === "error" ? (
              <ErrorShell
                message={state.playbackError || "An unknown error occurred"}
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
                      : state.playbackStatus === "loading"
                        ? "preparing-player"
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
                  stopHint:
                    state.playbackStatus === "playing" ||
                    state.playbackStatus === "buffering" ||
                    state.playbackStatus === "seeking" ||
                    state.playbackStatus === "stalled"
                      ? state.currentTitle?.type === "series"
                        ? `q stop  ·  ${canGoNext ? "n next" : "n unavailable"}  ·  ${canGoPrevious ? "p previous" : "p unavailable"}  ·  ${state.stopAfterCurrent ? "x resume chain" : "x stop after current"}`
                        : "q stop"
                      : undefined,
                  controlHint:
                    state.playbackStatus === "playing" ||
                    state.playbackStatus === "buffering" ||
                    state.playbackStatus === "seeking" ||
                    state.playbackStatus === "stalled"
                      ? `${canToggleAutoplay ? (state.autoplaySessionPaused ? "a resume autoplay" : "a pause autoplay") : "a unavailable"}  ·  u ${state.autoskipSessionPaused ? "resume autoskip" : "pause autoskip"}  ·  e episodes  ·  k streams  ·  d download  ·  r recover`
                      : undefined,
                  commands: resolveCommandContext(state, "activePlayback"),
                  footerMode: "detailed",
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
  const playbackViewport = useDebouncedViewportPolicy("playback");
  const playbackWide = playbackViewport.columns >= 150;
  const { poster, posterState } = usePosterPreview(state.posterUrl, {
    rows: 8,
    cols: 18,
    enabled: true,
  });
  const showPosterCompanion =
    playbackWide &&
    Boolean(
      state.posterUrl ||
      poster.kind !== "none" ||
      posterState === "loading" ||
      posterState === "unavailable",
    );

  const commands = state.commands ?? fallbackCommandState(COMMAND_CONTEXTS.postPlayback);
  const footerActions: readonly FooterAction[] = [
    { key: "/", label: "commands", action: "command-mode" },
    footerActionFromCommand(
      commands,
      "next",
      {
        key: "n",
        label: getCommandLabel(commands, "next", "next"),
      },
      toShellAction,
    ),
    footerActionFromCommand(
      commands,
      "previous",
      {
        key: "p",
        label: getCommandLabel(commands, "previous", "previous"),
      },
      toShellAction,
    ),
    ...(state.resumeLabel
      ? ([
          { key: "c", label: state.resumeLabel, action: "resume" as const },
        ] satisfies readonly FooterAction[])
      : []),
    footerActionFromCommand(commands, "replay", { key: "r", label: "replay" }, toShellAction),
    ...(state.showRecommendationNudge
      ? ([
          footerActionFromCommand(
            commands,
            "recommendation",
            { key: "g", label: "recommendation picks" },
            toShellAction,
          ),
        ] satisfies readonly FooterAction[])
      : []),
    footerActionFromCommand(
      commands,
      "pick-episode",
      { key: "e", label: "episodes" },
      toShellAction,
    ),
    footerActionFromCommand(commands, "streams", { key: "k", label: "streams" }, toShellAction),
    footerActionFromCommand(commands, "source", { key: "o", label: "source" }, toShellAction),
    footerActionFromCommand(commands, "quality", { key: "v", label: "quality" }, toShellAction),
    footerActionFromCommand(commands, "download", { key: "d", label: "download" }, toShellAction),
    footerActionFromCommand(commands, "fallback", { key: "f", label: "fallback" }, toShellAction),
    footerActionFromCommand(
      commands,
      "toggle-autoplay",
      { key: "a", label: getCommandLabel(commands, "toggle-autoplay", "autoplay") },
      toShellAction,
    ),
    footerActionFromCommand(commands, "search", { key: "s", label: "search" }, toShellAction),
    footerActionFromCommand(commands, "quit", { key: "q", label: "quit" }, toShellAction),
  ];

  const location =
    state.type === "series"
      ? `S${String(state.season).padStart(2, "0")}E${String(state.episode).padStart(2, "0")}`
      : "Movie";
  const modeLabel = state.mode === "anime" ? "Anime" : "Series";
  const playbackSubtitleTone =
    state.subtitleStatus?.toLowerCase().includes("not found") ||
    state.subtitleStatus?.toLowerCase().includes("disabled")
      ? "warning"
      : "success";
  const playbackContext = [
    location,
    modeLabel,
    `Provider ${state.provider}`,
    state.subtitleStatus,
    state.autoplayPaused ? "Autoplay paused" : "Autoplay ready",
  ].filter((item): item is string => Boolean(item));
  const hasRecommendationRail = Boolean(
    state.recommendationRailItems && state.recommendationRailItems.length > 0,
  );
  const postPlaybackHeading = state.resumeLabel
    ? `Resume from ${state.resumeLabel}`
    : state.autoplayPaused && state.type === "series"
      ? "You're caught up for now"
      : state.type === "series"
        ? "Ready for the next episode"
        : "Ready to replay or search again";
  const postPlaybackNextStep = state.resumeLabel
    ? "Resume from your last stop, restart from the beginning, or move between episodes"
    : state.autoplayPaused && hasRecommendationRail
      ? "Try a recommendation, check /calendar, or replay this episode"
      : state.autoplayPaused
        ? "Check /calendar for new releases, open /recommendation, or replay this episode"
        : "Replay, move episodes, or start a fresh search";
  const attentionHealthLines = [state.providerHealth, state.networkHealth].filter(
    (line): line is ShellPanelLine => Boolean(line && line.tone && line.tone !== "neutral"),
  );

  return (
    <ShellFrame
      eyebrow={APP_LABEL}
      title={state.title}
      subtitle={playbackContext.join("  ·  ")}
      status={state.status}
      footerTask="Playback"
      footerActions={footerActions}
      footerMode={state.footerMode}
      commands={commands}
      inputLocked={false}
      escapeAction="back-to-results"
      onResolve={onResolve}
    >
      {playbackViewport.tooSmall ? (
        <ResizeBlocker
          minColumns={playbackViewport.minColumns}
          minRows={playbackViewport.minRows}
          message="Resize terminal for playback controls"
        />
      ) : (
        <>
          <Box>
            <Text color={palette.gray} dimColor>
              {"─".repeat(Math.max(24, playbackViewport.columns - 8))}
            </Text>
          </Box>
          <Box flexDirection={showPosterCompanion ? "row" : "column"} marginTop={1} flexGrow={1}>
            <Box
              flexDirection="column"
              width={showPosterCompanion ? Math.max(56, playbackViewport.columns - 38) : undefined}
            >
              <Text color={state.autoplayPaused ? palette.teal : palette.amber} bold>
                {postPlaybackHeading}
              </Text>
              <Box marginTop={1} flexDirection="column">
                {playbackSubtitleTone === "warning" ? (
                  <DetailLine
                    label="Subtitle state"
                    value={state.subtitleStatus ?? "not reported"}
                    tone={playbackSubtitleTone}
                  />
                ) : null}
                <DetailLine label="Next step" value={postPlaybackNextStep} />
                {hasRecommendationRail ? (
                  <DetailLine
                    label="Recommended next"
                    value={state.recommendationRailItems?.join("  ·  ") ?? ""}
                    tone="info"
                  />
                ) : null}
                {state.autoplayPaused && !hasRecommendationRail ? (
                  <DetailLine
                    label="Discover"
                    value="Use /recommendation for picks or /calendar for weekly anime releases"
                    tone="info"
                  />
                ) : null}
                {state.recommendationRailMoreCount && state.recommendationRailMoreCount > 0 ? (
                  <DetailLine
                    label="More picks"
                    value={`${state.recommendationRailMoreCount} more available in /recommendation`}
                    tone="neutral"
                  />
                ) : null}
                {state.autoplayPaused ? (
                  <DetailLine
                    label="Autoplay"
                    value="Paused for this playback chain only"
                    tone="warning"
                  />
                ) : null}
                {state.lastQueuedDownload ? (
                  <DetailLine label="Downloads" value={state.lastQueuedDownload} tone="info" />
                ) : null}
                {state.showMemory && state.memoryUsage ? (
                  <DetailLine label="Memory" value={state.memoryUsage} />
                ) : null}
                {attentionHealthLines.map((line) => (
                  <DetailLine
                    key={line.label}
                    label={line.label}
                    value={line.detail ?? ""}
                    tone={line.tone === "neutral" ? undefined : line.tone}
                  />
                ))}
              </Box>
            </Box>

            {showPosterCompanion ? (
              <Box marginLeft={2} flexDirection="column" width={26}>
                <Box>
                  {poster.kind !== "none" ? (
                    <Text>{poster.placeholder}</Text>
                  ) : (
                    <Box flexDirection="column">
                      <Text
                        color={posterState === "loading" ? palette.info : palette.gray}
                        dimColor
                      >
                        {posterState === "loading" ? "Loading poster…" : "Poster unavailable"}
                      </Text>
                      {posterState === "unavailable" ? (
                        <Text color={palette.gray} dimColor>
                          Artwork is optional; playback controls stay available.
                        </Text>
                      ) : null}
                    </Box>
                  )}
                </Box>
              </Box>
            ) : null}
          </Box>
        </>
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
  const innerWidth = Math.max(24, viewport.columns - 8);
  const showSelectionCompanion = !tooSmall && !ultraCompact && viewport.columns >= 152;
  const companionWidth = showSelectionCompanion ? Math.max(34, Math.floor(innerWidth * 0.32)) : 0;
  const listWidth = showSelectionCompanion
    ? Math.max(42, innerWidth - companionWidth - 3)
    : innerWidth;
  const rowWidth = Math.max(20, listWidth - 4);
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
    enabled: showSelectionCompanion,
    debounceMs: 120,
  });

  const windowStart = getWindowStart(index, filteredOptions.length, maxVisible);
  const windowEnd = Math.min(windowStart + maxVisible, filteredOptions.length);
  const visibleOptions = filteredOptions.slice(windowStart, windowEnd);
  const footerTask =
    normalizedFilter.length > 0
      ? "Refine the filter or confirm the highlighted match"
      : (actionContext?.taskLabel ?? "Filter this list and confirm a selection");
  const effectiveFooterMode = "minimal";
  const footerActions: readonly FooterAction[] =
    effectiveFooterMode === "minimal"
      ? [
          { key: "/", label: "commands", action: "command-mode" },
          { key: "esc", label: "back", action: "quit" },
        ]
      : [
          { key: "type", label: "filter", action: "search" },
          { key: "enter", label: "select", action: "search" },
          { key: "esc", label: "back", action: "quit" },
          ...(actionContext
            ? [{ key: "/", label: "commands", action: "command-mode" as const }]
            : []),
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
        const nextIndex = matches.length > 0 ? (highlightedCommandIndex + 1) % matches.length : 0;
        const target = matches[nextIndex];
        if (target) {
          setHighlightedCommandIndex(nextIndex);
          commandEditor.setValue(target.aliases[0] ?? target.id);
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
          <Text color={confirmed ? palette.green : palette.teal}>
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
          <ResizeBlocker minColumns={minColumns} minRows={minRows} />
        ) : (
          <>
            <Text color={palette.gray} dimColor>
              {`${filteredOptions.length > 0 ? index + 1 : 0} of ${filteredOptions.length}`}
            </Text>
            <Box
              flexDirection={showSelectionCompanion ? "row" : "column"}
              marginTop={1}
              justifyContent="space-between"
            >
              <Box flexDirection="column" width={showSelectionCompanion ? listWidth : undefined}>
                {windowStart > 0 && <Text color={palette.gray}> ▲ ...</Text>}
                {visibleOptions.map((option) => {
                  const selected = option === selectedOption;
                  const isConfirmed = confirmed && selected;
                  const itemPrefix = isConfirmed ? "✓" : selected ? "❯" : " ";
                  const itemTone = isConfirmed
                    ? palette.green
                    : selected
                      ? palette.amber
                      : palette.gray;
                  const secondary = option.detail
                    ? `  ${truncateLine(option.detail, Math.max(12, rowWidth - option.label.length - 4))}`
                    : "";
                  const rowText = truncateLine(`${option.label}${secondary}`, rowWidth - 2);
                  return (
                    <Box key={`${option.label}-${option.detail ?? ""}`} width={rowWidth}>
                      <Text
                        backgroundColor={selected ? palette.teal : undefined}
                        color={selected ? "black" : "white"}
                        bold={selected || isConfirmed}
                        dimColor={!selected && !isConfirmed}
                      >
                        <Text color={selected ? "black" : itemTone}>{`${itemPrefix} `}</Text>
                        {rowText.padEnd(rowWidth - 2)}
                      </Text>
                    </Box>
                  );
                })}
                {windowEnd < filteredOptions.length && <Text color={palette.gray}> ▼ ...</Text>}
              </Box>
              {!ultraCompact ? (
                <Box
                  marginLeft={showSelectionCompanion ? 2 : 0}
                  marginTop={showSelectionCompanion ? 0 : 1}
                  flexDirection="column"
                  width={showSelectionCompanion ? companionWidth : undefined}
                >
                  <LocalSection title="Current Selection" tone="success" marginTop={0}>
                    {poster.kind !== "none" ? (
                      <Box flexDirection="column" marginBottom={1}>
                        <Text>{poster.placeholder}</Text>
                      </Box>
                    ) : selectedOption?.previewImageUrl && posterState === "loading" ? (
                      <Box marginBottom={1}>
                        <Text color={palette.info} dimColor>
                          Loading artwork…
                        </Text>
                      </Box>
                    ) : null}
                    <Text bold color="white">
                      {truncateLine(
                        selectedLabel,
                        showSelectionCompanion ? companionWidth : innerWidth,
                      )}
                    </Text>
                    <Box marginTop={1} flexDirection="column">
                      {detailLines.map((line) => (
                        <Text key={`detail-${selectedLabel}-${line}`} color={palette.info}>
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

function BrowseShell<T>({
  mode,
  provider,
  initialQuery,
  initialResults,
  initialResultSubtitle,
  initialSelectedIndex,
  placeholder,
  commands,
  providerOptions: _providerOptions,
  loadHistoryPanel: _loadHistoryPanel,
  loadDiagnosticsPanel: _loadDiagnosticsPanel,
  loadHelpPanel: _loadHelpPanel,
  loadAboutPanel: _loadAboutPanel,
  onChangeProvider: _onChangeProvider,
  onSearch,
  onLoadDiscovery,
  onLoadRecommendations,
  footerMode: _footerMode = "detailed",
  settings: _settings,
  settingsSeriesProviderOptions: _settingsSeriesProviderOptions,
  settingsAnimeProviderOptions: _settingsAnimeProviderOptions,
  onSaveSettings: _onSaveSettings,
  onResolve,
  onSubmit,
  onCancel,
}: {
  mode: "series" | "anime";
  provider: string;
  initialQuery?: string;
  initialResults?: readonly BrowseShellOption<T>[];
  initialResultSubtitle?: string;
  initialSelectedIndex?: number;
  placeholder: string;
  commands: readonly ResolvedAppCommand[];
  providerOptions?: readonly ShellPickerOption<string>[];
  loadHistoryPanel?: () => Promise<readonly ShellPanelLine[]>;
  loadDiagnosticsPanel?: () => Promise<readonly ShellPanelLine[]>;
  loadHelpPanel?: () => Promise<readonly ShellPanelLine[]>;
  loadAboutPanel?: () => Promise<readonly ShellPanelLine[]>;
  onChangeProvider?: (providerId: string) => Promise<void>;
  onSearch: (query: string) => Promise<BrowseShellSearchResponse<T>>;
  onLoadDiscovery?: () => Promise<BrowseShellSearchResponse<T>>;
  onLoadRecommendations?: () => Promise<BrowseShellSearchResponse<T>>;
  footerMode?: ShellFooterMode;
  settings?: KitsuneConfig;
  settingsSeriesProviderOptions?: readonly ShellPickerOption<string>[];
  settingsAnimeProviderOptions?: readonly ShellPickerOption<string>[];
  onSaveSettings?: (next: KitsuneConfig) => Promise<void>;
  onResolve: (action: ShellAction) => void;
  onSubmit: (value: T) => void;
  onCancel: () => void;
}) {
  const spinner = useSpinner();
  const viewport = useDebouncedViewportPolicy("browse", {
    forceCompact: _settings?.minimalMode,
  });
  const [query, setQuery] = useState(initialQuery ?? "");
  const [commandMode, setCommandMode] = useState(false);
  const [commandInput, setCommandInput] = useState("");
  const [highlightedCommandIndex, setHighlightedCommandIndex] = useState(0);
  const commandEditor = useLineEditor({
    value: commandInput,
    onChange: (nextValue) => {
      setCommandInput(nextValue);
      setHighlightedCommandIndex(0);
    },
    onRedraw: clearShellScreen,
  });
  const [activeOverlay, setActiveOverlay] = useState<BrowseOverlay | null>(null);
  const [options, setOptions] = useState<readonly BrowseShellOption<T>[]>(initialResults ?? []);
  const [selectedIndex, setSelectedIndex] = useState(initialSelectedIndex ?? 0);
  const [selectedDetail, setSelectedDetail] = useState(
    initialResults?.[initialSelectedIndex ?? 0]?.detail ??
      "Type a title and press Enter to search.",
  );
  const [resultSubtitle, setResultSubtitle] = useState(initialResultSubtitle ?? "");
  const [searchState, setSearchState] = useState<"idle" | "loading" | "ready" | "error">(
    initialResults && initialResults.length > 0 ? "ready" : "idle",
  );
  const [lastSearchedQuery, setLastSearchedQuery] = useState(
    initialResults && initialResults.length > 0 ? (initialQuery ?? "") : "",
  );
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draftQuery, setDraftQuery] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [emptyMessage, setEmptyMessage] = useState("Type a title and press Enter to search.");
  const [activeFilterBadges, setActiveFilterBadges] = useState<readonly string[]>([]);
  const requestIdRef = useRef(0);
  const { poster, posterState } = usePosterPreview(options[selectedIndex]?.previewImageUrl, {
    rows: 10,
    cols: 24,
    enabled: viewport.wideBrowse,
    debounceMs: 120,
  });

  const clearResults = () => {
    setOptions([]);
    setSelectedIndex(0);
    setSearchState("idle");
    setLastSearchedQuery("");
    setErrorMessage(null);
    setEmptyMessage("Type a title and press Enter to search.");
    setResultSubtitle("");
    setSelectedDetail("Type a title and press Enter to search.");
    setActiveFilterBadges([]);
  };

  const updateQuery = (nextValue: string) => {
    const normalized = normalizeReservedCommandInput(nextValue);
    setQuery(normalized.value);
    setHistoryIndex(-1);
    if (normalized.openCommandPalette) {
      setCommandMode(true);
      setCommandInput("");
      setHighlightedCommandIndex(0);
    }
    if (normalized.value.trim().length === 0) {
      clearResults();
    }
  };

  const handleQuerySubmit = () => {
    if (!queryDirty && selectedOption && options.length > 0 && searchState === "ready") {
      onSubmit(selectedOption.value);
      return;
    }
    void runSearch();
  };

  const runSearch = async () => {
    const parsedQuery = parseBrowseFilterQuery(query);
    const trimmed = parsedQuery.searchQuery.trim();
    const rawQuery = query.trim();
    const hasFilters = hasBrowseResultFilters(parsedQuery.filters);
    if (rawQuery.length === 0 || (trimmed.length === 0 && !hasFilters) || searchState === "loading")
      return;
    const filterBadges = describeBrowseResultFilters(parsedQuery.filters);

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setSearchState("loading");
    setErrorMessage(null);
    setEmptyMessage("Searching…");
    setSelectedDetail("Finding titles and available matches…");

    try {
      const response = await onSearch(rawQuery);
      if (requestIdRef.current !== requestId) return;
      const needsLocalFilters =
        response.localFilterBadges === undefined && response.upstreamFilterBadges === undefined;
      const filteredOptions = needsLocalFilters
        ? applyBrowseResultFilters(response.options, parsedQuery.filters)
        : response.options;
      const activeBadges = [
        ...(response.upstreamFilterBadges ?? filterBadges).map((badge) => `upstream ${badge}`),
        ...(response.localFilterBadges ?? []).map((badge) => `local ${badge}`),
        ...(response.unsupportedFilterBadges ?? []).map((badge) => `unsupported ${badge}`),
      ];
      const filterSuffix = activeBadges.length > 0 ? `  ·  ${activeBadges.join(", ")}` : "";

      setLastSearchedQuery(rawQuery);
      addSearchQuery(rawQuery);
      setOptions(filteredOptions);
      setSelectedIndex(0);
      setResultSubtitle(`${response.subtitle}${filterSuffix}`);
      setEmptyMessage(
        activeBadges.length > 0
          ? "No results matched those filters."
          : (response.emptyMessage ?? "No results found."),
      );
      setActiveFilterBadges(activeBadges);
      setSearchState("ready");
      setSelectedDetail(
        filteredOptions[0]?.detail ?? "Use ↑↓ to move through results, then press Enter.",
      );
    } catch (error) {
      if (requestIdRef.current !== requestId) return;

      setSearchState("error");
      setOptions([]);
      setSelectedIndex(0);
      setErrorMessage(String(error));
      setEmptyMessage("Search failed.");
      setSelectedDetail("The search failed. Press Enter to retry or Esc to clear.");
    }
  };

  const loadDiscovery = async () => {
    if (!onLoadDiscovery || searchState === "loading") return;

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setQuery("");
    setSearchState("loading");
    setErrorMessage(null);
    setEmptyMessage("Loading trending…");
    setSelectedDetail("Loading cached trending titles…");

    try {
      const response = await onLoadDiscovery();
      if (requestIdRef.current !== requestId) return;

      setLastSearchedQuery("");
      setOptions(response.options);
      setSelectedIndex(0);
      setResultSubtitle(response.subtitle);
      setEmptyMessage(response.emptyMessage ?? "Trending is unavailable right now.");
      setActiveFilterBadges([]);
      setSearchState("ready");
      setSelectedDetail(response.options[0]?.detail ?? "Use ↑↓ to move through trending titles.");
    } catch (error) {
      if (requestIdRef.current !== requestId) return;

      setSearchState("error");
      setOptions([]);
      setSelectedIndex(0);
      setErrorMessage(String(error));
      setEmptyMessage("Trending failed.");
      setSelectedDetail("Trending failed. Use search or press Ctrl+T to retry.");
    }
  };

  const loadRecommendations = async () => {
    if (!onLoadRecommendations || searchState === "loading") return;

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setQuery("");
    setSearchState("loading");
    setErrorMessage(null);
    setEmptyMessage("Loading recommendations…");
    setSelectedDetail("Building personalized recommendations from history and TMDB…");

    try {
      const response = await onLoadRecommendations();
      if (requestIdRef.current !== requestId) return;

      setLastSearchedQuery("");
      setOptions(response.options);
      setSelectedIndex(0);
      setResultSubtitle(response.subtitle);
      setEmptyMessage(response.emptyMessage ?? "Recommendations are unavailable right now.");
      setActiveFilterBadges([]);
      setSearchState("ready");
      setSelectedDetail(
        response.options[0]?.detail ?? "Use ↑↓ to move through recommendation picks.",
      );

      if (response.revalidate) {
        void response.revalidate
          .then((nextResponse) => {
            if (requestIdRef.current !== requestId) return undefined;
            setOptions(nextResponse.options);
            setSelectedIndex(0);
            setResultSubtitle(nextResponse.subtitle);
            setEmptyMessage(
              nextResponse.emptyMessage ?? "Recommendations are unavailable right now.",
            );
            setSelectedDetail(
              nextResponse.options[0]?.detail ?? "Use ↑↓ to move through recommendation picks.",
            );
            return undefined;
          })
          .catch(() => {
            // keep current recommendation results; background revalidation is best-effort
            return undefined;
          });
      }
    } catch (error) {
      if (requestIdRef.current !== requestId) return;

      setSearchState("error");
      setOptions([]);
      setSelectedIndex(0);
      setErrorMessage(String(error));
      setEmptyMessage("Recommendations failed.");
      setSelectedDetail("Recommendation loading failed. Try /recommendation again.");
    }
  };

  const closeOverlay = () => {
    setActiveOverlay(null);
  };

  const openDetailsOverlay = () => {
    const panel = buildBrowseDetailsPanel(selectedOption);
    setCommandMode(false);
    setActiveOverlay({
      type: "details",
      title: panel.title,
      subtitle: panel.subtitle,
      lines: panel.lines,
      imageUrl: panel.imageUrl,
      loading: false,
      scrollIndex: 0,
    });
  };

  const handleLocalAction = (action: ShellAction): boolean => {
    if (action === "details") {
      openDetailsOverlay();
      return true;
    }
    if (action === "trending") {
      setCommandMode(false);
      setCommandInput("");
      setHighlightedCommandIndex(0);
      void loadDiscovery();
      return true;
    }
    if (action === "recommendation") {
      setCommandMode(false);
      setCommandInput("");
      setHighlightedCommandIndex(0);
      void loadRecommendations();
      return true;
    }
    return false;
  };

  useEffect(() => {
    if (options.length === 0) {
      setSelectedIndex(0);
      return;
    }
    setSelectedIndex((current) => Math.min(current, options.length - 1));
  }, [options.length]);

  useEffect(() => {
    const option = options[selectedIndex];
    if (!option) {
      return;
    }
    setSelectedDetail(option.detail ?? "Press Enter to select this result.");
  }, [options, selectedIndex]);

  useEffect(() => {
    if (!commandMode) {
      setHighlightedCommandIndex(0);
      return;
    }

    const matches = getCommandMatches(commandInput, commands);
    setHighlightedCommandIndex((current) => {
      if (matches.length === 0) return 0;
      return Math.min(current, matches.length - 1);
    });
  }, [commandInput, commandMode, commands]);

  const queryDirty = query.trim() !== lastSearchedQuery;
  const selectedOption = options[selectedIndex];
  const companionPanel = buildBrowseCompanionPanel(selectedOption, { selectedDetail });
  const {
    compact,
    ultraCompact,
    tooSmall,
    wideBrowse,
    minColumns,
    minRows,
    maxVisibleRows: maxVisible,
  } = viewport;
  const effectiveFooterMode = "minimal";
  const innerWidth = Math.max(24, viewport.columns - 8);
  const previewWidth = wideBrowse ? Math.max(28, Math.floor(innerWidth * 0.3)) : innerWidth;
  const listWidth = wideBrowse ? Math.max(48, innerWidth - previewWidth - 4) : innerWidth;
  const rowWidth = Math.max(20, listWidth - 4);
  const windowStart = getWindowStart(selectedIndex, options.length, maxVisible);
  const windowEnd = Math.min(windowStart + maxVisible, options.length);
  const visibleOptions = options.slice(windowStart, windowEnd);
  const previewBodyLines = wrapText(
    companionPanel.body,
    Math.max(previewWidth - 2, 24),
    ultraCompact ? 1 : 2,
  );
  const showCompanion =
    wideBrowse &&
    !compact &&
    Boolean(
      poster.kind !== "none" ||
      companionPanel.title ||
      companionPanel.metaLine ||
      previewBodyLines.some((line) => line.trim().length > 0) ||
      companionPanel.facts.length > 0,
    );
  useInput((input, key) => {
    if ((input === "c" && key.ctrl) || input === "\x03") {
      requestHardExit(0);
    }

    if (activeOverlay) {
      if (input === "/") {
        return;
      }

      if (key.escape) {
        closeOverlay();
        return;
      }

      if (activeOverlay.type === "episode-picker") {
        return;
      }

      if ("lines" in activeOverlay && (key.upArrow || key.downArrow) && !activeOverlay.loading) {
        if (activeOverlay.lines.length === 0) {
          return;
        }
        const maxScroll = Math.max(0, activeOverlay.lines.length - 1);
        const nextScroll = key.upArrow
          ? Math.max(0, (activeOverlay.scrollIndex ?? 0) - 1)
          : Math.min(maxScroll, (activeOverlay.scrollIndex ?? 0) + 1);
        setActiveOverlay({ ...activeOverlay, scrollIndex: nextScroll });
      }
      return;
    }

    if (commandMode) {
      const matches = getCommandMatches(commandInput, commands);

      if (key.escape) {
        setCommandMode(false);
        setCommandInput("");
        setHighlightedCommandIndex(0);
        return;
      }
      if (key.return) {
        const resolved = getHighlightedCommand(commandInput, commands, highlightedCommandIndex);
        if (resolved?.enabled) {
          const action = toShellAction(resolved.id);
          if (!handleLocalAction(action)) {
            onResolve(action);
          }
        }
        return;
      }
      if (key.tab) {
        const nextIndex = matches.length > 0 ? (highlightedCommandIndex + 1) % matches.length : 0;
        const target = matches[nextIndex];
        if (target) {
          setHighlightedCommandIndex(nextIndex);
          commandEditor.setValue(target.aliases[0] ?? target.id);
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

    if (input === "/") {
      setCommandMode(true);
      setCommandInput("");
      setHighlightedCommandIndex(0);
      return;
    }

    if ((input === "t" && key.ctrl) || input === "\x14") {
      void loadDiscovery();
      return;
    }

    if ((input === "d" && key.ctrl) || input === "\x04") {
      if (selectedOption && options.length > 0 && !queryDirty && searchState === "ready") {
        onResolve("download");
      }
      return;
    }

    if (key.tab) {
      onResolve("toggle-mode");
      return;
    }

    if (key.escape) {
      if (options.length > 0 || searchState === "error" || searchState === "loading") {
        clearResults();
        return;
      }
      if (query.length > 0) {
        updateQuery("");
        return;
      }
      onCancel();
      return;
    }

    if (key.upArrow && options.length > 0) {
      setSelectedIndex((current) => (current - 1 + options.length) % options.length);
      return;
    }

    if (key.downArrow && options.length > 0) {
      setSelectedIndex((current) => (current + 1) % options.length);
      return;
    }

    if (key.upArrow && options.length === 0) {
      const history = getSearchHistory();
      if (history.length === 0) return;
      const nextIndex = historyIndex + 1;
      if (nextIndex >= history.length) return;
      if (historyIndex === -1) setDraftQuery(query);
      setHistoryIndex(nextIndex);
      setQuery(history[nextIndex] ?? "");
      return;
    }

    if (key.downArrow && options.length === 0) {
      if (historyIndex <= 0) {
        setHistoryIndex(-1);
        setQuery(draftQuery);
        return;
      }
      const history = getSearchHistory();
      const nextIndex = historyIndex - 1;
      setHistoryIndex(nextIndex);
      setQuery(history[nextIndex] ?? "");
      return;
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box flexDirection="column" flexGrow={1}>
        <Box justifyContent="space-between">
          <BrowseTitle mode={mode} />
          <Text color={searchState === "error" ? palette.red : palette.info}>
            {searchState === "loading"
              ? `${spinner} searching`
              : searchState === "error"
                ? "search failed"
                : searchState === "ready" && options.length > 0
                  ? `${options.length} results`
                  : "ready"}
          </Text>
        </Box>
        {!ultraCompact && resultSubtitle ? (
          <Text color={palette.muted}>{resultSubtitle}</Text>
        ) : null}
        {activeFilterBadges.length > 0 && !ultraCompact ? (
          <Box marginTop={1} flexWrap="wrap">
            <Text color={palette.gray}>Filters </Text>
            {activeFilterBadges.map((filter) => (
              <Box key={filter} marginRight={1}>
                <InlineBadge label={filter} tone="info" />
              </Box>
            ))}
          </Box>
        ) : null}
        <Box marginTop={1}>
          <ContextStrip
            items={[
              { label: `Provider ${provider}`, tone: "info" },
              { label: mode === "anime" ? "Anime" : "Series" },
              ...(activeOverlay ? [{ label: activeOverlay.title, tone: "success" } as const] : []),
              ...(queryDirty && options.length > 0
                ? [{ label: "Results need refresh", tone: "warning" } as const]
                : []),
              ...activeFilterBadges.map((filter) => ({
                label: `Filter ${filter}`,
                tone: "info" as const,
              })),
            ]}
          />
        </Box>

        <InputField
          label="Search title"
          value={query}
          onChange={updateQuery}
          onSubmit={handleQuerySubmit}
          placeholder={placeholder}
          focus={!commandMode}
          hint="Tokens: type:series year:2008 rating:8 · /filters for guided chips"
          maxWidth={innerWidth}
          onRedraw={clearShellScreen}
        />

        {queryDirty && options.length > 0 && !ultraCompact ? (
          <Text color={palette.gray}>Query changed · Press Enter to refresh results</Text>
        ) : null}

        <Box marginTop={1}>
          <Text color={palette.gray} dimColor>
            {"─".repeat(innerWidth)}
          </Text>
        </Box>

        {searchState === "error" && errorMessage ? (
          <Box marginTop={1} flexDirection="column">
            <Text color={palette.red}>{errorMessage}</Text>
            <Text color={palette.muted} dimColor>
              Press Enter to retry or Esc to clear
            </Text>
          </Box>
        ) : null}

        {tooSmall ? (
          <ResizeBlocker
            minColumns={minColumns}
            minRows={minRows}
            message="Resize terminal to browse results"
          />
        ) : activeOverlay ? (
          <OverlayPanel overlay={activeOverlay} width={innerWidth} />
        ) : options.length > 0 ? (
          <Box
            flexDirection={showCompanion ? "row" : "column"}
            marginTop={1}
            justifyContent="space-between"
            flexGrow={1}
          >
            {/* Result list */}
            <Box flexDirection="column" width={showCompanion ? listWidth : undefined}>
              {windowStart > 0 ? <Text color={palette.gray}> ▲ ...</Text> : null}
              {visibleOptions.map((option, index) => {
                const optionIndex = windowStart + index;
                const selected = optionIndex === selectedIndex;
                const previousGroup =
                  optionIndex > 0 ? options[optionIndex - 1]?.previewGroup : null;
                const showGroupHeader =
                  option.previewGroup && option.previewGroup !== previousGroup;
                const metaText = option.previewBadge ?? option.previewMeta?.[0];
                const metaWidth = metaText ? Math.min(12, Math.max(6, metaText.length)) : 0;
                const timeText = option.previewTime ?? "";
                const timeWidth = option.previewTime ? 6 : 0;
                const titleBudget = Math.max(12, rowWidth - metaWidth - timeWidth - 6);
                const titleText = truncateLine(option.label, titleBudget);
                const metaSegment = metaText ? truncateLine(metaText, metaWidth) : "";
                const titleSegment = timeText
                  ? `${timeText.padEnd(timeWidth)}  ${titleText}`
                  : titleText;
                const rowText = metaText
                  ? `${titleSegment.padEnd(titleBudget + timeWidth + (timeText ? 2 : 0))} ${metaSegment.padStart(metaWidth)}`
                  : titleSegment;

                return (
                  <Box
                    key={`${option.label}-${option.detail ?? ""}`}
                    flexDirection="column"
                    width={rowWidth}
                  >
                    {showGroupHeader ? (
                      <Text color={palette.amber} bold>
                        {`  ${option.previewGroup}`}
                      </Text>
                    ) : null}
                    <Box width={rowWidth}>
                      <Text
                        backgroundColor={selected ? palette.teal : undefined}
                        color={selected ? "black" : "white"}
                        bold={selected}
                        dimColor={!selected}
                        wrap="truncate"
                      >
                        <Text color={selected ? "black" : palette.gray}>
                          {selected ? "❯ " : "  "}
                        </Text>
                        {truncateLine(rowText, rowWidth - 2).padEnd(rowWidth - 2)}
                      </Text>
                    </Box>
                  </Box>
                );
              })}
              {windowEnd < options.length ? <Text color={palette.gray}> ▼ ...</Text> : null}
            </Box>

            {/* Companion pane */}
            {showCompanion ? (
              <Box
                key={`browse-companion-${selectedIndex}-${selectedOption?.label ?? "none"}`}
                marginLeft={2}
                flexDirection="column"
                width={previewWidth}
              >
                {poster.kind !== "none" ? (
                  <Box flexDirection="column" marginBottom={1}>
                    <Text>{poster.placeholder}</Text>
                  </Box>
                ) : selectedOption?.previewImageUrl ? (
                  <Box marginBottom={1}>
                    <Text color={posterState === "loading" ? palette.info : palette.gray} dimColor>
                      {posterState === "loading" ? "Loading artwork…" : "Artwork unavailable"}
                    </Text>
                  </Box>
                ) : null}
                <Text bold color={palette.amber}>
                  {truncateLine(companionPanel.title, previewWidth)}
                </Text>
                {companionPanel.metaLine && !ultraCompact ? (
                  <Box marginTop={1}>
                    <Text color={palette.gray}>
                      {truncateLine(companionPanel.metaLine, previewWidth)}
                    </Text>
                  </Box>
                ) : null}
                {previewBodyLines.length > 0 ? (
                  <Box marginTop={1} flexDirection="column">
                    {previewBodyLines.map((line) => (
                      <Text
                        key={`${selectedOption?.label ?? "selected"}-${line}`}
                        color={palette.muted}
                      >
                        {line}
                      </Text>
                    ))}
                  </Box>
                ) : null}
                {!ultraCompact ? (
                  <Box marginTop={1} flexDirection="column">
                    {companionPanel.facts.slice(0, compact ? 2 : 4).map((fact) => (
                      <DetailLine
                        key={`${selectedOption?.label ?? "selected"}-${fact.label}`}
                        label={fact.label}
                        value={truncateLine(fact.detail ?? "", Math.max(18, previewWidth - 16))}
                        tone={fact.tone === "error" ? "warning" : fact.tone}
                      />
                    ))}
                  </Box>
                ) : null}
              </Box>
            ) : (
              <Box marginTop={1} flexDirection="column">
                <Text bold color={palette.amber}>
                  {truncateLine(companionPanel.title, innerWidth)}
                </Text>
                {companionPanel.metaLine ? (
                  <Text color={palette.gray}>
                    {truncateLine(companionPanel.metaLine, innerWidth)}
                  </Text>
                ) : null}
                {previewBodyLines.length > 0 ? (
                  <Text color={palette.muted}>{previewBodyLines[0]}</Text>
                ) : null}
              </Box>
            )}
          </Box>
        ) : searchState === "ready" && lastSearchedQuery.length > 0 ? (
          <Box marginTop={2} flexDirection="column">
            <Text color={palette.amber}>{`No results for "${lastSearchedQuery}"`}</Text>
            <Text color={palette.gray} dimColor>
              Try a different spelling, or switch provider with /provider
            </Text>
          </Box>
        ) : (
          <Box marginTop={1}>
            <Text color={palette.gray}>{emptyMessage}</Text>
          </Box>
        )}
      </Box>

      {commandMode ? (
        <CommandPalette
          input={commandInput}
          cursor={commandEditor.cursor}
          commands={commands}
          highlightedIndex={highlightedCommandIndex}
        />
      ) : null}

      {_settings?.discoverShowOnStartup && (
        <Text color={palette.dim}>/ recommendation · based on your history</Text>
      )}
      <ShellFooter
        taskLabel={options.length > 0 && !queryDirty ? "Browse" : "Search"}
        mode={effectiveFooterMode}
        commandMode={commandMode}
        actions={[
          {
            key: "enter",
            label: options.length > 0 && !queryDirty ? "open" : "search",
            action: "search",
          },
          { key: "↑↓", label: "navigate", action: "search" },
          {
            key: "tab",
            label: getCommandLabel(commands, "toggle-mode", "switch mode"),
            action: "toggle-mode",
          },
          { key: "/", label: "commands", action: "command-mode" },
          ...(onLoadDiscovery
            ? [{ key: "ctrl+t", label: "trending", action: "trending" as const }]
            : []),
          ...(options.length > 0 && !queryDirty
            ? [{ key: "^D", label: "download", action: "download" as const }]
            : []),
          { key: "esc", label: "clear/back", action: "quit" },
        ]}
      />
    </Box>
  );
}

export function openBrowseShell<T>({
  mode,
  provider,
  initialQuery,
  initialResults,
  initialResultSubtitle,
  initialSelectedIndex,
  placeholder,
  commands,
  providerOptions,
  loadHistoryPanel,
  loadDiagnosticsPanel,
  loadHelpPanel,
  loadAboutPanel,
  onChangeProvider,
  onSearch,
  onLoadDiscovery,
  onLoadRecommendations,
  footerMode,
  settings,
  settingsSeriesProviderOptions,
  settingsAnimeProviderOptions,
  onSaveSettings,
}: {
  mode: "series" | "anime";
  provider: string;
  initialQuery?: string;
  initialResults?: readonly BrowseShellOption<T>[];
  initialResultSubtitle?: string;
  initialSelectedIndex?: number;
  placeholder: string;
  commands: readonly ResolvedAppCommand[];
  providerOptions?: readonly ShellPickerOption<string>[];
  loadHistoryPanel?: () => Promise<readonly ShellPanelLine[]>;
  loadDiagnosticsPanel?: () => Promise<readonly ShellPanelLine[]>;
  loadHelpPanel?: () => Promise<readonly ShellPanelLine[]>;
  loadAboutPanel?: () => Promise<readonly ShellPanelLine[]>;
  onChangeProvider?: (providerId: string) => Promise<void>;
  onSearch: (query: string) => Promise<BrowseShellSearchResponse<T>>;
  onLoadDiscovery?: () => Promise<BrowseShellSearchResponse<T>>;
  onLoadRecommendations?: () => Promise<BrowseShellSearchResponse<T>>;
  footerMode?: ShellFooterMode;
  settings?: KitsuneConfig;
  settingsSeriesProviderOptions?: readonly ShellPickerOption<string>[];
  settingsAnimeProviderOptions?: readonly ShellPickerOption<string>[];
  onSaveSettings?: (next: KitsuneConfig) => Promise<void>;
}): Promise<BrowseShellResult<T>> {
  const session = mountRootContent<BrowseShellResult<T>>({
    kind: "browse",
    renderContent: (finish) => (
      <BrowseShell
        mode={mode}
        provider={provider}
        initialQuery={initialQuery}
        initialResults={initialResults}
        initialResultSubtitle={initialResultSubtitle}
        initialSelectedIndex={initialSelectedIndex}
        placeholder={placeholder}
        commands={commands}
        providerOptions={providerOptions}
        loadHistoryPanel={loadHistoryPanel}
        loadDiagnosticsPanel={loadDiagnosticsPanel}
        loadHelpPanel={loadHelpPanel}
        loadAboutPanel={loadAboutPanel}
        onChangeProvider={onChangeProvider}
        onSearch={onSearch}
        onLoadDiscovery={onLoadDiscovery}
        onLoadRecommendations={onLoadRecommendations}
        footerMode={footerMode}
        settings={settings}
        settingsSeriesProviderOptions={settingsSeriesProviderOptions}
        settingsAnimeProviderOptions={settingsAnimeProviderOptions}
        onSaveSettings={onSaveSettings}
        onResolve={(action) => finish({ type: "action", action })}
        onSubmit={(value) => finish({ type: "selected", value })}
        onCancel={() => finish({ type: "cancelled" })}
      />
    ),
    fallbackValue: { type: "cancelled" },
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
