import { getShellViewportPolicy } from "@/app-shell/layout-policy";
import { useLineEditor } from "@/app-shell/line-editor";
import { switchSessionMode } from "@/app/mode-switch";
import type { Container } from "@/container";
import { effectiveFooterHints } from "@/container";
import type { SessionStateManager } from "@/domain/session/SessionStateManager";
import { isKittyCompatible } from "@/image";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { Box, Text, render, useInput, useStdout } from "ink";
import React, { useEffect, useRef, useState } from "react";

import type { ResolvedAppCommand } from "./commands";
import { buildBrowseCompanionPanel, buildBrowseDetailsPanel } from "./details-panel";
import { deleteAllKittyImages, isChafaAvailable } from "./image-pane";
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
import {
  CommandPalette,
  fallbackCommandState,
  getCommandMatches,
  getHighlightedCommand,
} from "./shell-command-ui";
import { footerActionFromCommand, getCommandLabel, InputField, ShellFrame } from "./shell-frame";
import {
  Badge,
  BrowseTitle,
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
} from "./types";
import { usePosterPreview } from "./use-poster-preview";

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

    // Keep one persistent ref to prevent event loop drainage
    process.stdin.ref();

    // Handle Ctrl+C in raw mode (Ink sets raw mode, so SIGINT won't fire)
    process.stdin.on("data", (chunk: Buffer) => {
      const data = chunk.toString();
      if (data === "\x03" || data === "\x04") {
        // Ctrl+C or Ctrl+D
        this.cleanup();
        process.exit(0);
      }
    });
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

const SCREEN_CLEAR_GRACE_MS = 140;

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
 * Clears the terminal screen using ANSI escape codes.
 */
