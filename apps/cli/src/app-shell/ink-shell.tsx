import React, { useEffect, useRef, useState } from "react";
import { Box, Text, render, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import type { Container } from "@/container";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { getShellViewportPolicy } from "@/app-shell/layout-policy";
import type { SessionStateManager } from "@/domain/session/SessionStateManager";
import type { SessionState } from "@/domain/session/SessionState";

import { buildBrowseDetailsPanel } from "./details-panel";
import { applySettingsToRuntime, handleShellAction } from "./workflows";
import {
  buildAboutPanelLines,
  buildDiagnosticsPanelLines,
  buildHelpPanelLines,
  buildHistoryPanelLines,
  buildProviderPickerOptions,
} from "./panel-data";
import {
  fetchPoster,
  deleteAllKittyImages,
  deleteKittyImage,
  type PosterResult,
} from "./image-pane";
import { hasPendingRootPicker, resolveRootPicker } from "./root-picker-bridge";
import {
  clearRootContentSession,
  mountRootContent,
  useRootContentSession,
} from "./root-content-state";
import { getRootOwnedOverlay, resolveRootShellSurface } from "./root-shell-state";
import {
  COMMANDS,
  parseCommand,
  resolveCommands,
  suggestCommands,
  type AppCommandId,
  type ResolvedAppCommand,
} from "./commands";
import {
  toShellAction,
  type FooterAction,
  type HomeShellState,
  type PlaybackShellState,
  type LoadingShellState,
  type BrowseShellOption,
  type BrowseShellResult,
  type BrowseShellSearchResponse,
  type PlaybackShellResult,
  type ShellPanelLine,
  type ShellPickerOption,
  type ShellAction,
  type ShellStatus,
  type ShellFooterMode,
} from "./types";

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

const palette = {
  amber: "#f2c066",
  cyan: "#7dd3fc",
  green: "#8dd58a",
  rose: "#f3a6c8",
  red: "#ff7a7a",
  gray: "#7f8696",
  muted: "#a4a9b6",
};

const APP_LABEL = "🥷 Kunai beta";
const SCREEN_CLEAR_GRACE_MS = 140;

function statusColor(tone: ShellStatus["tone"] = "neutral"): string {
  switch (tone) {
    case "success":
      return palette.green;
    case "warning":
      return palette.amber;
    case "error":
      return palette.red;
    default:
      return palette.cyan;
  }
}

function hotkeyLabel(key: string): string {
  return `[${key}]`;
}

function InlineBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "info" | "success" | "warning" | "error";
}) {
  const color =
    tone === "info"
      ? palette.cyan
      : tone === "success"
        ? palette.green
        : tone === "warning"
          ? palette.amber
          : tone === "error"
            ? palette.red
            : palette.muted;

  return (
    <Box marginRight={1}>
      <Text color={color}>{label}</Text>
    </Box>
  );
}

function Footer({
  taskLabel,
  actions,
  mode = "detailed",
  commandMode = false,
}: {
  taskLabel: string;
  actions: readonly FooterAction[];
  mode?: ShellFooterMode;
  commandMode?: boolean;
}) {
  const visibleActions =
    mode === "minimal"
      ? actions.filter((action) => !action.disabled).slice(0, 3)
      : actions.filter((action) => !action.disabled);

  if (commandMode) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="white">{taskLabel}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text color={palette.amber}>Command palette</Text>
          <Text color={palette.gray}>
            {" "}
            · Type to search · Tab autocomplete · ↑↓ choose · Enter run · Esc close
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="white">{taskLabel}</Text>
      {visibleActions.length > 0 ? (
        <Box flexWrap="wrap" marginTop={1}>
          {visibleActions.map((action, index) => (
            <Box
              key={`${action.key}-${action.label}`}
              marginRight={index === visibleActions.length - 1 ? 0 : 2}
              marginBottom={1}
            >
              <Text color={palette.cyan}>{hotkeyLabel(action.key)}</Text>
              <Text color="white"> {action.label}</Text>
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

function ShellFooter({
  taskLabel,
  actions,
  mode = "detailed",
  commandMode = false,
}: {
  taskLabel: string;
  actions: readonly FooterAction[];
  mode?: ShellFooterMode;
  commandMode?: boolean;
}) {
  return <Footer taskLabel={taskLabel} actions={actions} mode={mode} commandMode={commandMode} />;
}

function getCommandMatches(
  input: string,
  commands: readonly ResolvedAppCommand[],
): readonly ResolvedAppCommand[] {
  const allowed = commands.map((command) => command.id);
  return suggestCommands(input, allowed)
    .map((command) => commands.find((resolved) => resolved.id === command.id))
    .filter((command): command is ResolvedAppCommand => Boolean(command))
    .slice(0, 6);
}

function getHighlightedCommand(
  input: string,
  commands: readonly ResolvedAppCommand[],
  highlightedIndex: number,
): ResolvedAppCommand | null {
  const exact = parseCommand(input);
  if (exact) {
    return commands.find((candidate) => candidate.id === exact.id) ?? null;
  }

  const matches = getCommandMatches(input, commands);
  return matches[highlightedIndex] ?? matches[0] ?? null;
}

function CommandPalette({
  input,
  commands,
  highlightedIndex,
}: {
  input: string;
  commands: readonly ResolvedAppCommand[];
  highlightedIndex: number;
}) {
  const matches = getCommandMatches(input, commands);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={palette.amber}
      paddingX={1}
      paddingY={0}
      marginTop={1}
    >
      <Text color={palette.amber}>Command</Text>
      <Text color="white">{`/${input}`}</Text>
      <Text color={palette.gray}>Tab autocomplete · ↑↓ choose · Enter run</Text>
      <Box flexDirection="column" marginTop={1}>
        {matches.length > 0 ? (
          matches.map((command, index) => {
            const selected = index === highlightedIndex;
            return (
              <Box key={command.id} flexDirection="column">
                <Text
                  backgroundColor={selected ? palette.cyan : undefined}
                  color={selected ? "black" : command.enabled ? palette.muted : palette.gray}
                  bold={selected}
                >
                  <Text color={selected ? "black" : palette.gray}>{selected ? "❯ " : "  "}</Text>/
                  {command.aliases[0]} {command.description}
                </Text>
                {!command.enabled && command.reason ? (
                  <Text color={palette.gray}>{`  ·  ${command.reason}`}</Text>
                ) : null}
              </Box>
            );
          })
        ) : (
          <Text color={palette.gray}>No matching commands</Text>
        )}
      </Box>
    </Box>
  );
}

function useShellInput({
  footerActions,
  commands,
  disabled = false,
  escapeAction = "quit",
  onResolve,
}: {
  footerActions: readonly FooterAction[];
  commands: readonly ResolvedAppCommand[];
  disabled?: boolean;
  escapeAction?: ShellAction | null;
  onResolve: (action: ShellAction) => void;
}) {
  const [commandMode, setCommandMode] = useState(false);
  const [commandInput, setCommandInput] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  useEffect(() => {
    if (disabled) {
      setCommandMode(false);
      setCommandInput("");
      setHighlightedIndex(0);
      return;
    }
    if (!commandMode) {
      setHighlightedIndex(0);
      return;
    }

    const matches = getCommandMatches(commandInput, commands);
    setHighlightedIndex((current) => {
      if (matches.length === 0) return 0;
      return Math.min(current, matches.length - 1);
    });
  }, [commandInput, commandMode, commands, disabled]);

  useInput((input, key) => {
    if (disabled) {
      return;
    }

    if (key.escape) {
      if (commandMode) {
        setCommandMode(false);
        setCommandInput("");
        setHighlightedIndex(0);
        return;
      }
      if (escapeAction) onResolve(escapeAction);
      return;
    }

    if (commandMode) {
      const matches = getCommandMatches(commandInput, commands);

      if (key.return) {
        const resolved = getHighlightedCommand(commandInput, commands, highlightedIndex);
        if (resolved?.enabled) {
          onResolve(toShellAction(resolved.id));
          return;
        }
        return;
      }
      if (key.tab) {
        const nextIndex = matches.length > 0 ? (highlightedIndex + 1) % matches.length : 0;
        const target = matches[nextIndex];
        if (target) {
          setHighlightedIndex(nextIndex);
          setCommandInput(target.aliases[0] ?? target.id);
        }
        return;
      }
      if (key.upArrow) {
        if (matches.length > 0) {
          setHighlightedIndex((current) => (current - 1 + matches.length) % matches.length);
        }
        return;
      }
      if (key.downArrow) {
        if (matches.length > 0) {
          setHighlightedIndex((current) => (current + 1) % matches.length);
        }
        return;
      }
      if (key.backspace || key.delete) {
        setCommandInput((current) => current.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setCommandInput((current) => current + input);
        setHighlightedIndex(0);
      }
      return;
    }

    if (input === "/") {
      setCommandMode(true);
      setCommandInput("");
      return;
    }

    const footerAction = footerActions.find(
      (action) => action.key === input.toLowerCase() && !action.disabled,
    );
    if (footerAction) {
      if (footerAction.action === "command-mode") {
        setCommandMode(true);
        setCommandInput("");
        setHighlightedIndex(0);
        return;
      }
      onResolve(footerAction.action);
    }
  });

  return { commandMode, commandInput, highlightedIndex };
}

function ShellFrame({
  eyebrow: _eyebrow,
  title,
  subtitle,
  status,
  footerTask,
  footerActions,
  footerMode,
  commands,
  inputLocked = false,
  escapeAction,
  onResolve,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  status?: ShellStatus;
  footerTask: string;
  footerActions: readonly FooterAction[];
  footerMode?: ShellFooterMode;
  commands: readonly ResolvedAppCommand[];
  inputLocked?: boolean;
  escapeAction?: ShellAction | null;
  onResolve: (action: ShellAction) => void;
  children: React.ReactNode;
}) {
  // Global Ctrl+C handler for all shells
  useInput((input, _key) => {
    if (input === "\x03") {
      // Ctrl+C - force immediate exit
      if (process.stdin.isTTY) process.stdin.unref();
      process.exit(0);
    }
  });

  const { commandMode, commandInput, highlightedIndex } = useShellInput({
    footerActions,
    commands,
    disabled: inputLocked,
    escapeAction,
    onResolve,
  });

  const { stdout } = useStdout();
  const sepWidth = Math.max(24, (stdout.columns ?? 80) - 4);

  return (
    <Box flexDirection="column" flexGrow={1} justifyContent="space-between">
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Box justifyContent="space-between">
          <Text bold color="white">
            {title}
          </Text>
          {status ? <Text color={statusColor(status.tone)}>{status.label}</Text> : null}
        </Box>
        <Text color={palette.muted}>{subtitle}</Text>
        <Box marginTop={1} flexDirection="column" flexGrow={1}>
          {children}
        </Box>
      </Box>

      <Box flexDirection="column">
        {commandMode ? (
          <CommandPalette
            input={commandInput}
            commands={commands}
            highlightedIndex={highlightedIndex}
          />
        ) : null}

        <Box marginTop={1}>
          <Text color={palette.gray} dimColor>
            {"─".repeat(sepWidth)}
          </Text>
        </Box>

        <ShellFooter
          taskLabel={footerTask}
          actions={footerActions}
          mode={footerMode}
          commandMode={commandMode && !inputLocked}
        />
      </Box>
    </Box>
  );
}

function ResizeBlocker({
  minColumns,
  minRows,
  message = "Resize terminal to continue",
}: {
  minColumns: number;
  minRows: number;
  message?: string;
}) {
  return (
    <Box
      marginTop={1}
      flexDirection="column"
      borderStyle="round"
      borderColor={palette.red}
      paddingX={1}
    >
      <Text color={palette.red}>{message}</Text>
      <Text color={palette.muted}>
        {`Need at least ${minColumns} columns × ${minRows} rows for this view.`}
      </Text>
      <Text color={palette.gray}>Resize the terminal, then continue.</Text>
    </Box>
  );
}

function LocalSection({
  title,
  tone = "neutral",
  children,
  marginTop = 1,
}: {
  title: string;
  tone?: "neutral" | "info" | "success" | "warning" | "error";
  children: React.ReactNode;
  marginTop?: number;
}) {
  return (
    <Box marginTop={marginTop} flexDirection="column">
      <Text
        color={
          tone === "info"
            ? palette.cyan
            : tone === "success"
              ? palette.green
              : tone === "warning"
                ? palette.amber
                : tone === "error"
                  ? palette.red
                  : palette.muted
        }
      >
        {title}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {children}
      </Box>
    </Box>
  );
}

function InputField({
  label,
  value,
  onChange,
  onSubmit,
  placeholder,
  focus = true,
  hint,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  focus?: boolean;
  hint?: string;
}) {
  const { stdout } = useStdout();
  const wideField = (stdout.columns ?? 0) >= 112;

  return (
    <Box marginTop={1} flexDirection="column">
      <Box justifyContent="space-between">
        <Text color={palette.muted}>{label}</Text>
        {hint && wideField ? (
          <Text color={palette.gray} dimColor>
            {hint}
          </Text>
        ) : null}
      </Box>
      <Box
        marginTop={1}
        borderStyle="round"
        borderColor={focus ? palette.cyan : palette.gray}
        paddingX={1}
      >
        <Text color={focus ? palette.cyan : palette.gray}>{focus ? "⌕ " : "› "}</Text>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={placeholder}
          focus={focus}
          showCursor
        />
      </Box>
      {hint && !wideField ? (
        <Box marginTop={1}>
          <Text color={palette.gray} dimColor>
            {hint}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

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

  void rootShellExitPromise.then(() => {
    rootShellInk = null;
    rootShellExitPromise = null;
    rootShellScreen = null;
    clearRootContentSession();
    stdinManager.exitShell();
  });

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

  void exitPromise.then(() => {
    if (!settled) {
      settled = true;
      resolveResult(fallbackValue);
    }
  });

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
function RootOverlayShell({
  overlay,
  state,
  container,
}: {
  overlay:
    | { type: "help" | "about" | "diagnostics" }
    | { type: "history" }
    | { type: "settings" }
    | {
        type: "season_picker";
        currentSeason: number;
        options: readonly import("@/domain/session/SessionState").OverlayPickerOption[];
      }
    | {
        type: "episode_picker";
        season: number;
        options: readonly import("@/domain/session/SessionState").OverlayPickerOption[];
      }
    | {
        type: "subtitle_picker";
        options: readonly import("@/domain/session/SessionState").OverlayPickerOption[];
      }
    | { type: "provider_picker"; currentProvider: string; isAnime: boolean };
  state: SessionState;
  container: Container;
}) {
  const { stdout } = useStdout();
  const maxLines = Math.max(6, Math.min(12, (stdout.rows ?? 24) - 18));
  const [scrollIndex, setScrollIndex] = useState(0);
  const [filterQuery, setFilterQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [asyncLines, setAsyncLines] = useState<readonly ShellPanelLine[] | null>(null);
  const [loadingAsyncLines, setLoadingAsyncLines] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<KitsuneConfig | null>(null);
  const [settingsChoice, setSettingsChoice] = useState<SettingsChoiceValue | null>(null);
  const [settingsParentIndex, setSettingsParentIndex] = useState(0);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const commands = resolveCommands(state, [
    "settings",
    "provider",
    "history",
    "help",
    "about",
    "diagnostics",
  ]);
  const settingsSeriesProviderOptions = buildSettingsProviderOptions({
    providers: container.providerRegistry
      .getAll()
      .map((provider) => provider.metadata)
      .filter((metadata) => !metadata.isAnimeProvider),
    currentProvider: settingsDraft?.provider ?? container.config.provider,
  });
  const settingsAnimeProviderOptions = buildSettingsProviderOptions({
    providers: container.providerRegistry
      .getAll()
      .map((provider) => provider.metadata)
      .filter((metadata) => metadata.isAnimeProvider),
    currentProvider: settingsDraft?.animeProvider ?? container.config.animeProvider,
  });
  const staticLines =
    overlay.type === "help"
      ? buildHelpPanelLines()
      : overlay.type === "about"
        ? buildAboutPanelLines({
            config: container.config.getRaw(),
            state,
          })
        : overlay.type === "diagnostics"
          ? buildDiagnosticsPanelLines({
              state,
              recentEvents: container.diagnosticsStore.getRecent(10),
            })
          : [];
  const lines = overlay.type === "history" ? (asyncLines ?? []) : staticLines;
  const providerOptions =
    overlay.type === "provider_picker"
      ? buildProviderPickerOptions({
          providers: container.providerRegistry
            .getAll()
            .map((provider) => provider.metadata)
            .filter((metadata) => metadata.isAnimeProvider === overlay.isAnime),
          currentProvider: overlay.currentProvider,
        })
      : [];
  const genericPickerOptions =
    overlay.type === "season_picker" ||
    overlay.type === "episode_picker" ||
    overlay.type === "subtitle_picker"
      ? overlay.options.map((option) => ({
          value: option.value,
          label: option.label,
          detail: option.detail,
        }))
      : [];
  const filteredProviderOptions = providerOptions.filter((option) => {
    const filter = filterQuery.trim().toLowerCase();
    if (filter.length === 0) return true;
    return `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(filter);
  });
  const filteredGenericPickerOptions = genericPickerOptions.filter((option) => {
    const filter = filterQuery.trim().toLowerCase();
    if (filter.length === 0) return true;
    return `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(filter);
  });
  const settingsPanel =
    overlay.type === "settings" && settingsDraft
      ? settingsChoice
        ? buildSettingsChoiceOverlay({
            config: settingsDraft,
            setting: settingsChoice,
            seriesProviderOptions: settingsSeriesProviderOptions,
            animeProviderOptions: settingsAnimeProviderOptions,
            parentSelectedIndex: settingsParentIndex,
          })
        : ({
            type: "settings",
            title: "Settings",
            subtitle: buildSettingsSummary(settingsDraft),
            options: buildSettingsOptions(settingsDraft),
            filterQuery: "",
            selectedIndex,
            dirty: !settingsEqual(settingsDraft, container.config.getRaw()),
            busy: settingsBusy,
          } satisfies Extract<BrowseOverlay, { type: "settings" }>)
      : null;
  const filteredSettingsOptions =
    settingsPanel?.options.filter((option) => {
      const filter = filterQuery.trim().toLowerCase();
      if (filter.length === 0) return true;
      return `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(filter);
    }) ?? [];
  const title =
    overlay.type === "help"
      ? "Help"
      : overlay.type === "about"
        ? "About"
        : overlay.type === "diagnostics"
          ? "Diagnostics"
          : overlay.type === "history"
            ? "History"
            : overlay.type === "settings"
              ? "Settings"
              : overlay.type === "season_picker"
                ? "Choose season"
                : overlay.type === "episode_picker"
                  ? "Choose episode"
                  : overlay.type === "subtitle_picker"
                    ? "Choose subtitles"
                    : "Provider";
  const subtitle =
    overlay.type === "help"
      ? "Global commands, editing, filtering, and shell behavior"
      : overlay.type === "about"
        ? "Kunai beta"
        : overlay.type === "diagnostics"
          ? "Current runtime snapshot and recent events"
          : overlay.type === "history"
            ? "Recent playback positions without leaving the shell"
            : overlay.type === "settings"
              ? (settingsError ?? buildSettingsSummary(settingsDraft ?? container.config.getRaw()))
              : overlay.type === "season_picker"
                ? `Current season ${overlay.currentSeason}`
                : overlay.type === "episode_picker"
                  ? `Season ${overlay.season}  ·  Choose an episode`
                  : overlay.type === "subtitle_picker"
                    ? `${overlay.options.length} tracks available`
                    : `Current provider ${state.provider}`;
  const footerActions: readonly FooterAction[] = [
    { key: "/", label: "commands", action: "command-mode" },
    { key: "esc", label: "close", action: "quit" },
  ];
  const { commandMode, commandInput, highlightedIndex } = useShellInput({
    footerActions,
    commands,
    escapeAction: null,
    onResolve: (action) => {
      if (
        action === "settings" ||
        action === "help" ||
        action === "about" ||
        action === "diagnostics" ||
        action === "history" ||
        action === "provider"
      ) {
        if (
          hasPendingRootPicker() &&
          (overlay.type === "season_picker" ||
            overlay.type === "episode_picker" ||
            overlay.type === "subtitle_picker")
        ) {
          resolveRootPicker(null);
        }
        container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
        container.stateManager.dispatch({
          type: "OPEN_OVERLAY",
          overlay:
            action === "provider"
              ? {
                  type: "provider_picker",
                  currentProvider: state.provider,
                  isAnime: state.mode === "anime",
                }
              : action === "history"
                ? { type: "history" }
                : action === "settings"
                  ? { type: "settings" }
                  : { type: action },
        });
      }
    },
  });

  useEffect(() => {
    setScrollIndex(0);
    setFilterQuery("");
    setSelectedIndex(0);
    setAsyncLines(null);
    setLoadingAsyncLines(false);
    setSettingsDraft(overlay.type === "settings" ? container.config.getRaw() : null);
    setSettingsChoice(null);
    setSettingsParentIndex(0);
    setSettingsBusy(false);
    setSettingsError(null);
  }, [container.config, overlay.type]);

  useEffect(() => {
    if (overlay.type !== "history") {
      return;
    }

    let cancelled = false;
    setLoadingAsyncLines(true);

    void container.historyStore
      .getAll()
      .then((entries) => {
        if (cancelled) return;
        setAsyncLines(buildHistoryPanelLines(Object.entries(entries)));
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingAsyncLines(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [container.historyStore, overlay.type]);

  useInput((input, key) => {
    if (commandMode) {
      return;
    }
    if (key.escape) {
      if (overlay.type === "settings" && settingsChoice) {
        setSettingsChoice(null);
        setFilterQuery("");
        setSelectedIndex(settingsParentIndex);
        return;
      }
      if (
        hasPendingRootPicker() &&
        (overlay.type === "season_picker" ||
          overlay.type === "episode_picker" ||
          overlay.type === "subtitle_picker")
      ) {
        resolveRootPicker(null);
      }
      container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
      return;
    }
    if (key.return) {
      if (overlay.type === "settings") {
        const picked = filteredSettingsOptions[selectedIndex];
        if (!picked || !settingsDraft) {
          return;
        }
        if (settingsChoice) {
          const next = { ...settingsDraft };
          if (settingsChoice === "defaultMode") {
            next.defaultMode = picked.value as "series" | "anime";
          } else if (settingsChoice === "provider") {
            next.provider = picked.value;
          } else if (settingsChoice === "animeProvider") {
            next.animeProvider = picked.value;
          } else if (settingsChoice === "subLang") {
            next.subLang = picked.value;
          } else if (settingsChoice === "animeLang") {
            next.animeLang = picked.value as "sub" | "dub";
          } else if (settingsChoice === "footerHints") {
            next.footerHints = picked.value as "detailed" | "minimal";
          }
          setSettingsDraft(next);
          setSettingsChoice(null);
          setFilterQuery("");
          setSelectedIndex(settingsParentIndex);
          setSettingsError(null);
          return;
        }
        if (picked.value === "headless") {
          setSettingsDraft({ ...settingsDraft, headless: !settingsDraft.headless });
          setSettingsError(null);
          return;
        }
        if (picked.value === "showMemory") {
          setSettingsDraft({ ...settingsDraft, showMemory: !settingsDraft.showMemory });
          setSettingsError(null);
          return;
        }
        if (picked.value === "autoNext") {
          setSettingsDraft({ ...settingsDraft, autoNext: !settingsDraft.autoNext });
          setSettingsError(null);
          return;
        }
        if (picked.value === "clearCache") {
          void handleShellAction({ action: "clear-cache", container });
          return;
        }
        if (picked.value === "clearHistory") {
          void handleShellAction({ action: "clear-history", container });
          return;
        }
        setSettingsChoice(picked.value as SettingsChoiceValue);
        setSettingsParentIndex(selectedIndex);
        setFilterQuery("");
        setSelectedIndex(0);
        setSettingsError(null);
        return;
      }
      if (overlay.type === "provider_picker") {
        const picked = filteredProviderOptions[selectedIndex]?.value;
        if (picked && picked !== state.provider) {
          container.stateManager.dispatch({ type: "SET_PROVIDER", provider: picked });
        }
      } else if (
        overlay.type === "season_picker" ||
        overlay.type === "episode_picker" ||
        overlay.type === "subtitle_picker"
      ) {
        const picked = filteredGenericPickerOptions[selectedIndex]?.value ?? null;
        resolveRootPicker(picked);
      }
      container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
      return;
    }
    if (key.upArrow) {
      if (
        overlay.type === "provider_picker" ||
        overlay.type === "settings" ||
        overlay.type === "season_picker" ||
        overlay.type === "episode_picker" ||
        overlay.type === "subtitle_picker"
      ) {
        setSelectedIndex((current) => Math.max(0, current - 1));
      } else {
        setScrollIndex((current) => Math.max(0, current - 1));
      }
      return;
    }
    if (key.downArrow) {
      if (
        overlay.type === "provider_picker" ||
        overlay.type === "settings" ||
        overlay.type === "season_picker" ||
        overlay.type === "episode_picker" ||
        overlay.type === "subtitle_picker"
      ) {
        const optionCount =
          overlay.type === "provider_picker"
            ? filteredProviderOptions.length
            : overlay.type === "settings"
              ? filteredSettingsOptions.length
              : filteredGenericPickerOptions.length;
        setSelectedIndex((current) => Math.min(Math.max(optionCount - 1, 0), current + 1));
      } else {
        setScrollIndex((current) => Math.min(Math.max(lines.length - maxLines, 0), current + 1));
      }
      return;
    }
    if (
      overlay.type === "provider_picker" ||
      overlay.type === "settings" ||
      overlay.type === "season_picker" ||
      overlay.type === "episode_picker" ||
      overlay.type === "subtitle_picker"
    ) {
      if (overlay.type === "settings" && input.toLowerCase() === "s") {
        if (
          !settingsDraft ||
          settingsBusy ||
          settingsEqual(settingsDraft, container.config.getRaw())
        ) {
          return;
        }
        setSettingsBusy(true);
        setSettingsError(null);
        void applySettingsToRuntime({
          container,
          next: settingsDraft,
          previous: container.config.getRaw(),
        })
          .then(() => {
            container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
          })
          .catch((error) => {
            setSettingsBusy(false);
            setSettingsError(`Failed to save settings: ${String(error)}`);
          });
        return;
      }
      if (key.backspace || key.delete) {
        setFilterQuery((current) => current.slice(0, -1));
        setSelectedIndex(0);
        return;
      }
      if (key.ctrl && input === "w") {
        setFilterQuery((current) => current.replace(/\s*\S+\s*$/, ""));
        setSelectedIndex(0);
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setFilterQuery((current) => current + input);
        setSelectedIndex(0);
      }
    }
  });

  const overlayPanel: BrowseOverlay =
    overlay.type === "provider_picker"
      ? {
          type: "provider",
          title,
          subtitle,
          options: filteredProviderOptions,
          filterQuery,
          selectedIndex: Math.min(selectedIndex, Math.max(filteredProviderOptions.length - 1, 0)),
          busy: false,
        }
      : overlay.type === "settings" && settingsPanel
        ? {
            ...settingsPanel,
            subtitle,
            options: filteredSettingsOptions,
            filterQuery,
            selectedIndex: Math.min(selectedIndex, Math.max(filteredSettingsOptions.length - 1, 0)),
            busy: settingsBusy,
          }
        : overlay.type === "season_picker" ||
            overlay.type === "episode_picker" ||
            overlay.type === "subtitle_picker"
          ? {
              type: "episode-picker",
              title,
              subtitle,
              options: filteredGenericPickerOptions,
              filterQuery,
              selectedIndex: Math.min(
                selectedIndex,
                Math.max(filteredGenericPickerOptions.length - 1, 0),
              ),
              busy: false,
            }
          : overlay.type === "help" ||
              overlay.type === "about" ||
              overlay.type === "diagnostics" ||
              overlay.type === "history"
            ? {
                type: overlay.type,
                title,
                subtitle,
                lines,
                loading: overlay.type === "history" ? loadingAsyncLines : undefined,
                scrollIndex,
              }
            : {
                type: "help",
                title: "Help",
                subtitle: "Global commands, editing, filtering, and shell behavior",
                lines: buildHelpPanelLines(),
                scrollIndex: 0,
              };

  return (
    <Box flexDirection="column" flexGrow={1} justifyContent="space-between">
      <Box flexDirection="column" flexGrow={1}>
        <Box>
          <InlineBadge
            label={`panel ${overlay.type === "provider_picker" ? "provider" : overlay.type}`}
            tone="success"
          />
          {overlay.type === "provider_picker" || overlay.type === "settings" ? (
            <InlineBadge
              label={`${
                overlay.type === "provider_picker"
                  ? filteredProviderOptions.length
                  : filteredSettingsOptions.length
              } options`}
              tone="neutral"
            />
          ) : overlay.type === "season_picker" ||
            overlay.type === "episode_picker" ||
            overlay.type === "subtitle_picker" ? (
            <InlineBadge label={`${filteredGenericPickerOptions.length} options`} tone="neutral" />
          ) : (
            <InlineBadge
              label={`${Math.min(scrollIndex + maxLines, lines.length)}/${lines.length} lines`}
              tone="neutral"
            />
          )}
        </Box>
        <OverlayPanel
          overlay={overlayPanel}
          width={Math.max(24, (stdout.columns ?? 80) - 8)}
          maxLinesOverride={maxLines}
        />
      </Box>

      <Box flexDirection="column">
        {commandMode ? (
          <CommandPalette
            input={commandInput}
            commands={commands}
            highlightedIndex={highlightedIndex}
          />
        ) : null}
        <ShellFooter
          taskLabel={
            overlay.type === "provider_picker"
              ? "Provider picker  ·  Type to filter, Enter to switch, Esc closes"
              : overlay.type === "settings"
                ? settingsChoice
                  ? "Settings choice  ·  Type to filter, Enter to apply, Esc returns"
                  : "Settings  ·  Type to filter, Enter to edit, S saves, Esc closes"
                : overlay.type === "season_picker" ||
                    overlay.type === "episode_picker" ||
                    overlay.type === "subtitle_picker"
                  ? `${title}  ·  Type to filter, Enter to select, Esc closes`
                  : `${title}  ·  Esc closes and returns to the previous shell state`
          }
          actions={footerActions}
          mode="detailed"
          commandMode={commandMode}
        />
      </Box>
    </Box>
  );
}

function AppRoot({ container }: { container: Container }) {
  const { stateManager } = container;
  const state = useSessionState(stateManager);
  const screen = useRootShellScreen();
  const rootContent = useRootContentSession();
  const { stdout } = useStdout();
  const rootStatus =
    state.playbackStatus === "playing"
      ? "playing"
      : state.playbackStatus === "loading"
        ? "resolving"
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
  const shellWidth = Math.max(80, (stdout.columns ?? 80) - 2);
  const shellHeight = Math.max(24, (stdout.rows ?? 24) - 1);
  const currentViewLabel =
    state.playbackStatus === "loading" || state.playbackStatus === "playing"
      ? "playback"
      : state.view;
  const rootOverlay = getRootOwnedOverlay(state);
  const rootSurface = resolveRootShellSurface(state, {
    hasRootContent: Boolean(rootContent),
    hasMountedScreen: Boolean(screen),
  });

  return (
    <Box flexDirection="column" width={shellWidth} height={shellHeight} paddingX={1} paddingY={0}>
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
          <Text color={rootStatus === "error" ? palette.red : palette.cyan}>{rootStatus}</Text>
        </Box>
        <Box marginTop={0} flexWrap="wrap">
          <InlineBadge label={`mode ${state.mode}`} tone="info" />
          <InlineBadge label={`provider ${state.provider}`} tone="neutral" />
          <InlineBadge label={`view ${currentViewLabel}`} tone="success" />
          {playbackSubtitle ? <InlineBadge label={playbackSubtitle} tone="neutral" /> : null}
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
                state={{
                  title: state.currentTitle?.name || "Resolving...",
                  subtitle: playbackSubtitle,
                  operation: state.playbackStatus === "playing" ? "playing" : "resolving",
                  details: `Provider: ${state.provider}`,
                  subtitleStatus:
                    state.playbackStatus === "playing" ? playbackSubtitleStatus : undefined,
                  trace:
                    state.playbackStatus === "playing"
                      ? "mpv is open; Kunai is waiting for playback to finish"
                      : undefined,
                  showMemory: state.playbackStatus === "playing",
                }}
                onCancel={() => {}}
              />
            ) : rootSurface === "root-content" && rootContent ? (
              <Box key={rootContent.id} flexGrow={1}>
                {rootContent.element}
              </Box>
            ) : rootSurface === "root-overlay" && rootOverlay ? (
              <RootOverlayShell overlay={rootOverlay} state={state} container={container} />
            ) : screen ? (
              <Box key={screen.id}>{screen.element}</Box>
            ) : (
              <RootIdleShell state={state} />
            )}
          </Box>

          {rootSurface === "root-content" && rootOverlay ? (
            <Box marginTop={1}>
              <RootOverlayShell overlay={rootOverlay} state={state} container={container} />
            </Box>
          ) : null}
        </Box>
      </Box>
    </Box>
  );
}

function RootIdleShell({ state }: { state: SessionState }) {
  const currentTitle = state.currentTitle?.name ?? "No title selected yet";
  const currentEpisode = state.currentEpisode
    ? `S${String(state.currentEpisode.season).padStart(2, "0")}E${String(
        state.currentEpisode.episode,
      ).padStart(2, "0")}`
    : null;
  const hasSearchResults = state.searchResults.length > 0;

  return (
    <Box flexDirection="column" flexGrow={1} justifyContent="space-between">
      <Box flexDirection="column">
        <Text bold color="white">
          {state.mode === "anime"
            ? "Browse anime and keep playback command-ready"
            : "Browse your favorite movies and series"}
        </Text>
        <Text color={palette.muted}>
          {hasSearchResults
            ? `${state.searchResults.length} results are still loaded. Keep browsing or continue playback.`
            : "The fullscreen shell is ready. Search, review details, and continue without dropping back to the terminal."}
        </Text>

        <LocalSection title="Current session" tone="info" marginTop={2}>
          <Text color="white">{currentTitle}</Text>
          <Text color={palette.muted}>
            {currentEpisode
              ? `${currentEpisode}  ·  Ready to resume episode flow`
              : hasSearchResults
                ? "Search results are available and ready to reopen"
                : "Start with a title search or switch modes"}
          </Text>
        </LocalSection>

        {state.searchQuery.trim().length > 0 ? (
          <LocalSection title="Search context" tone="success">
            <Text color="white">{state.searchQuery}</Text>
            <Text color={palette.muted}>
              {hasSearchResults
                ? `${state.searchResults.length} results cached in this session`
                : "Query is loaded and ready for the next browse pass"}
            </Text>
          </LocalSection>
        ) : null}
      </Box>

      <Box marginTop={2}>
        <Text color={palette.gray} dimColor italic>
          Preparing the next fullscreen panel…
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Error shell for displaying failures.
 */
function ErrorShell({ message, onResolve }: { message: string; onResolve: () => void }) {
  useInput((_input, key) => {
    if (key.return || key.escape) {
      onResolve();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={palette.red} paddingX={1}>
      <Box marginBottom={1}>
        <Text color={palette.red} bold>
          ⚠ Error
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text color="white">{message}</Text>
      </Box>
      <Box>
        <Text color={palette.gray} dimColor>
          Press Enter or Esc to continue
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Launches the persistent state-driven app shell.
 */
export async function launchSessionApp(container: Container) {
  if (rootShellInk) {
    return rootShellExitPromise!;
  }

  stdinManager.enterShell();
  clearShellScreen();

  rootShellInk = render(<AppRoot container={container} />, {
    exitOnCtrlC: false,
    alternateScreen: true,
  });
  rootShellExitPromise = rootShellInk.waitUntilExit();

  void rootShellExitPromise.then(() => {
    rootShellInk = null;
    rootShellExitPromise = null;
    rootShellScreen = null;
    clearRootContentSession();
    stdinManager.exitShell();
  });

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

function HomeShell({
  state,
  onResolve,
}: {
  state: HomeShellState;
  onResolve: (action: ShellAction) => void;
}) {
  const commands =
    state.commands ?? fallbackCommandState(["search", "settings", "toggle-mode", "help", "quit"]);
  const footerActions: readonly FooterAction[] = [
    { key: "/", label: "commands", action: "command-mode" },
    { key: "enter", label: "search", action: "search" },
    footerActionFromCommand(commands, "settings", { key: "c", label: "settings" }),
    {
      key: "a",
      label: getCommandLabel(
        commands,
        "toggle-mode",
        state.mode === "anime" ? "series mode" : "anime mode",
      ),
      action: "toggle-mode",
      disabled: isCommandDisabled(commands, "toggle-mode"),
      reason: getCommandReason(commands, "toggle-mode"),
    },
    footerActionFromCommand(commands, "help", { key: "?", label: "help" }),
    footerActionFromCommand(commands, "quit", { key: "q", label: "quit" }),
  ];

  useInput((_input, key) => {
    if (key.return) onResolve("search");
  });

  return (
    <ShellFrame
      eyebrow={APP_LABEL}
      title="Fast stream search without prompt spaghetti"
      subtitle={`Mode ${state.mode}  ·  Provider ${state.provider}  ·  Subs ${
        state.subtitle
      }${state.mode === "anime" ? `  ·  Audio ${state.animeLang}` : ""}`}
      status={state.status}
      footerTask="Start a search or open a nearby command"
      footerActions={footerActions}
      footerMode={state.footerMode}
      commands={commands}
      onResolve={onResolve}
    >
      <Text color={palette.muted}>
        Press Enter to search, or use `/` for commands. Settings and mode switch stay reachable
        before the first query.
      </Text>
    </ShellFrame>
  );
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
  const [poster, setPoster] = useState<PosterResult>({ kind: "none" });
  const [posterState, setPosterState] = useState<"idle" | "loading" | "ready" | "unavailable">(
    "idle",
  );
  const { stdout } = useStdout();
  const playbackViewport = getShellViewportPolicy("playback", stdout.columns, stdout.rows);
  const playbackWide = (stdout.columns ?? 0) >= 150;
  const showPosterCompanion =
    playbackWide &&
    Boolean(
      state.posterUrl ||
      poster.kind !== "none" ||
      posterState === "loading" ||
      posterState === "unavailable",
    );

  useEffect(() => {
    const url = state.posterUrl;
    if (!url) {
      setPosterState("idle");
      setPoster((prev) => {
        if (prev.kind === "kitty") deleteKittyImage(prev.imageId);
        return { kind: "none" };
      });
      return;
    }
    setPosterState("loading");
    fetchPoster(url, { rows: 8, cols: 18 })
      .then((next) => {
        setPosterState(next.kind === "none" ? "unavailable" : "ready");
        setPoster((prev) => {
          if (prev.kind === "kitty" && (next.kind !== "kitty" || prev.imageId !== next.imageId)) {
            deleteKittyImage(prev.imageId);
          }
          return next;
        });
      })
      .catch(() => {
        setPosterState("unavailable");
      });
    return () => {
      setPoster((prev) => {
        if (prev.kind === "kitty") deleteKittyImage(prev.imageId);
        return { kind: "none" };
      });
    };
  }, [state.posterUrl]);
  const commands =
    state.commands ??
    fallbackCommandState([
      "search",
      "settings",
      "toggle-mode",
      "provider",
      "history",
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
    footerActionFromCommand(commands, "replay", { key: "r", label: "replay" }),
    footerActionFromCommand(commands, "search", { key: "f", label: "search" }),
    footerActionFromCommand(commands, "pick-episode", { key: "e", label: "episodes" }),
    footerActionFromCommand(commands, "next", {
      key: "n",
      label: getCommandLabel(commands, "next", "next"),
    }),
    footerActionFromCommand(commands, "previous", {
      key: "p",
      label: getCommandLabel(commands, "previous", "previous"),
    }),
    footerActionFromCommand(commands, "quit", { key: "q", label: "quit" }),
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
        if (key.ctrl && input.toLowerCase() === "w") {
          setActiveOverlay({
            ...activeOverlay,
            filterQuery: deleteLastWord(activeOverlay.filterQuery),
            selectedIndex: 0,
          });
          return;
        }
        if (key.backspace || key.delete) {
          setActiveOverlay({
            ...activeOverlay,
            filterQuery: activeOverlay.filterQuery.slice(0, -1),
            selectedIndex: 0,
          });
          return;
        }
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
        if (input && !key.ctrl && !key.meta) {
          setActiveOverlay({
            ...activeOverlay,
            filterQuery: `${activeOverlay.filterQuery}${input}`,
            selectedIndex: 0,
          });
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
                  value="Replay, move episodes, or start a fresh search"
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
                        .map((line, i) => (
                          <Text key={i}>{line}</Text>
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

function fallbackCommandState(allowed: readonly AppCommandId[]): readonly ResolvedAppCommand[] {
  return allowed
    .map((id) => COMMANDS.find((command) => command.id === id))
    .filter((command): command is ResolvedAppCommand => Boolean(command))
    .map((command) => ({
      ...command,
      enabled: true,
    }));
}

function footerActionFromCommand(
  commands: readonly ResolvedAppCommand[],
  id: AppCommandId,
  presentation: { key: string; label: string },
): FooterAction {
  const command = commands.find((candidate) => candidate.id === id);
  return {
    key: presentation.key,
    label: presentation.label,
    action: toShellAction(id),
    disabled: command ? !command.enabled : false,
    reason: command?.reason,
  };
}

function isCommandDisabled(commands: readonly ResolvedAppCommand[], id: AppCommandId): boolean {
  return !commands.find((command) => command.id === id)?.enabled;
}

function getCommandReason(
  commands: readonly ResolvedAppCommand[],
  id: AppCommandId,
): string | undefined {
  return commands.find((command) => command.id === id)?.reason;
}

function getCommandLabel(
  commands: readonly ResolvedAppCommand[],
  id: AppCommandId,
  fallback: string,
): string {
  return commands.find((command) => command.id === id)?.label.toLowerCase() ?? fallback;
}

function Badge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "info" | "success" | "warning" | "accent";
}) {
  const color =
    tone === "success"
      ? palette.green
      : tone === "info"
        ? palette.cyan
        : tone === "accent"
          ? palette.rose
          : tone === "warning"
            ? palette.amber
            : palette.gray;

  return (
    <Box borderStyle="round" borderColor={color} paddingX={1} marginRight={1}>
      <Text color={color} bold={tone !== "neutral"}>
        {label}
      </Text>
    </Box>
  );
}

function DetailLine({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "info" | "success" | "warning" | "accent";
}) {
  const valueColor =
    tone === "success"
      ? palette.green
      : tone === "info"
        ? palette.cyan
        : tone === "accent"
          ? palette.rose
          : tone === "warning"
            ? palette.amber
            : "white";

  return (
    <Box>
      <Text color={palette.gray}>{label}</Text>
      <Text color={palette.gray}> · </Text>
      <Text color={valueColor}>{value}</Text>
    </Box>
  );
}

function BrowseTitle({ mode }: { mode: "series" | "anime" }) {
  return (
    <Text bold color="white">
      {mode === "anime" ? "Browse your favorite anime" : "Browse your favorite movies and series"}
    </Text>
  );
}

function SearchShell({
  mode,
  provider,
  initialValue,
  placeholder,
  onSubmit,
  onCancel,
}: {
  mode: "series" | "anime";
  provider: string;
  initialValue?: string;
  placeholder: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue ?? "");

  useInput((input, key) => {
    // Ctrl+C handling
    if (input === "\x03") {
      if (process.stdin.isTTY) process.stdin.unref();
      process.exit(0);
    }
    if (key.escape || input === "q") {
      onCancel();
      return;
    }
    if (key.return) {
      const next = value.trim();
      if (next.length > 0) onSubmit(next);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginTop={0} flexDirection="column">
        <Text bold color="white">
          {mode === "anime" ? "Search anime" : "Search titles"}
        </Text>
        <Text
          color={palette.muted}
        >{`Provider ${provider}  ·  Enter submits  ·  Esc cancels`}</Text>
      </Box>
      <InputField
        label="Search"
        value={value}
        onChange={setValue}
        onSubmit={(next) => {
          const trimmed = next.trim();
          if (trimmed.length > 0) onSubmit(trimmed);
        }}
        placeholder={placeholder}
        hint="Enter submits · / opens commands · Ctrl+W deletes a word"
      />
    </Box>
  );
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function useSpinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);
  return SPINNER_FRAMES[frame];
}

function useElapsed(): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  return elapsed;
}

function usePulse(periodMs: number): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => {
      const phase = ((Date.now() - start) % periodMs) / periodMs;
      setOn(phase < 0.5);
    }, 80);
    return () => clearInterval(timer);
  }, [periodMs]);
  return on;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${String(s)}s`;
}

function renderPhaseRail(active: LoadingShellState["operation"]): readonly {
  label: string;
  tone: "neutral" | "info" | "success";
}[] {
  const order: readonly LoadingShellState["operation"][] = [
    "searching",
    "scraping",
    "resolving",
    "playing",
  ];
  const activeIndex = order.indexOf(active);

  return order.map((phase, index) => ({
    label: phase === "playing" ? "play" : phase,
    tone: index < activeIndex ? "success" : index === activeIndex ? "info" : "neutral",
  }));
}

function LoadingShell({ state, onCancel }: { state: LoadingShellState; onCancel?: () => void }) {
  const spinner = useSpinner();
  const elapsed = useElapsed();
  const pulse = usePulse(1400);
  const { stdout } = useStdout();

  useInput((input, key) => {
    if (input === "\x03") {
      if (process.stdin.isTTY) process.stdin.unref();
      process.exit(0);
    }
    if (key.escape && state.cancellable && onCancel) {
      onCancel();
    }
  });

  const isPlaying = state.operation === "playing";
  const leadIcon = isPlaying ? "▶" : spinner;
  const accentColor = isPlaying ? palette.green : pulse ? palette.cyan : "white";
  const separatorWidth = Math.min(52, Math.max(24, (stdout.columns ?? 80) - 22));
  const infoWidth = Math.min(76, Math.max(40, (stdout.columns ?? 80) - 12));
  const subtitleTone =
    state.subtitleStatus?.includes("attached") || state.subtitleStatus?.includes("available")
      ? "success"
      : "warning";

  const operationLabels: Record<LoadingShellState["operation"], string> = {
    searching: "Searching",
    scraping: "Scraping",
    resolving: "Resolving stream",
    playing: "Now playing",
    loading: "Loading",
  };
  const phaseRail =
    state.operation === "loading"
      ? [{ label: "loading", tone: "info" as const }]
      : renderPhaseRail(state.operation);

  return (
    <Box flexDirection="column" flexGrow={1} justifyContent="center" paddingX={2} paddingY={1}>
      <Box flexDirection="column" width={infoWidth}>
        <Box>
          <Badge
            label={operationLabels[state.operation].toLowerCase()}
            tone={isPlaying ? "success" : "info"}
          />
          {state.details ? <Badge label={state.details.toLowerCase()} tone="neutral" /> : null}
          {state.subtitleStatus ? <Badge label={state.subtitleStatus} tone={subtitleTone} /> : null}
        </Box>
        <Box marginTop={1}>
          <Text color={accentColor}>{leadIcon} </Text>
          <Text bold color="white">
            {state.title}
          </Text>
        </Box>
        {state.subtitle && (
          <Box marginLeft={2}>
            <Text color={palette.muted}>{state.subtitle}</Text>
          </Box>
        )}

        <Box marginY={1}>
          <Text color={palette.muted} dimColor>
            {"─".repeat(separatorWidth)}
          </Text>
        </Box>

        <Box flexWrap="wrap">
          {phaseRail.map((phase, index) => (
            <Badge key={`${phase.label}-${index}`} label={phase.label} tone={phase.tone} />
          ))}
        </Box>

        <Box>
          <Text color={accentColor}>{operationLabels[state.operation]}</Text>
          <Text color={palette.gray} dimColor>
            {"  "}
            {isPlaying ? "Playback shell stays alive in the background" : "Gathering stream data"}
          </Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          {state.subtitleStatus ? (
            <DetailLine label="Subtitle state" value={state.subtitleStatus} tone={subtitleTone} />
          ) : null}
          <DetailLine
            label="Status"
            value={
              isPlaying
                ? "Handed off to mpv, the shell will return here when playback ends"
                : "Resolving provider data, stream headers, and playback context"
            }
            tone={isPlaying ? "success" : "info"}
          />
          {!isPlaying && elapsed >= 2 ? (
            <DetailLine label="Elapsed" value={formatElapsed(elapsed)} />
          ) : null}
          {state.showMemory ? <DetailLine label="Memory" value={formatMemoryUsage()} /> : null}
        </Box>

        {state.trace && (
          <Box marginTop={1}>
            <Text color={palette.gray} dimColor>
              {state.trace}
            </Text>
          </Box>
        )}

        {state.progress !== undefined ? (
          <Box marginTop={1}>
            <Box
              width={Math.min(40, (stdout.columns ?? 80) - 4)}
              borderStyle="round"
              borderColor={palette.cyan}
              paddingX={1}
            >
              <Text>
                {"█".repeat(Math.floor(state.progress / 2.5))}
                {"░".repeat(40 - Math.floor(state.progress / 2.5))}
              </Text>
              <Text color={palette.cyan}> {Math.round(state.progress)}%</Text>
            </Box>
          </Box>
        ) : (
          !isPlaying && (
            <Box marginTop={1}>
              <Text color={pulse ? palette.cyan : palette.gray} dimColor>
                {pulse ? "Preparing playback context…" : "Waiting on provider response…"}
              </Text>
            </Box>
          )
        )}

        {state.cancellable && (
          <Box marginTop={1}>
            <Text color={palette.gray} dimColor>
              ESC to cancel
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

export function openShell<TProps>({
  Component,
  props,
}: {
  Component: React.ComponentType<TProps & { onResolve: (action: ShellAction) => void }>;
  props: TProps;
}): Promise<ShellAction> {
  const session = mountShell<ShellAction>({
    renderShell: (finish) => <Component {...props} onResolve={finish} />,
    fallbackValue: "quit",
    clearOnResolve: false,
  });

  return session.result;
}

export function openHomeShell(state: HomeShellState): Promise<ShellAction> {
  return openShell({ Component: HomeShell, props: { state } });
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

export function openSearchShell({
  mode,
  provider,
  initialValue,
  placeholder,
}: {
  mode: "series" | "anime";
  provider: string;
  initialValue?: string;
  placeholder: string;
}): Promise<string | null> {
  const session = mountShell<string | null>({
    renderShell: (finish) => {
      return (
        <SearchShell
          mode={mode}
          provider={provider}
          initialValue={initialValue}
          placeholder={placeholder}
          onSubmit={(value) => finish(value.length > 0 ? value : null)}
          onCancel={() => finish(null)}
        />
      );
    },
    fallbackValue: null,
    clearOnResolve: false,
  });

  return session.result;
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

function truncateLine(value: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (value.length <= maxLength) return value;
  if (maxLength <= 1) return "…";
  return `${value.slice(0, maxLength - 1)}…`;
}

function wrapText(value: string, width: number, maxLines: number): string[] {
  if (width <= 0 || maxLines <= 0) return [];

  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length <= width) {
      current = candidate;
      continue;
    }

    lines.push(current);
    if (lines.length === maxLines) {
      lines[maxLines - 1] = truncateLine(lines[maxLines - 1] ?? "", width);
      return lines;
    }
    current = word;
  }

  if (current.length > 0 && lines.length < maxLines) {
    lines.push(current);
  }

  return lines
    .slice(0, maxLines)
    .map((line, index, all) => (index === all.length - 1 ? truncateLine(line, width) : line));
}

function deleteLastWord(value: string): string {
  return value.replace(/\s*\S+\s*$/, "");
}

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

function getWindowStart(selectedIndex: number, total: number, windowSize: number): number {
  if (total <= windowSize) return 0;

  const halfWindow = Math.floor(windowSize / 2);
  let start = selectedIndex - halfWindow;
  if (start < 0) start = 0;
  if (start + windowSize > total) start = total - windowSize;
  return start;
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
          setCommandInput(target.aliases[0] ?? target.id);
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
      if (key.backspace || key.delete) {
        setCommandInput((current) => current.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setCommandInput((current) => current + input);
        setHighlightedCommandIndex(0);
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
    if (key.ctrl && input.toLowerCase() === "w") {
      setFilterQuery((current) => deleteLastWord(current));
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
                {visibleOptions.map((option, i) => {
                  const optionIndex = windowStart + i;
                  const selected = optionIndex === index;
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
                    <Box key={optionIndex}>
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
                      {detailLines.map((line, lineIndex) => (
                        <Text key={`${line}-${lineIndex}`} color={palette.muted}>
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

type BrowseOverlay =
  | {
      type: "help" | "about" | "diagnostics" | "history" | "details";
      title: string;
      subtitle: string;
      lines: readonly ShellPanelLine[];
      imageUrl?: string;
      loading?: boolean;
      scrollIndex?: number;
    }
  | {
      type: "provider";
      title: string;
      subtitle: string;
      options: readonly ShellPickerOption<string>[];
      filterQuery: string;
      selectedIndex: number;
      busy?: boolean;
    }
  | {
      type: "settings";
      title: string;
      subtitle: string;
      options: readonly ShellPickerOption<string>[];
      filterQuery: string;
      selectedIndex: number;
      dirty: boolean;
      busy?: boolean;
    }
  | {
      type: "settings-choice";
      title: string;
      subtitle: string;
      setting: SettingsChoiceValue;
      options: readonly ShellPickerOption<string>[];
      filterQuery: string;
      selectedIndex: number;
      parentSelectedIndex?: number;
      busy?: boolean;
    }
  | {
      type: "episode-picker";
      title: string;
      subtitle: string;
      options: readonly ShellPickerOption<string>[];
      filterQuery: string;
      selectedIndex: number;
      busy?: boolean;
    };

type SettingsAction =
  | "defaultMode"
  | "provider"
  | "animeProvider"
  | "subLang"
  | "animeLang"
  | "headless"
  | "showMemory"
  | "autoNext"
  | "footerHints"
  | "clearCache"
  | "clearHistory";

type SettingsChoiceValue = SettingsAction;

const SUBTITLE_SETTINGS_OPTIONS: readonly ShellPickerOption<string>[] = [
  { value: "en", label: "English" },
  { value: "fzf", label: "Pick interactively" },
  { value: "none", label: "None" },
  { value: "ar", label: "Arabic" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "es", label: "Spanish" },
  { value: "ja", label: "Japanese" },
];

const ANIME_AUDIO_SETTINGS_OPTIONS: readonly ShellPickerOption<"sub" | "dub">[] = [
  { value: "sub", label: "Sub", detail: "Original audio with subtitles" },
  { value: "dub", label: "Dub", detail: "Dubbed audio when available" },
];

const FOOTER_HINT_OPTIONS: readonly ShellPickerOption<"detailed" | "minimal">[] = [
  {
    value: "detailed",
    label: "Detailed",
    detail: "Current task plus a second line of active shortcuts",
  },
  {
    value: "minimal",
    label: "Minimal",
    detail: "Keep the task visible and trim the shortcut strip down",
  },
];

function buildSettingsSummary(config: KitsuneConfig): string {
  return `${config.defaultMode} default  ·  series ${config.provider}  ·  anime ${config.animeProvider}  ·  footer ${config.footerHints}`;
}

function buildSettingsOptions(config: KitsuneConfig): readonly ShellPickerOption<SettingsAction>[] {
  return [
    {
      value: "defaultMode",
      label: `Default startup mode  ·  ${config.defaultMode}`,
      detail: "Series or anime when the app launches",
    },
    {
      value: "provider",
      label: `Default provider  ·  ${config.provider}`,
      detail: "Movies and series provider",
    },
    {
      value: "animeProvider",
      label: `Anime provider  ·  ${config.animeProvider}`,
      detail: "Default anime source",
    },
    {
      value: "subLang",
      label: `Subtitles  ·  ${config.subLang}`,
      detail: "Preferred subtitle behavior",
    },
    {
      value: "animeLang",
      label: `Anime audio  ·  ${config.animeLang}`,
      detail: "Sub or dub preference",
    },
    {
      value: "headless",
      label: `Browser mode  ·  ${config.headless ? "headless" : "visible"}`,
      detail: "Playwright browser visibility",
    },
    {
      value: "showMemory",
      label: `Memory line  ·  ${config.showMemory ? "shown" : "hidden"}`,
      detail: "Show memory usage in playback shell",
    },
    {
      value: "autoNext",
      label: `Autoplay next  ·  ${config.autoNext ? "on" : "off"}`,
      detail: "Close mpv on EOF and continue through the next available released episode",
    },
    {
      value: "footerHints",
      label: `Footer hints  ·  ${config.footerHints}`,
      detail: "Detailed keeps two lines, minimal keeps only the task line",
    },
    {
      value: "clearCache",
      label: "Clear stream cache",
      detail: "Wipe the local URL cache (stream_cache.json)",
    },
    {
      value: "clearHistory",
      label: "Clear watch history",
      detail: "Reset all watch progress and history",
    },
  ];
}

function buildSettingsProviderOptions({
  providers,
  currentProvider,
}: {
  providers: readonly import("@/domain/types").ProviderMetadata[];
  currentProvider: string;
}): readonly ShellPickerOption<string>[] {
  return providers.map((provider) => ({
    value: provider.id,
    label: provider.id === currentProvider ? `${provider.name}  ·  current` : provider.name,
    detail: provider.description,
  }));
}

function buildSettingsChoiceOverlay({
  config,
  setting,
  seriesProviderOptions,
  animeProviderOptions,
  parentSelectedIndex = 0,
}: {
  config: KitsuneConfig;
  setting: SettingsChoiceValue;
  seriesProviderOptions: readonly ShellPickerOption<string>[];
  animeProviderOptions: readonly ShellPickerOption<string>[];
  parentSelectedIndex?: number;
}): Extract<BrowseOverlay, { type: "settings-choice" }> {
  let title = "Choose setting";
  let subtitle = "Select a value";
  let options: readonly ShellPickerOption<string>[] = [];

  if (setting === "defaultMode") {
    title = "Default startup mode";
    subtitle = `Current ${config.defaultMode}`;
    options = [
      { value: "series", label: "Series mode", detail: "Browse movies and TV on launch" },
      { value: "anime", label: "Anime mode", detail: "Browse anime on launch" },
    ].map((option) => ({
      ...option,
      label: option.value === config.defaultMode ? `${option.label}  ·  current` : option.label,
    }));
  } else if (setting === "provider") {
    title = "Default provider";
    subtitle = `Current ${config.provider}`;
    options = seriesProviderOptions.map((option) => ({
      ...option,
      label:
        option.value === config.provider
          ? `${option.label.replace(/  ·  current$/, "")}  ·  current`
          : option.label.replace(/  ·  current$/, ""),
    }));
  } else if (setting === "animeProvider") {
    title = "Anime provider";
    subtitle = `Current ${config.animeProvider}`;
    options = animeProviderOptions.map((option) => ({
      ...option,
      label:
        option.value === config.animeProvider
          ? `${option.label.replace(/  ·  current$/, "")}  ·  current`
          : option.label.replace(/  ·  current$/, ""),
    }));
  } else if (setting === "subLang") {
    title = "Subtitle preference";
    subtitle = `Current ${config.subLang}`;
    options = SUBTITLE_SETTINGS_OPTIONS.map((option) => ({
      ...option,
      label: option.value === config.subLang ? `${option.label}  ·  current` : option.label,
    }));
  } else if (setting === "animeLang") {
    title = "Anime audio";
    subtitle = `Current ${config.animeLang}`;
    options = ANIME_AUDIO_SETTINGS_OPTIONS.map((option) => ({
      ...option,
      label: option.value === config.animeLang ? `${option.label}  ·  current` : option.label,
    })) as readonly ShellPickerOption<string>[];
  } else if (setting === "footerHints") {
    title = "Footer hint density";
    subtitle = `Current ${config.footerHints}`;
    options = FOOTER_HINT_OPTIONS.map((option) => ({
      ...option,
      label: option.value === config.footerHints ? `${option.label}  ·  current` : option.label,
    })) as readonly ShellPickerOption<string>[];
  }

  return {
    type: "settings-choice",
    title,
    subtitle,
    setting,
    options,
    filterQuery: "",
    selectedIndex: 0,
    parentSelectedIndex,
    busy: false,
  };
}

function settingsEqual(
  left: KitsuneConfig | null | undefined,
  right: KitsuneConfig | null | undefined,
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function resolvePanelTone(tone: ShellPanelLine["tone"]): string {
  switch (tone) {
    case "success":
      return palette.green;
    case "warning":
      return palette.amber;
    case "error":
      return palette.red;
    case "neutral":
    default:
      return palette.muted;
  }
}

function OverlayPanel({
  overlay,
  width,
  maxLinesOverride,
}: {
  overlay: BrowseOverlay;
  width: number;
  maxLinesOverride?: number;
}) {
  const contentWidth = Math.max(24, width - 4);
  const maxLines =
    maxLinesOverride ??
    (overlay.type === "provider" ||
    overlay.type === "settings" ||
    overlay.type === "settings-choice" ||
    overlay.type === "episode-picker"
      ? 8
      : 6);
  const optionWindowStart =
    overlay.type === "provider" ||
    overlay.type === "settings" ||
    overlay.type === "settings-choice" ||
    overlay.type === "episode-picker"
      ? getWindowStart(overlay.selectedIndex, overlay.options.length, maxLines)
      : 0;
  const optionWindowEnd = optionWindowStart + maxLines;
  const visibleOptions =
    overlay.type === "provider" ||
    overlay.type === "settings" ||
    overlay.type === "settings-choice" ||
    overlay.type === "episode-picker"
      ? overlay.options.slice(optionWindowStart, optionWindowEnd)
      : [];

  return (
    <Box
      marginTop={1}
      flexDirection="column"
      borderStyle="round"
      borderColor={
        overlay.type === "settings" || overlay.type === "settings-choice"
          ? palette.green
          : overlay.type === "provider"
            ? palette.amber
            : palette.cyan
      }
      paddingX={1}
    >
      <Text
        color={
          overlay.type === "settings" || overlay.type === "settings-choice"
            ? palette.green
            : overlay.type === "provider"
              ? palette.amber
              : palette.cyan
        }
      >
        {overlay.title}
      </Text>
      <Text color={palette.gray}>{overlay.subtitle}</Text>
      {overlay.type === "provider" ||
      overlay.type === "settings" ||
      overlay.type === "settings-choice" ||
      overlay.type === "episode-picker" ? (
        <>
          <Box marginTop={1}>
            <Text color={palette.gray}>
              {overlay.filterQuery.length > 0
                ? `Filter: ${overlay.filterQuery}`
                : overlay.type === "provider"
                  ? "Type to narrow providers"
                  : overlay.type === "episode-picker"
                    ? "Type to narrow episodes"
                    : "Type to narrow this list"}
            </Text>
          </Box>
          <Box marginTop={1} flexDirection="column">
            {optionWindowStart > 0 ? <Text color={palette.gray}> ▲ ...</Text> : null}
            {visibleOptions.map((option, index) => {
              const optionIndex = optionWindowStart + index;
              const selected = optionIndex === overlay.selectedIndex;
              const row = truncateLine(
                `${option.label}${option.detail ? `  ${option.detail}` : ""}`,
                contentWidth,
              );
              return (
                <Text
                  key={`${option.value}-${optionIndex}`}
                  backgroundColor={selected ? palette.cyan : undefined}
                  color={selected ? "black" : "white"}
                  bold={selected}
                  dimColor={!selected}
                >
                  <Text color={selected ? "black" : palette.gray}>{selected ? "❯ " : "  "}</Text>
                  {row}
                </Text>
              );
            })}
            {optionWindowEnd < overlay.options.length ? (
              <Text color={palette.gray}> ▼ ...</Text>
            ) : null}
          </Box>
          <Box marginTop={1}>
            <Text color={overlay.busy ? palette.amber : palette.gray}>
              {overlay.busy
                ? overlay.type === "provider"
                  ? "Updating provider…"
                  : "Saving settings…"
                : overlay.type === "provider"
                  ? "Type to filter, ↑↓ to choose, Enter to switch, Esc to close"
                  : overlay.type === "episode-picker"
                    ? "Type to filter, ↑↓ to choose, Enter to jump, Esc to close"
                    : overlay.type === "settings"
                      ? "Type to filter, ↑↓ to choose, Enter to edit"
                      : "Type to filter, ↑↓ to choose, Enter to apply, Esc to go back"}
            </Text>
          </Box>
          {overlay.type === "settings" ? (
            <Box marginTop={1}>
              <Badge
                label={overlay.dirty ? "s save changes" : "s close"}
                tone={overlay.dirty ? "success" : "neutral"}
              />
              <Badge label={overlay.dirty ? "esc discard" : "esc close"} tone="warning" />
            </Box>
          ) : null}
        </>
      ) : overlay.loading ? (
        <Box marginTop={1}>
          <Text color={palette.amber}>Loading panel…</Text>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          {overlay.type === "details" ? (
            <Box marginBottom={1} flexDirection="column">
              <Text color={overlay.imageUrl ? palette.green : palette.amber}>
                {overlay.imageUrl ? "Poster image ready" : "Poster image missing"}
              </Text>
              <Text color={palette.gray}>
                {overlay.imageUrl
                  ? truncateLine(overlay.imageUrl, contentWidth)
                  : "This provider did not expose artwork for the selected title."}
              </Text>
              <Text color={palette.gray}>
                Inline Kitty/Ghostty rendering is kept behind the image-pane path to avoid Ink
                scroll flicker.
              </Text>
            </Box>
          ) : null}
          {overlay.lines
            .slice(overlay.scrollIndex ?? 0, (overlay.scrollIndex ?? 0) + maxLines)
            .map((line, index) => (
              <Box key={`${line.label}-${index}`} flexDirection="column" marginBottom={1}>
                <Text color={resolvePanelTone(line.tone)}>
                  {truncateLine(line.label, contentWidth)}
                </Text>
                {line.detail
                  ? wrapText(line.detail, contentWidth, 2).map((detailLine, detailIndex) => (
                      <Text key={`${line.label}-${detailIndex}`} color={palette.gray}>
                        {detailLine}
                      </Text>
                    ))
                  : null}
              </Box>
            ))}
          <Text color={palette.gray}>
            {overlay.lines.length > maxLines
              ? `Showing ${(overlay.scrollIndex ?? 0) + 1}-${Math.min(
                  (overlay.scrollIndex ?? 0) + maxLines,
                  overlay.lines.length,
                )} of ${overlay.lines.length}  ·  ↑↓ scroll  ·  Esc closes`
              : "Esc closes this panel"}
          </Text>
        </Box>
      )}
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
  const [poster, setPoster] = useState<PosterResult>({ kind: "none" });
  const [posterState, setPosterState] = useState<"idle" | "loading" | "ready" | "unavailable">(
    "idle",
  );
  const requestIdRef = useRef(0);

  // Debounced poster fetch so result navigation stays responsive while posters swap.
  useEffect(() => {
    const isWide = getShellViewportPolicy("browse", stdout.columns, stdout.rows).wideBrowse;
    const url = options[selectedIndex]?.previewImageUrl;
    if (!url || !isWide) {
      setPosterState(url ? "unavailable" : "idle");
      setPoster((prev) => {
        if (prev.kind === "kitty") deleteKittyImage(prev.imageId);
        return { kind: "none" };
      });
      return;
    }
    let cancelled = false;
    setPosterState("loading");
    const timer = setTimeout(() => {
      fetchPoster(url, { rows: 8, cols: 18 })
        .then((r) => {
          if (!cancelled) {
            setPosterState(r.kind === "none" ? "unavailable" : "ready");
            setPoster((prev) => {
              if (prev.kind === "kitty" && (r.kind !== "kitty" || prev.imageId !== r.imageId)) {
                deleteKittyImage(prev.imageId);
              }
              return r;
            });
          }
        })
        .catch(() => {
          if (!cancelled) setPosterState("unavailable");
        });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [options[selectedIndex]?.previewImageUrl, stdout.columns, stdout.rows]);

  // Cleanup Kitty image on unmount
  useEffect(() => {
    return () => {
      setPoster((prev) => {
        if (prev.kind === "kitty") deleteKittyImage(prev.imageId);
        return { kind: "none" };
      });
    };
  }, []);

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
  const previewMeta = selectedOption?.previewMeta ?? [];
  const previewBodyLines = wrapText(
    selectedOption?.previewBody ??
      (options.length > 0
        ? "No description available."
        : "Type a title and press Enter to search."),
    Math.max(previewWidth - 2, 24),
    ultraCompact ? 1 : compact ? 2 : 3,
  );
  const showCompanion =
    wideBrowse &&
    !compact &&
    Boolean(
      poster.kind !== "none" ||
      selectedOption?.previewTitle ||
      previewMeta.length > 0 ||
      previewBodyLines.some((line) => line.trim().length > 0) ||
      selectedOption?.previewNote,
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
          setCommandInput(target.aliases[0] ?? target.id);
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
      if (key.backspace || key.delete) {
        setCommandInput((current) => current.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setCommandInput((current) => current + input);
        setHighlightedCommandIndex(0);
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

    if (key.ctrl && input.toLowerCase() === "w") {
      updateQuery(deleteLastWord(query));
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
                  <Box key={optionIndex} flexDirection="column">
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
                        .map((line, i) => <Text key={i}>{line}</Text>)
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
                  {truncateLine(
                    selectedOption?.previewTitle ?? selectedOption?.label ?? "No selection yet",
                    previewWidth,
                  )}
                </Text>
                {previewMeta.length > 0 && !ultraCompact ? (
                  <Box marginTop={1} flexWrap="wrap">
                    {previewMeta.slice(0, 3).map((meta, index) => (
                      <Badge
                        key={`${meta}-${index}`}
                        label={truncateLine(meta, Math.max(12, previewWidth - 8))}
                        tone={index === 2 ? "accent" : index === 0 ? "info" : "neutral"}
                      />
                    ))}
                  </Box>
                ) : null}
                {previewBodyLines.length > 0 ? (
                  <Box marginTop={1} flexDirection="column">
                    {previewBodyLines.map((line, index) => (
                      <Text key={`${line}-${index}`} color={palette.muted}>
                        {line}
                      </Text>
                    ))}
                  </Box>
                ) : null}
                {!ultraCompact ? (
                  <Box marginTop={1}>
                    <Text color={palette.gray}>
                      {selectedOption?.previewNote ??
                        truncateLine(selectedDetail, Math.max(previewWidth, 48))}
                    </Text>
                  </Box>
                ) : null}
              </Box>
            ) : (
              <Box marginTop={1} flexDirection="column">
                <Text bold color="white">
                  {truncateLine(
                    selectedOption?.previewTitle ?? selectedOption?.label ?? "",
                    innerWidth,
                  )}
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
      const session = mountShell<ListShellSubmitResult<T>>({
        renderShell: (finish) => (
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
        clearOnResolve: false,
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

export function formatMemoryUsage(): string {
  const memory = process.memoryUsage();
  const toMb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `Mem  RSS ${toMb(memory.rss)}  ·  Heap ${toMb(memory.heapUsed)}/${toMb(memory.heapTotal)}`;
}