export function clearShellScreen() {
  if (process.stdout.isTTY) {
    deleteAllKittyImages();
    process.stdout.write("\x1b[2J\x1b[H");
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

  // When mounting a new shell, if it's a "major" transition (clearOnResolve was true for previous),
  // we might want to clear. But usually ensureRootShell handles the first clear.
  // To make transitions "really good", we ensure the screen is cleared if we're swapping
  // from null to a component.
  if (!rootShellScreen && clearOnResolve) {
    clearShellScreen();
  }

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
  const [state, setState] = useState(stateManager.getState());

  useEffect(() => {
    return stateManager.subscribe((nextState) => {
      setState(nextState);
    });
  }, [stateManager]);

  return state;
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

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const chafaAvailable = await isChafaAvailable();
      if (cancelled) return;
      stateManager.dispatch({
        type: "SET_IMAGE_SUPPORT",
        supported: isKittyCompatible() || chafaAvailable,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [stateManager]);

  const activePlaybackStatuses = ["ready", "buffering", "seeking", "stalled", "playing"] as const;
  const playbackIsActive = activePlaybackStatuses.some((status) => status === state.playbackStatus);
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
  const playbackSubtitleStatus =
    state.subLang === "none"
      ? "subtitles disabled"
      : state.stream?.subtitle
        ? "subtitle attached"
        : state.stream?.subtitleList?.length
          ? `${state.stream.subtitleList.length} subtitle tracks available`
          : "subtitles not found";
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
    (state.playbackStatus === "playing"
      ? "Auto-skip and live playback controls stay available while mpv is active"
      : undefined);
  const canGoNext = Boolean(isSeriesPlayback && state.episodeNavigation.hasNext);
  const canGoPrevious = Boolean(isSeriesPlayback && state.episodeNavigation.hasPrevious);
  const canToggleAutoplay = Boolean(isSeriesPlayback);
  const canStopAfterCurrent = Boolean(isSeriesPlayback);
  const playbackCanCancel =
    state.playbackStatus === "loading" ||
    state.playbackStatus === "ready" ||
    state.playbackStatus === "buffering" ||
    state.playbackStatus === "seeking" ||
    state.playbackStatus === "stalled";

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
            {rootStatusSummary.header.label}
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
        <Box marginTop={1} flexDirection="column" flexGrow={1} justifyContent="space-between">
          <Box flexDirection="column" flexGrow={1}>
            {rootSurface === "error" ? (
              <ErrorShell
                message={state.playbackError || "An unknown error occurred"}
                onResolve={() =>
                  stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" })
                }
              />
            ) : rootSurface === "playback" ? (
              <LoadingShell
                key={`playback-ep-${state.currentTitle?.id ?? "none"}:${state.currentEpisode?.season ?? 0}:${state.currentEpisode?.episode ?? 0}`}
                state={{
                  title: state.currentTitle?.name || "Resolving...",
                  subtitle: playbackSubtitle,
                  operation:
                    state.playbackStatus === "playing"
                      ? "playing"
                      : state.playbackStatus === "loading" || state.playbackStatus === "buffering"
                        ? "loading"
                        : "resolving",
                  details: state.playbackDetail ?? `Provider: ${state.provider}`,
                  subtitleStatus:
                    state.playbackStatus === "playing" ||
                    state.playbackStatus === "buffering" ||
                    state.playbackStatus === "stalled"
                      ? playbackSubtitleStatus
                      : undefined,
                  cancellable: playbackCanCancel,
                  trace: playbackTrace,
                  showMemory: false,
                  stopHint:
                    state.playbackStatus === "playing" ||
                    state.playbackStatus === "buffering" ||
                    state.playbackStatus === "stalled"
                      ? state.currentTitle?.type === "series"
                        ? `q stop  ·  ${canGoNext ? "n next" : "n unavailable"}  ·  ${canGoPrevious ? "p previous" : "p unavailable"}  ·  ${state.stopAfterCurrent ? "x resume chain" : "x stop after current"}`
                        : "q stop"
                      : undefined,
                  controlHint:
                    state.playbackStatus === "playing" ||
                    state.playbackStatus === "buffering" ||
                    state.playbackStatus === "stalled"
                      ? `${canToggleAutoplay ? (state.autoplaySessionPaused ? "a resume autoplay" : "a pause autoplay") : "a unavailable"}  ·  b skip segment  ·  s reload subtitles  ·  r refresh  ·  f fallback  ·  Ctrl+C hard exit`
                      : undefined,
                  commands: fallbackCommandState([
                    "settings",
                    "provider",
                    "history",
                    "diagnostics",
                    "help",
                    "about",
                    "quit",
                  ]),
                  footerMode: effectiveFooterHints(container),
                  onCommandAction: (action) => {
                    if (action === "command-mode") return;
                    if (action === "search") {
                      void container.playerControl.refreshCurrentPlayback(
                        "playback-loading-command-refresh",
                      );
                      return;
                    }
                    if (action === "provider") {
                      void container.playerControl.fallbackCurrentPlayback(
                        "playback-loading-command-fallback",
                      );
                      return;
                    }
                    if (action === "quit") {
                      void container.playerControl.stopCurrentPlayback(
                        "playback-loading-command-stop",
                      );
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
                        if (process.stdin.isTTY) process.stdin.unref();
                        process.exit(0);
                      }
                    })();
                  },
                }}
                onCancel={() => {
                  const cancelledWork = container.workControl.cancelActive("playback-loading-esc");
                  if (!cancelledWork) {
                    void container.playerControl.stopCurrentPlayback("playback-loading-esc");
                  }
                }}
                onStop={() => {
                  void container.playerControl.stopCurrentPlayback("playback-shell-q");
                }}
                onNext={
                  canGoNext
                    ? () => {
                        void container.playerControl.nextCurrentPlayback("playback-shell-n");
                      }
                    : undefined
                }
                onPrevious={
                  canGoPrevious
                    ? () => {
                        void container.playerControl.previousCurrentPlayback("playback-shell-p");
                      }
                    : undefined
                }
                onRefresh={() => {
                  void container.playerControl.refreshCurrentPlayback("playback-shell-r");
                }}
                onFallback={() => {
                  void container.playerControl.fallbackCurrentPlayback("playback-shell-f");
                }}
                onReloadSubtitles={() => {
                  void container.playerControl.reloadCurrentSubtitles("playback-shell-s");
                }}
                onSkipSegment={() => {
                  void container.playerControl.skipCurrentSegment("playback-shell-i");
                }}
                onToggleAutoplay={
                  canToggleAutoplay
                    ? () => {
                        container.stateManager.dispatch({
                          type: "SET_SESSION_AUTOPLAY_PAUSED",
                          paused: !container.stateManager.getState().autoplaySessionPaused,
                        });
                      }
                    : undefined
                }
                onStopAfterCurrent={
                  canStopAfterCurrent
                    ? () => {
                        container.stateManager.dispatch({
                          type: "SET_SESSION_STOP_AFTER_CURRENT",
                          enabled: !container.stateManager.getState().stopAfterCurrent,
                        });
                      }
                    : undefined
                }
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
  episodePickerOptions,
  episodePickerSubtitle,
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
  const [activeOverlay, setActiveOverlay] = useState<BrowseOverlay | null>(null);
  const activeOverlayEditor = useLineEditor({
    value:
      activeOverlay && activeOverlay.type === "episode-picker" ? activeOverlay.filterQuery : "",
    onChange: (nextValue) => {
      setActiveOverlay((current) =>
        current && current.type === "episode-picker"
          ? { ...current, filterQuery: nextValue, selectedIndex: 0 }
          : current,
      );
    },
    onRedraw: clearShellScreen,
  });
  const { stdout } = useStdout();
  const playbackViewport = getShellViewportPolicy("playback", stdout.columns, stdout.rows);
  const playbackWide = (stdout.columns ?? 0) >= 150;
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

  const commands =
    state.commands ??
    fallbackCommandState([
      "search",
      "settings",
      "toggle-mode",
      "provider",
      "history",
      "toggle-autoplay",
      "replay",
      "pick-episode",
      "next",
      "previous",
      "next-season",
      "diagnostics",
      "help",
      "quit",
    ]);
  const footerActions: readonly FooterAction[] = [
    { key: "/", label: "commands", action: "command-mode" },
    ...(state.resumeLabel
      ? ([
          { key: "c", label: state.resumeLabel, action: "resume" as const },
        ] satisfies readonly FooterAction[])
      : []),
    footerActionFromCommand(
      commands,
      "toggle-autoplay",
      { key: "a", label: getCommandLabel(commands, "toggle-autoplay", "autoplay") },
      toShellAction,
    ),
    footerActionFromCommand(commands, "replay", { key: "r", label: "replay" }, toShellAction),
    footerActionFromCommand(commands, "search", { key: "f", label: "search" }, toShellAction),
    footerActionFromCommand(
      commands,
      "pick-episode",
      { key: "e", label: "episodes" },
      toShellAction,
    ),
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
    footerActionFromCommand(commands, "quit", { key: "q", label: "quit" }, toShellAction),
  ];

  const location =
    state.type === "series"
      ? `S${String(state.season).padStart(2, "0")}E${String(state.episode).padStart(2, "0")}`
      : "Movie";
  const playbackSubtitleTone =
    state.subtitleStatus?.toLowerCase().includes("not found") ||
    state.subtitleStatus?.toLowerCase().includes("disabled")
      ? "warning"
      : "success";

  const handleLocalAction = (action: ShellAction): boolean => {
    if (action === "pick-episode" && episodePickerOptions && episodePickerOptions.length > 0) {
      setActiveOverlay({
        type: "episode-picker",
        title: "Choose episode",
        subtitle: episodePickerSubtitle ?? `${episodePickerOptions.length} episodes available`,
        options: episodePickerOptions,
        filterQuery: "",
        selectedIndex: 0,
        busy: false,
      });
      return true;
    }
    return false;
  };

  const filteredOverlayOptions =
    activeOverlay && activeOverlay.type === "episode-picker"
      ? activeOverlay.options.filter((option) => {
          const filter = activeOverlay.filterQuery.trim().toLowerCase();
          if (filter.length === 0) return true;
          return `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(filter);
        })
      : [];

  const resolvePlaybackAction = (action: ShellAction) => {
    if (!handleLocalAction(action)) {
      onResolve(action);
    }
  };

  useInput((input, key) => {
    if (activeOverlay) {
      if (input === "/") {
        return;
      }

      if (key.escape) {
        setActiveOverlay(null);
        return;
      }

      if (activeOverlay.type === "episode-picker") {
        if (key.upArrow && filteredOverlayOptions.length > 0) {
          setActiveOverlay({
            ...activeOverlay,
            selectedIndex:
              (activeOverlay.selectedIndex - 1 + filteredOverlayOptions.length) %
              filteredOverlayOptions.length,
          });
          return;
        }
        if (key.downArrow && filteredOverlayOptions.length > 0) {
          setActiveOverlay({
            ...activeOverlay,
            selectedIndex: (activeOverlay.selectedIndex + 1) % filteredOverlayOptions.length,
          });
          return;
        }
        if (key.return) {
          const target = filteredOverlayOptions[activeOverlay.selectedIndex];
          if (!target) return;
          const selection = decodeEpisodeSelectionValue(target.value);
          if (!selection) return;
          onResolve({
            type: "episode-selection",
            season: selection.season,
            episode: selection.episode,
          });
          return;
        }
        if (activeOverlayEditor.handleInput(input, key)) {
          return;
        }
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
  });

  return (
    <ShellFrame
      eyebrow={APP_LABEL}
      title={state.title}
      subtitle={`${location}  ·  Provider ${state.provider}  ·  Mode ${state.mode}`}
      status={state.status}
      footerTask="Playback"
      footerActions={footerActions}
      footerMode={state.footerMode}
      commands={commands}
      inputLocked={activeOverlay !== null}
      escapeAction="back-to-results"
      onResolve={resolvePlaybackAction}
    >
      {playbackViewport.tooSmall ? (
        <ResizeBlocker
          minColumns={playbackViewport.minColumns}
          minRows={playbackViewport.minRows}
          message="Resize terminal for playback controls"
        />
      ) : (
        <>
          <Box justifyContent="space-between">
            <Box>
              <Badge label={`provider ${state.provider}`} tone="info" />
              <Badge label={state.mode === "anime" ? "anime mode" : "series mode"} />
              <Badge label={`episode ${location.toLowerCase()}`} tone="accent" />
              {state.subtitleStatus ? (
                <Badge
                  label={state.subtitleStatus}
                  tone={
                    state.subtitleStatus.toLowerCase().includes("not found") ? "warning" : "success"
                  }
                />
              ) : null}
              <Badge
                label={state.autoplayPaused ? "autoplay paused" : "autoplay ready"}
                tone={state.autoplayPaused ? "warning" : "success"}
              />
              {activeOverlay ? (
                <Badge label={`${activeOverlay.title.toLowerCase()} panel`} tone="success" />
              ) : null}
            </Box>
            <Text color={palette.gray} dimColor>
              Playback controls stay visible and command-driven
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color={palette.gray} dimColor>
              {"─".repeat(Math.max(24, (stdout.columns ?? 80) - 8))}
            </Text>
          </Box>
          <Box flexDirection={showPosterCompanion ? "row" : "column"} marginTop={1} flexGrow={1}>
            <Box
              flexDirection="column"
              width={showPosterCompanion ? Math.max(56, (stdout.columns ?? 80) - 38) : undefined}
            >
              <Text bold color="white">
                {state.title}
              </Text>
              <Box marginTop={1}>
                <Badge label={location.toLowerCase()} tone="accent" />
                <Badge label={state.type === "series" ? "episode complete" : "playback complete"} />
                {state.status ? (
                  <Badge
                    label={state.status.label.toLowerCase()}
                    tone={state.status.tone === "success" ? "success" : "info"}
                  />
                ) : null}
              </Box>
              <Box marginTop={1} flexDirection="column">
                <DetailLine label="Provider" value={state.provider} tone="info" />
                <DetailLine
                  label="Subtitle state"
                  value={state.subtitleStatus ?? "not reported"}
                  tone={playbackSubtitleTone}
                />
                <DetailLine
                  label="Next step"
                  value={
                    state.resumeLabel
                      ? "Resume from your last stop, restart from the beginning, or move between episodes"
                      : "Replay, move episodes, or start a fresh search"
                  }
                />
                <DetailLine
                  label="Autoplay"
                  value={
                    state.autoplayPaused
                      ? "Paused for this playback chain only"
                      : "Ready to continue through the next available episode"
                  }
                  tone={state.autoplayPaused ? "warning" : "success"}
                />
                {state.showMemory && state.memoryUsage ? (
                  <DetailLine label="Memory" value={state.memoryUsage} />
                ) : null}
              </Box>
              <Box marginTop={1}>
                <Text color={palette.muted}>
                  Playback stays inside the shell now, so you can inspect the result, navigate to
                  the next episode, or jump back into search without leaving the fullscreen flow.
                </Text>
              </Box>
            </Box>

            {showPosterCompanion ? (
              <Box marginLeft={2} flexDirection="column" width={26}>
                <Box>
                  <Badge label="episode art" />
                  <Badge
                    label={
                      posterState === "loading"
                        ? "loading"
                        : posterState === "unavailable"
                          ? "unavailable"
                          : "ready"
                    }
                    tone={
                      posterState === "loading"
                        ? "info"
                        : posterState === "unavailable"
                          ? "warning"
                          : "success"
                    }
                  />
                </Box>
                <Box marginTop={1}>
                  {poster.kind === "kitty" ? (
                    <Text>{poster.placeholder}</Text>
                  ) : poster.kind === "chafa" ? (
                    <Box flexDirection="column">
                      {poster.art
                        .split("\n")
                        .slice(0, poster.rows)
                        .map((line) => (
                          <Text key={`playback-poster-${line}`}>{line}</Text>
                        ))}
                    </Box>
                  ) : (
                    <Box flexDirection="column">
                      <Text
                        color={posterState === "loading" ? palette.cyan : palette.gray}
                        dimColor
                      >
                        {posterState === "loading" ? "Loading poster…" : "Poster unavailable"}
                      </Text>
                      {posterState === "unavailable" ? (
                        <Text color={palette.gray} dimColor>
                          The current title did not expose usable artwork for this terminal pass.
                        </Text>
                      ) : null}
                    </Box>
                  )}
                </Box>
              </Box>
            ) : null}
          </Box>
          {activeOverlay ? (
            <OverlayPanel
              overlay={activeOverlay}
              width={Math.max(24, process.stdout.columns - 8)}
            />
          ) : null}
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

type ListOption<T> = {
  value: T;
  label: string;
  detail?: string;
};

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

export type ListShellActionContext = {
  commands: readonly ResolvedAppCommand[];
  onAction: (
    action: ShellAction,
  ) => Promise<"handled" | "quit" | "unhandled"> | "handled" | "quit" | "unhandled";
  taskLabel?: string;
  footerMode?: "detailed" | "minimal";
};

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
  options: readonly ListOption<T>[];
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
  const { stdout } = useStdout();
  const normalizedFilter = filterQuery.trim().toLowerCase();
  const filteredOptions = options.filter((option) => {
    if (normalizedFilter.length === 0) return true;
    const haystack = `${option.label} ${option.detail ?? ""}`.toLowerCase();
    return haystack.includes(normalizedFilter);
  });

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

  const viewport = getShellViewportPolicy("picker", stdout.columns, stdout.rows);
  const { ultraCompact, tooSmall, minColumns, minRows, maxVisibleRows: maxVisible } = viewport;
  const innerWidth = Math.max(24, stdout.columns - 8);
  const showSelectionCompanion = !tooSmall && !ultraCompact && (stdout.columns ?? 0) >= 152;
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

  const windowStart = getWindowStart(index, filteredOptions.length, maxVisible);
  const windowEnd = Math.min(windowStart + maxVisible, filteredOptions.length);
  const visibleOptions = filteredOptions.slice(windowStart, windowEnd);
  const footerTask =
    normalizedFilter.length > 0
      ? "Refine the filter or confirm the highlighted match"
      : (actionContext?.taskLabel ?? "Filter this list and confirm a selection");
  const effectiveFooterMode = ultraCompact ? "minimal" : (actionContext?.footerMode ?? "detailed");
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
    // Ctrl+C handling
    if (input === "\x03") {
      if (process.stdin.isTTY) process.stdin.unref();
      process.exit(0);
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
          <Text color={confirmed ? palette.green : palette.cyan}>
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
            <Text color={palette.gray}>
              {`Selected ${filteredOptions.length > 0 ? index + 1 : 0} of ${filteredOptions.length}  ·  Showing ${filteredOptions.length} of ${options.length}`}
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
                  const rowText = truncateLine(`${option.label}${secondary}`, rowWidth);
                  return (
                    <Box key={`${option.label}-${option.detail ?? ""}`}>
                      <Text
                        backgroundColor={selected ? palette.cyan : undefined}
                        color={selected ? "black" : "white"}
                        bold={selected || isConfirmed}
                        dimColor={!selected && !isConfirmed}
                      >
                        <Text color={selected ? "black" : itemTone}>{`${itemPrefix} `}</Text>
                        {rowText}
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
                    <Box>
                      <Badge label={confirmed ? "selected" : "highlighted"} tone="success" />
                      {normalizedFilter.length > 0 ? (
                        <Badge label={`filter ${normalizedFilter}`} tone="accent" />
                      ) : null}
                    </Box>
                    <Text bold color="white">
                      {truncateLine(
                        selectedLabel,
                        showSelectionCompanion ? companionWidth : innerWidth,
                      )}
                    </Text>
                    <Box marginTop={1} flexDirection="column">
                      {detailLines.map((line) => (
                        <Text key={`detail-${selectedLabel}-${line}`} color={palette.cyan}>
                          {line}
                        </Text>
                      ))}
                    </Box>
                    <Box marginTop={1}>
                      <Text color={palette.gray}>{subtitle}</Text>
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
  footerMode = "detailed",
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
  const { stdout } = useStdout();
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [emptyMessage, setEmptyMessage] = useState("Type a title and press Enter to search.");
  const requestIdRef = useRef(0);
  const { poster, posterState } = usePosterPreview(options[selectedIndex]?.previewImageUrl, {
    rows: 8,
    cols: 18,
    enabled: getShellViewportPolicy("browse", stdout.columns, stdout.rows).wideBrowse,
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
  };

  const updateQuery = (nextValue: string) => {
    const normalized = normalizeReservedCommandInput(nextValue);
    setQuery(normalized.value);
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
    const trimmed = query.trim();
    if (trimmed.length === 0 || searchState === "loading") return;

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setSearchState("loading");
    setErrorMessage(null);
    setEmptyMessage("Searching…");
    setSelectedDetail("Finding titles and available matches…");

    try {
      const response = await onSearch(trimmed);
      if (requestIdRef.current !== requestId) return;

      setLastSearchedQuery(trimmed);
      setOptions(response.options);
      setSelectedIndex(0);
      setResultSubtitle(response.subtitle);
      setEmptyMessage(response.emptyMessage ?? "No results found.");
      setSearchState("ready");
      setSelectedDetail(
        response.options[0]?.detail ?? "Use ↑↓ to move through results, then press Enter.",
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
    return false;
  };

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
  const viewport = getShellViewportPolicy("browse", stdout.columns, stdout.rows);
  const {
    compact,
    ultraCompact,
    tooSmall,
    wideBrowse,
    minColumns,
    minRows,
    maxVisibleRows: maxVisible,
  } = viewport;
  const effectiveFooterMode = ultraCompact ? "minimal" : (footerMode ?? "detailed");
  const innerWidth = Math.max(24, stdout.columns - 8);
  const previewWidth = wideBrowse ? Math.max(28, Math.floor(innerWidth * 0.3)) : innerWidth;
  const listWidth = wideBrowse ? Math.max(48, innerWidth - previewWidth - 4) : innerWidth;
  const rowWidth = Math.max(20, listWidth - 4);
  const windowStart = getWindowStart(selectedIndex, options.length, maxVisible);
  const windowEnd = Math.min(windowStart + maxVisible, options.length);
  const visibleOptions = options.slice(windowStart, windowEnd);
  const previewBodyLines = wrapText(
    companionPanel.body,
    Math.max(previewWidth - 2, 24),
    ultraCompact ? 1 : compact ? 2 : 3,
  );
  const showCompanion =
    wideBrowse &&
    !compact &&
    Boolean(
      poster.kind !== "none" ||
      companionPanel.title ||
      companionPanel.badges.length > 0 ||
      previewBodyLines.some((line) => line.trim().length > 0) ||
      companionPanel.note,
    );
  useInput((input, key) => {
    if (input === "\x03") {
      if (process.stdin.isTTY) process.stdin.unref();
      process.exit(0);
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
  });

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box flexDirection="column" flexGrow={1}>
        <Box justifyContent="space-between">
          <BrowseTitle mode={mode} />
          <Text color={searchState === "error" ? palette.red : palette.cyan}>
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
        <Box marginTop={1}>
          <Badge label={`provider ${provider}`} tone="info" />
          <Badge label={mode === "anime" ? "anime mode" : "series mode"} />
          {activeOverlay ? (
            <Badge label={`${activeOverlay.title.toLowerCase()} panel`} tone="success" />
          ) : null}
          {queryDirty && options.length > 0 ? <Badge label="results stale" tone="warning" /> : null}
        </Box>

        <InputField
          label="Search title"
          value={query}
          onChange={updateQuery}
          onSubmit={handleQuerySubmit}
          placeholder={placeholder}
          focus={!commandMode}
          hint="Enter searches · / opens commands · Ctrl+W deletes a word"
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
          <Box marginTop={1}>
            <Text color={palette.red}>{errorMessage}</Text>
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
              <Text color={palette.gray} dimColor>{`Results  ·  ${options.length} available`}</Text>
              {windowStart > 0 ? <Text color={palette.gray}> ▲ ...</Text> : null}
              {visibleOptions.map((option, index) => {
                const optionIndex = windowStart + index;
                const selected = optionIndex === selectedIndex;
                const titleText = truncateLine(option.label, rowWidth - 4);
                const metaText = option.previewMeta?.[0];

                return (
                  <Box key={`${option.label}-${option.detail ?? ""}`} flexDirection="column">
                    <Box width={rowWidth} justifyContent="space-between">
                      <Box>
                        <Text
                          backgroundColor={selected ? palette.cyan : undefined}
                          color={selected ? "black" : "white"}
                          bold={selected}
                          dimColor={!selected}
                        >
                          <Text color={selected ? "black" : palette.gray}>
                            {selected ? "❯ " : "  "}
                          </Text>
                          {titleText}
                        </Text>
                      </Box>
                      {metaText ? (
                        <Text color={selected ? palette.cyan : palette.gray} dimColor={!selected}>
                          {metaText}
                        </Text>
                      ) : null}
                    </Box>
                    {selected && option.detail ? (
                      <Box marginLeft={2}>
                        <Text color={palette.gray}>
                          {truncateLine(option.detail, rowWidth - 2)}
                        </Text>
                      </Box>
                    ) : null}
                  </Box>
                );
              })}
              {windowEnd < options.length ? <Text color={palette.gray}> ▼ ...</Text> : null}
            </Box>

            {/* Companion pane */}
            {showCompanion ? (
              <Box marginLeft={2} flexDirection="column" width={previewWidth}>
                <Box>
                  <Badge label="selection preview" />
                  {selectedOption?.previewImageUrl ? (
                    <Badge
                      label={
                        posterState === "loading"
                          ? "poster loading"
                          : poster.kind === "none"
                            ? "poster unavailable"
                            : "poster ready"
                      }
                      tone={
                        posterState === "loading"
                          ? "info"
                          : poster.kind === "none"
                            ? "warning"
                            : "success"
                      }
                    />
                  ) : (
                    <Badge label="no poster source" tone="warning" />
                  )}
                </Box>
                {poster.kind !== "none" ? (
                  <Box flexDirection="column" marginTop={1} marginBottom={1}>
                    {poster.kind === "kitty" ? (
                      <Text>{poster.placeholder}</Text>
                    ) : (
                      poster.art
                        .split("\n")
                        .slice(0, poster.rows)
                        .map((line) => <Text key={`browse-poster-${line}`}>{line}</Text>)
                    )}
                  </Box>
                ) : selectedOption?.previewImageUrl ? (
                  <Box marginTop={1}>
                    <Text color={posterState === "loading" ? palette.cyan : palette.gray} dimColor>
                      {posterState === "loading" ? "Loading poster…" : "Poster unavailable"}
                    </Text>
                  </Box>
                ) : null}
                <Text bold color="white">
                  {truncateLine(companionPanel.title, previewWidth)}
                </Text>
                {companionPanel.badges.length > 0 && !ultraCompact ? (
                  <Box marginTop={1} flexWrap="wrap">
                    {companionPanel.badges.map((badge) => (
                      <Badge
                        key={`${selectedOption?.label ?? "selected"}-${badge.label}`}
                        label={truncateLine(badge.label, Math.max(12, previewWidth - 8))}
                        tone={badge.tone}
                      />
                    ))}
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
                <Text bold color="white">
                  {truncateLine(companionPanel.title, innerWidth)}
                </Text>
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
  options: readonly ListOption<T>[];
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
        if (process.stdin.isTTY) process.stdin.unref();
        process.exit(0);
      }
      filterQuery = result.filterQuery;
      selectedIndex = result.selectedIndex;
    }
  };

  return run();
}
