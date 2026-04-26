import React, { useEffect, useRef, useState } from "react";
import { Box, Text, render, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { getShellViewportPolicy } from "@/app-shell/layout-policy";

import {
  COMMANDS,
  parseCommand,
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
  amber: "#d4a44c",
  cyan: "#78dce8",
  green: "#8dd694",
  red: "#ff8b8b",
  gray: "#7c7f8a",
  muted: "#a6acb9",
};

const APP_LABEL = "KitsuneSnipe beta";

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
        <Box borderStyle="round" borderColor={palette.amber} paddingX={1} flexDirection="column">
          <Text color="white">{taskLabel}</Text>
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
      <Box borderStyle="round" borderColor={palette.gray} paddingX={1} flexDirection="column">
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
  onResolve,
}: {
  footerActions: readonly FooterAction[];
  commands: readonly ResolvedAppCommand[];
  onResolve: (action: ShellAction) => void;
}) {
  const [commandMode, setCommandMode] = useState(false);
  const [commandInput, setCommandInput] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  useEffect(() => {
    if (!commandMode) {
      setHighlightedIndex(0);
      return;
    }

    const matches = getCommandMatches(commandInput, commands);
    setHighlightedIndex((current) => {
      if (matches.length === 0) return 0;
      return Math.min(current, matches.length - 1);
    });
  }, [commandInput, commandMode, commands]);

  useInput((input, key) => {
    if (key.escape) {
      if (commandMode) {
        setCommandMode(false);
        setCommandInput("");
        setHighlightedIndex(0);
        return;
      }
      onResolve("quit");
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
    if (footerAction) onResolve(footerAction.action);
  });

  return { commandMode, commandInput, highlightedIndex };
}

function ShellFrame({
  eyebrow,
  title,
  subtitle,
  status,
  footerTask,
  footerActions,
  footerMode,
  commands,
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
    onResolve,
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      <Box
        borderStyle="round"
        borderColor={palette.gray}
        flexDirection="column"
        paddingX={1}
        paddingY={0}
      >
        <Text color={palette.amber}>{eyebrow}</Text>
        <Box marginTop={1} justifyContent="space-between">
          <Text bold color="white">
            {title}
          </Text>
          {status ? <Text color={statusColor(status.tone)}>{status.label}</Text> : null}
        </Box>
        <Text color={palette.muted}>{subtitle}</Text>
        <Box marginTop={1} flexDirection="column">
          {children}
        </Box>
      </Box>

      {commandMode ? (
        <CommandPalette
          input={commandInput}
          commands={commands}
          highlightedIndex={highlightedIndex}
        />
      ) : null}

      <ShellFooter
        taskLabel={footerTask}
        actions={footerActions}
        mode={footerMode}
        commandMode={commandMode}
      />
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

type MountedShell<TResult> = {
  close: (value: TResult) => void;
  result: Promise<TResult>;
};

function clearShellScreen() {
  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[2J\x1b[H");
  }
}

function mountShell<TResult>({
  renderShell,
  fallbackValue,
}: {
  renderShell: (finish: (value: TResult) => void) => React.ReactElement;
  fallbackValue: TResult;
}): MountedShell<TResult> {
  stdinManager.enterShell();
  clearShellScreen();

  let settled = false;
  let resolveResult!: (value: TResult) => void;
  let ink!: ReturnType<typeof render>;
  let exitPromise!: Promise<unknown>;

  const result = new Promise<TResult>((resolve) => {
    resolveResult = resolve;
  });

  const settle = (value: TResult, shouldUnmount: boolean) => {
    if (settled) return;
    settled = true;

    if (shouldUnmount) {
      ink.unmount();
    }

    void exitPromise.then(() => {
      stdinManager.exitShell();
      resolveResult(value);
    });
  };

  ink = render(
    renderShell((value) => settle(value, true)),
    {
      exitOnCtrlC: false,
    },
  );
  exitPromise = ink.waitUntilExit();

  void exitPromise.then(() => {
    if (!settled) {
      settled = true;
      stdinManager.exitShell();
      resolveResult(fallbackValue);
    }
  });

  return {
    close: (value: TResult) => settle(value, true),
    result,
  };
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
    { key: "/", label: "commands", action: "search" },
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
  providerOptions,
  settings,
  settingsSeriesProviderOptions,
  settingsAnimeProviderOptions,
  onSaveSettings,
  loadHistoryPanel,
  loadDiagnosticsPanel,
  loadHelpPanel,
  loadAboutPanel,
  onChangeProvider,
  onResolve,
}: {
  state: PlaybackShellState;
  providerOptions?: readonly ShellPickerOption<string>[];
  settings?: KitsuneConfig;
  settingsSeriesProviderOptions?: readonly ShellPickerOption<string>[];
  settingsAnimeProviderOptions?: readonly ShellPickerOption<string>[];
  onSaveSettings?: (next: KitsuneConfig) => Promise<void>;
  loadHistoryPanel?: () => Promise<readonly ShellPanelLine[]>;
  loadDiagnosticsPanel?: () => Promise<readonly ShellPanelLine[]>;
  loadHelpPanel?: () => Promise<readonly ShellPanelLine[]>;
  loadAboutPanel?: () => Promise<readonly ShellPanelLine[]>;
  onChangeProvider?: (providerId: string) => Promise<void>;
  onResolve: (action: ShellAction) => void;
}) {
  const [activeProvider, setActiveProvider] = useState(state.provider);
  const [activeOverlay, setActiveOverlay] = useState<BrowseOverlay | null>(null);
  const [draftSettings, setDraftSettings] = useState<KitsuneConfig | null>(null);
  const [appliedSettings, setAppliedSettings] = useState<KitsuneConfig | null>(settings ?? null);
  const { stdout } = useStdout();
  const playbackViewport = getShellViewportPolicy("playback", stdout.columns, stdout.rows);
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
    { key: "/", label: "commands", action: "replay" },
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
  ];

  const location =
    state.type === "series"
      ? `S${String(state.season).padStart(2, "0")}E${String(state.episode).padStart(2, "0")}`
      : "Movie";

  const openInfoOverlay = async ({
    type,
    title,
    subtitle,
    loader,
  }: {
    type: "help" | "about" | "diagnostics" | "history";
    title: string;
    subtitle: string;
    loader?: () => Promise<readonly ShellPanelLine[]>;
  }) => {
    setActiveOverlay({
      type,
      title,
      subtitle,
      lines: [],
      loading: true,
      scrollIndex: 0,
    });

    try {
      const lines = loader ? await loader() : [];
      setActiveOverlay({
        type,
        title,
        subtitle,
        lines,
        loading: false,
        scrollIndex: 0,
      });
    } catch (error) {
      setActiveOverlay({
        type,
        title,
        subtitle,
        lines: [
          {
            label: "Unable to load this panel",
            detail: String(error),
            tone: "error",
          },
        ],
        loading: false,
        scrollIndex: 0,
      });
    }
  };

  const openSettingsOverlay = (nextDraft: KitsuneConfig, selectedIndex = 0) => {
    const dirty = !settingsEqual(nextDraft, appliedSettings);
    setDraftSettings(nextDraft);
    setActiveOverlay({
      type: "settings",
      title: "Settings",
      subtitle: buildSettingsSummary(nextDraft),
      options: buildSettingsOptions(nextDraft, dirty),
      filterQuery: "",
      selectedIndex,
      dirty,
      busy: false,
    });
  };

  const openSettingsChoiceOverlay = (
    nextDraft: KitsuneConfig,
    setting: SettingsChoiceValue,
    parentSelectedIndex = 0,
  ) => {
    let title = "Choose setting";
    let subtitle = "Select a value";
    let options: readonly ShellPickerOption<string>[] = [];

    if (setting === "defaultMode") {
      title = "Default startup mode";
      subtitle = `Current ${nextDraft.defaultMode}`;
      options = [
        { value: "series", label: "Series mode", detail: "Browse movies and TV on launch" },
        { value: "anime", label: "Anime mode", detail: "Browse anime on launch" },
      ].map((option) => ({
        ...option,
        label:
          option.value === nextDraft.defaultMode ? `${option.label}  ·  current` : option.label,
      }));
    } else if (setting === "provider") {
      title = "Default provider";
      subtitle = `Current ${nextDraft.provider}`;
      options = (settingsSeriesProviderOptions ?? []).map((option) => ({
        ...option,
        label:
          option.value === nextDraft.provider
            ? `${option.label.replace(/  ·  current$/, "")}  ·  current`
            : option.label.replace(/  ·  current$/, ""),
      }));
    } else if (setting === "animeProvider") {
      title = "Anime provider";
      subtitle = `Current ${nextDraft.animeProvider}`;
      options = (settingsAnimeProviderOptions ?? []).map((option) => ({
        ...option,
        label:
          option.value === nextDraft.animeProvider
            ? `${option.label.replace(/  ·  current$/, "")}  ·  current`
            : option.label.replace(/  ·  current$/, ""),
      }));
    } else if (setting === "subLang") {
      title = "Subtitle preference";
      subtitle = `Current ${nextDraft.subLang}`;
      options = SUBTITLE_SETTINGS_OPTIONS.map((option) => ({
        ...option,
        label: option.value === nextDraft.subLang ? `${option.label}  ·  current` : option.label,
      }));
    } else if (setting === "animeLang") {
      title = "Anime audio";
      subtitle = `Current ${nextDraft.animeLang}`;
      options = ANIME_AUDIO_SETTINGS_OPTIONS.map((option) => ({
        ...option,
        label: option.value === nextDraft.animeLang ? `${option.label}  ·  current` : option.label,
      })) as readonly ShellPickerOption<string>[];
    } else if (setting === "footerHints") {
      title = "Footer hint density";
      subtitle = `Current ${nextDraft.footerHints}`;
      options = FOOTER_HINT_OPTIONS.map((option) => ({
        ...option,
        label:
          option.value === nextDraft.footerHints ? `${option.label}  ·  current` : option.label,
      })) as readonly ShellPickerOption<string>[];
    }

    setActiveOverlay({
      type: "settings-choice",
      title,
      subtitle,
      setting,
      options,
      filterQuery: "",
      selectedIndex: 0,
      parentSelectedIndex,
      busy: false,
    });
  };

  const handleLocalAction = (action: ShellAction): boolean => {
    if (action === "settings" && appliedSettings && onSaveSettings) {
      openSettingsOverlay(appliedSettings);
      return true;
    }
    if (action === "provider" && providerOptions && onChangeProvider) {
      setActiveOverlay({
        type: "provider",
        title: "Provider",
        subtitle: `Current provider ${activeProvider}`,
        options: providerOptions,
        filterQuery: "",
        selectedIndex: 0,
        busy: false,
      });
      return true;
    }
    if (action === "history" && loadHistoryPanel) {
      void openInfoOverlay({
        type: "history",
        title: "History",
        subtitle: "Recent playback positions without leaving playback",
        loader: loadHistoryPanel,
      });
      return true;
    }
    if (action === "diagnostics" && loadDiagnosticsPanel) {
      void openInfoOverlay({
        type: "diagnostics",
        title: "Diagnostics",
        subtitle: "Current runtime snapshot and recent events",
        loader: loadDiagnosticsPanel,
      });
      return true;
    }
    if (action === "help" && loadHelpPanel) {
      void openInfoOverlay({
        type: "help",
        title: "Help",
        subtitle: "Playback commands and shell behavior",
        loader: loadHelpPanel,
      });
      return true;
    }
    if (action === "about" && loadAboutPanel) {
      void openInfoOverlay({
        type: "about",
        title: "About",
        subtitle: "KitsuneSnipe beta",
        loader: loadAboutPanel,
      });
      return true;
    }
    return false;
  };

  const filteredOverlayOptions =
    activeOverlay &&
    (activeOverlay.type === "provider" ||
      activeOverlay.type === "settings" ||
      activeOverlay.type === "settings-choice")
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
        if (activeOverlay.type === "settings-choice" && draftSettings) {
          openSettingsOverlay(draftSettings);
          return;
        }
        setActiveOverlay(null);
        return;
      }

      if (
        activeOverlay.type === "provider" ||
        activeOverlay.type === "settings" ||
        activeOverlay.type === "settings-choice"
      ) {
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

          if (activeOverlay.type === "provider") {
            if (!onChangeProvider) return;
            setActiveOverlay({ ...activeOverlay, busy: true });
            void onChangeProvider(target.value)
              .then(() => {
                setActiveProvider(target.value);
                setActiveOverlay(null);
              })
              .catch((error) => {
                setActiveOverlay({
                  ...activeOverlay,
                  busy: false,
                  subtitle: `Failed to switch provider: ${String(error)}`,
                });
              });
            return;
          }

          if (activeOverlay.type === "settings") {
            if (!draftSettings) return;
            const action = target.value;
            if (action === "__discard") {
              setDraftSettings(null);
              setActiveOverlay(null);
              return;
            }
            if (action === "__save") {
              if (!onSaveSettings) {
                setDraftSettings(null);
                setActiveOverlay(null);
                return;
              }
              setActiveOverlay({ ...activeOverlay, busy: true });
              void onSaveSettings(draftSettings)
                .then(() => {
                  setAppliedSettings(draftSettings);
                  setDraftSettings(null);
                  setActiveOverlay(null);
                })
                .catch((error) => {
                  setActiveOverlay({
                    ...activeOverlay,
                    busy: false,
                    subtitle: `Failed to save settings: ${String(error)}`,
                  });
                });
              return;
            }
            if (action === "headless") {
              openSettingsOverlay(
                { ...draftSettings, headless: !draftSettings.headless },
                activeOverlay.selectedIndex,
              );
              return;
            }
            if (action === "showMemory") {
              openSettingsOverlay(
                { ...draftSettings, showMemory: !draftSettings.showMemory },
                activeOverlay.selectedIndex,
              );
              return;
            }
            if (action === "autoNext") {
              openSettingsOverlay(
                { ...draftSettings, autoNext: !draftSettings.autoNext },
                activeOverlay.selectedIndex,
              );
              return;
            }
            openSettingsChoiceOverlay(
              draftSettings,
              action as SettingsChoiceValue,
              activeOverlay.selectedIndex,
            );
            return;
          }

          if (!draftSettings) return;
          const updatedDraft = { ...draftSettings };
          if (activeOverlay.setting === "defaultMode") {
            updatedDraft.defaultMode = target.value as "series" | "anime";
          } else if (activeOverlay.setting === "provider") {
            updatedDraft.provider = target.value;
          } else if (activeOverlay.setting === "animeProvider") {
            updatedDraft.animeProvider = target.value;
          } else if (activeOverlay.setting === "subLang") {
            updatedDraft.subLang = target.value;
          } else if (activeOverlay.setting === "animeLang") {
            updatedDraft.animeLang = target.value as "sub" | "dub";
          } else if (activeOverlay.setting === "footerHints") {
            updatedDraft.footerHints = target.value as "detailed" | "minimal";
          }
          openSettingsOverlay(updatedDraft, activeOverlay.parentSelectedIndex ?? 0);
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

      if (
        (key.upArrow || key.downArrow) &&
        !activeOverlay.loading &&
        activeOverlay.lines.length > 0
      ) {
        const maxScroll = Math.max(0, activeOverlay.lines.length - 1);
        const nextScroll = key.upArrow
          ? Math.max(0, (activeOverlay.scrollIndex ?? 0) - 1)
          : Math.min(maxScroll, (activeOverlay.scrollIndex ?? 0) + 1);
        setActiveOverlay({ ...activeOverlay, scrollIndex: nextScroll });
      }
      return;
    }

    if (key.return) {
      resolvePlaybackAction("replay");
    }
  });

  return (
    <ShellFrame
      eyebrow={APP_LABEL}
      title={state.title}
      subtitle={`${location}  ·  Provider ${activeProvider}  ·  Mode ${state.mode}`}
      status={state.status}
      footerTask="Review playback actions and continue this session"
      footerActions={footerActions}
      footerMode={state.footerMode}
      commands={commands}
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
          <Text color={palette.muted}>
            Playback controls stay visible and command-driven. Use `/` for direct actions without
            leaving the shell.
          </Text>
          <Box marginTop={1}>
            <Badge label={`provider ${activeProvider}`} tone="info" />
            <Badge label={state.mode === "anime" ? "anime mode" : "series mode"} />
            {state.type === "series" ? (
              <Badge
                label={`episode S${String(state.season).padStart(2, "0")}E${String(
                  state.episode,
                ).padStart(2, "0")}`}
              />
            ) : (
              <Badge label="movie" />
            )}
            {state.subtitleStatus ? (
              <Badge
                label={state.subtitleStatus}
                tone={state.subtitleStatus.toLowerCase().includes("not found") ? "neutral" : "info"}
              />
            ) : null}
            {activeOverlay ? (
              <Badge label={`${activeOverlay.title.toLowerCase()} panel`} tone="success" />
            ) : null}
          </Box>
          {state.subtitleStatus ? (
            <Box marginTop={1}>
              <Text color={palette.gray}>{state.subtitleStatus}</Text>
            </Box>
          ) : null}
          {state.showMemory && state.memoryUsage ? (
            <Box marginTop={1}>
              <Text color={palette.gray}>{state.memoryUsage}</Text>
            </Box>
          ) : null}
          {activeOverlay ? (
            <OverlayPanel
              overlay={
                activeOverlay.type === "provider" ||
                activeOverlay.type === "settings" ||
                activeOverlay.type === "settings-choice"
                  ? {
                      ...activeOverlay,
                      options: filteredOverlayOptions,
                      selectedIndex: Math.min(
                        activeOverlay.selectedIndex,
                        Math.max(filteredOverlayOptions.length - 1, 0),
                      ),
                    }
                  : activeOverlay
              }
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
  tone?: "neutral" | "info" | "success";
}) {
  const color = tone === "success" ? palette.green : tone === "info" ? palette.cyan : palette.gray;

  return (
    <Box borderStyle="round" borderColor={color} paddingX={1} marginRight={1}>
      <Text color={color}>{label}</Text>
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
      <Box borderStyle="round" borderColor={palette.gray} flexDirection="column" paddingX={1}>
        <Text color={palette.amber}>{APP_LABEL}</Text>
        <Box marginTop={1}>
          <Text bold color="white">
            {mode === "anime" ? "Search anime" : "Search titles"}
          </Text>
        </Box>
        <Text
          color={palette.muted}
        >{`Provider ${provider}  ·  Enter submits  ·  Esc cancels`}</Text>
        <Box marginTop={1}>
          <Text color={palette.cyan}>› </Text>
          <TextInput value={value} onChange={setValue} placeholder={placeholder} />
        </Box>
      </Box>
    </Box>
  );
}

// Simple spinner animation frames
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

function LoadingShell({ state, onCancel }: { state: LoadingShellState; onCancel?: () => void }) {
  const spinner = useSpinner();
  const { stdout } = useStdout();

  useInput((input, key) => {
    // Ctrl+C handling
    if (input === "\x03") {
      if (process.stdin.isTTY) process.stdin.unref();
      process.exit(0);
    }
    if (key.escape && state.cancellable && onCancel) {
      onCancel();
    }
  });

  const operationLabels: Record<LoadingShellState["operation"], string> = {
    searching: "Searching",
    scraping: "Scraping",
    resolving: "Resolving stream",
    loading: "Loading",
  };

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box>
        <Text color={palette.cyan}>{spinner} </Text>
        <Text bold color="white">
          {state.title}
        </Text>
      </Box>
      {state.subtitle && (
        <Box marginTop={1}>
          <Text color={palette.muted}>{state.subtitle}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={palette.amber}>{operationLabels[state.operation]}...</Text>
        {state.details && <Text color={palette.gray}> {state.details}</Text>}
      </Box>
      {state.progress !== undefined && (
        <Box marginTop={1}>
          <Box
            width={Math.min(40, stdout.columns - 4)}
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
      )}
      {state.cancellable && (
        <Box marginTop={1}>
          <Text color={palette.gray}>Press Esc to cancel</Text>
        </Box>
      )}
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
  });

  return session.result;
}

export function openHomeShell(state: HomeShellState): Promise<ShellAction> {
  return openShell({ Component: HomeShell, props: { state } });
}

export function openPlaybackShell({
  state,
  providerOptions,
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
  settings?: KitsuneConfig;
  settingsSeriesProviderOptions?: readonly ShellPickerOption<string>[];
  settingsAnimeProviderOptions?: readonly ShellPickerOption<string>[];
  onSaveSettings?: (next: KitsuneConfig) => Promise<void>;
  loadHistoryPanel?: () => Promise<readonly ShellPanelLine[]>;
  loadDiagnosticsPanel?: () => Promise<readonly ShellPanelLine[]>;
  loadHelpPanel?: () => Promise<readonly ShellPanelLine[]>;
  loadAboutPanel?: () => Promise<readonly ShellPanelLine[]>;
  onChangeProvider?: (providerId: string) => Promise<void>;
}): Promise<ShellAction> {
  return openShell({
    Component: PlaybackShell,
    props: {
      state,
      providerOptions,
      settings,
      settingsSeriesProviderOptions,
      settingsAnimeProviderOptions,
      onSaveSettings,
      loadHistoryPanel,
      loadDiagnosticsPanel,
      loadHelpPanel,
      loadAboutPanel,
      onChangeProvider,
    },
  });
}

export function openLoadingShell({
  state,
  cancellable = false,
}: {
  state: LoadingShellState;
  cancellable?: boolean;
}): LoadingShellHandle {
  const session = mountShell<"done" | "cancelled">({
    renderShell: (finish) => (
      <LoadingShell state={state} onCancel={cancellable ? () => finish("cancelled") : undefined} />
    ),
    fallbackValue: "done",
  });

  return {
    close: () => session.close("done"),
    result: session.result,
  };
}

export type LoadingShellHandle = {
  close: () => void;
  result: Promise<"done" | "cancelled">;
};

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
  const rowWidth = Math.max(20, innerWidth - 4);
  const selectedLabel = selectedOption?.label ?? "Nothing selected";
  const selectedDetail =
    selectedOption?.detail ??
    (filteredOptions.length > 0
      ? "Use ↑↓ to move through results"
      : "No matching results. Keep typing or press Esc to clear the filter.");

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
          { key: "/", label: "commands", action: "search" },
          { key: "esc", label: "back", action: "quit" },
        ]
      : [
          { key: "type", label: "filter", action: "search" },
          { key: "enter", label: "select", action: "search" },
          { key: "esc", label: "back", action: "quit" },
          ...(actionContext ? [{ key: "/", label: "commands", action: "search" as const }] : []),
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
      <Box
        borderStyle="round"
        borderColor={confirmed ? palette.green : palette.gray}
        flexDirection="column"
        paddingX={1}
        paddingY={0}
      >
        <Text color={palette.amber}>{APP_LABEL}</Text>
        <Box
          marginTop={1}
          flexDirection="column"
          borderStyle="round"
          borderColor={confirmed ? palette.green : palette.cyan}
          paddingX={1}
        >
          <Text color={confirmed ? palette.green : palette.cyan}>
            {confirmed ? "Selected" : title}
          </Text>
          <Text color={palette.muted}>{confirmed ? selectedLabel : subtitle}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={palette.cyan}>filter › </Text>
          <TextInput
            value={filterQuery}
            onChange={updateFilterQuery}
            placeholder="Type to narrow this list"
            focus={!commandMode}
            showCursor
          />
        </Box>
        {tooSmall ? (
          <ResizeBlocker minColumns={minColumns} minRows={minRows} />
        ) : (
          <>
            <Text color={palette.gray}>
              {`Selected ${filteredOptions.length > 0 ? index + 1 : 0} of ${filteredOptions.length}  ·  Showing ${filteredOptions.length} of ${options.length}`}
            </Text>
            <Box flexDirection="column" marginTop={1}>
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
                const secondary = option.detail ? `  ${truncateLine(option.detail, rowWidth)}` : "";
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
                marginTop={1}
                flexDirection="column"
                borderStyle="round"
                borderColor={palette.green}
                paddingX={1}
              >
                <Text color={palette.green}>Current Selection</Text>
                <Text bold color="white">
                  {truncateLine(selectedLabel, innerWidth)}
                </Text>
                <Text color={palette.muted}>{truncateLine(selectedDetail, innerWidth * 2)}</Text>
              </Box>
            ) : null}
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
      type: "help" | "about" | "diagnostics" | "history";
      title: string;
      subtitle: string;
      lines: readonly ShellPanelLine[];
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
  | "__save"
  | "__discard";

type SettingsChoiceValue = Exclude<SettingsAction, "__save" | "__discard">;

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

function buildSettingsOptions(
  config: KitsuneConfig,
  dirty: boolean,
): readonly ShellPickerOption<SettingsAction>[] {
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
      value: "__save",
      label: dirty ? "Save changes" : "Close settings",
      detail: dirty
        ? "Apply these settings to the runtime and future sessions"
        : "Nothing changed yet",
    },
    {
      value: "__discard",
      label: dirty ? "Discard changes" : "Back",
      detail: dirty ? "Close settings without saving this draft" : "Return to the previous screen",
    },
  ];
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

function OverlayPanel({ overlay, width }: { overlay: BrowseOverlay; width: number }) {
  const contentWidth = Math.max(24, width - 4);
  const maxLines =
    overlay.type === "provider" || overlay.type === "settings" || overlay.type === "settings-choice"
      ? 8
      : 10;
  const optionWindowStart =
    overlay.type === "provider" || overlay.type === "settings" || overlay.type === "settings-choice"
      ? getWindowStart(overlay.selectedIndex, overlay.options.length, maxLines)
      : 0;
  const optionWindowEnd = optionWindowStart + maxLines;
  const visibleOptions =
    overlay.type === "provider" || overlay.type === "settings" || overlay.type === "settings-choice"
      ? overlay.options.slice(optionWindowStart, optionWindowEnd)
      : [];

  return (
    <Box
      marginTop={1}
      flexDirection="column"
      borderStyle="round"
      borderColor={overlay.type === "provider" ? palette.amber : palette.cyan}
      paddingX={1}
    >
      <Text color={overlay.type === "provider" ? palette.amber : palette.cyan}>
        {overlay.title}
      </Text>
      <Text color={palette.gray}>{overlay.subtitle}</Text>
      {overlay.type === "provider" ||
      overlay.type === "settings" ||
      overlay.type === "settings-choice" ? (
        <>
          <Box marginTop={1}>
            <Text color={palette.gray}>
              {overlay.filterQuery.length > 0
                ? `Filter: ${overlay.filterQuery}`
                : overlay.type === "provider"
                  ? "Type to narrow providers"
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
                  : overlay.type === "settings"
                    ? "Type to filter, ↑↓ to choose, Enter to edit, Esc to discard or close"
                    : "Type to filter, ↑↓ to choose, Enter to apply, Esc to go back"}
            </Text>
          </Box>
        </>
      ) : overlay.loading ? (
        <Box marginTop={1}>
          <Text color={palette.amber}>Loading panel…</Text>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
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
          <Text color={palette.gray}>Esc closes this panel</Text>
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
  providerOptions,
  loadHistoryPanel,
  loadDiagnosticsPanel,
  loadHelpPanel,
  loadAboutPanel,
  onChangeProvider,
  onSearch,
  footerMode = "detailed",
  settings,
  settingsSeriesProviderOptions,
  settingsAnimeProviderOptions,
  onSaveSettings,
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
  const [activeProvider, setActiveProvider] = useState(provider);
  const [draftSettings, setDraftSettings] = useState<KitsuneConfig | null>(null);
  const [appliedSettings, setAppliedSettings] = useState<KitsuneConfig | null>(settings ?? null);
  const [options, setOptions] = useState<readonly BrowseShellOption<T>[]>(initialResults ?? []);
  const [selectedIndex, setSelectedIndex] = useState(initialSelectedIndex ?? 0);
  const [selectedDetail, setSelectedDetail] = useState(
    initialResults?.[initialSelectedIndex ?? 0]?.detail ??
      "Type a title and press Enter to search.",
  );
  const [resultSubtitle, setResultSubtitle] = useState(
    initialResultSubtitle ?? `Provider ${provider}  ·  Enter searches  ·  / commands`,
  );
  const [searchState, setSearchState] = useState<"idle" | "loading" | "ready" | "error">(
    initialResults && initialResults.length > 0 ? "ready" : "idle",
  );
  const [lastSearchedQuery, setLastSearchedQuery] = useState(
    initialResults && initialResults.length > 0 ? (initialQuery ?? "") : "",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [emptyMessage, setEmptyMessage] = useState("Type a title and press Enter to search.");
  const requestIdRef = useRef(0);

  const clearResults = (nextProvider = activeProvider) => {
    setOptions([]);
    setSelectedIndex(0);
    setSearchState("idle");
    setLastSearchedQuery("");
    setErrorMessage(null);
    setEmptyMessage("Type a title and press Enter to search.");
    setResultSubtitle(`Provider ${nextProvider}  ·  Enter searches  ·  / commands`);
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

  const openInfoOverlay = async ({
    type,
    title,
    subtitle,
    loader,
  }: {
    type: "help" | "about" | "diagnostics" | "history";
    title: string;
    subtitle: string;
    loader?: () => Promise<readonly ShellPanelLine[]>;
  }) => {
    setCommandMode(false);
    setActiveOverlay({
      type,
      title,
      subtitle,
      lines: [],
      loading: true,
      scrollIndex: 0,
    });

    try {
      const lines = loader ? await loader() : [];
      setActiveOverlay({
        type,
        title,
        subtitle,
        lines,
        loading: false,
        scrollIndex: 0,
      });
    } catch (error) {
      setActiveOverlay({
        type,
        title,
        subtitle,
        lines: [
          {
            label: "Unable to load this panel",
            detail: String(error),
            tone: "error",
          },
        ],
        loading: false,
        scrollIndex: 0,
      });
    }
  };

  const openProviderOverlay = () => {
    setCommandMode(false);
    setActiveOverlay({
      type: "provider",
      title: "Provider",
      subtitle: `Current provider ${activeProvider}`,
      options: providerOptions ?? [],
      filterQuery: "",
      selectedIndex: 0,
      busy: false,
    });
  };

  const openSettingsOverlay = (nextDraft: KitsuneConfig, selectedIndex = 0) => {
    setCommandMode(false);
    const dirty = !settingsEqual(nextDraft, appliedSettings);
    setDraftSettings(nextDraft);
    setActiveOverlay({
      type: "settings",
      title: "Settings",
      subtitle: buildSettingsSummary(nextDraft),
      options: buildSettingsOptions(nextDraft, dirty),
      filterQuery: "",
      selectedIndex,
      dirty,
      busy: false,
    });
  };

  const openSettingsChoiceOverlay = (
    nextDraft: KitsuneConfig,
    setting: SettingsChoiceValue,
    parentSelectedIndex = 0,
  ) => {
    let title = "Choose setting";
    let subtitle = "Select a value";
    let options: readonly ShellPickerOption<string>[] = [];

    if (setting === "defaultMode") {
      title = "Default startup mode";
      subtitle = `Current ${nextDraft.defaultMode}`;
      options = [
        { value: "series", label: "Series mode", detail: "Browse movies and TV on launch" },
        { value: "anime", label: "Anime mode", detail: "Browse anime on launch" },
      ].map((option) => ({
        ...option,
        label:
          option.value === nextDraft.defaultMode ? `${option.label}  ·  current` : option.label,
      }));
    } else if (setting === "provider") {
      title = "Default provider";
      subtitle = `Current ${nextDraft.provider}`;
      options = (settingsSeriesProviderOptions ?? []).map((option) => ({
        ...option,
        label:
          option.value === nextDraft.provider
            ? `${option.label.replace(/  ·  current$/, "")}  ·  current`
            : option.label.replace(/  ·  current$/, ""),
      }));
    } else if (setting === "animeProvider") {
      title = "Anime provider";
      subtitle = `Current ${nextDraft.animeProvider}`;
      options = (settingsAnimeProviderOptions ?? []).map((option) => ({
        ...option,
        label:
          option.value === nextDraft.animeProvider
            ? `${option.label.replace(/  ·  current$/, "")}  ·  current`
            : option.label.replace(/  ·  current$/, ""),
      }));
    } else if (setting === "subLang") {
      title = "Subtitle preference";
      subtitle = `Current ${nextDraft.subLang}`;
      options = SUBTITLE_SETTINGS_OPTIONS.map((option) => ({
        ...option,
        label: option.value === nextDraft.subLang ? `${option.label}  ·  current` : option.label,
      }));
    } else if (setting === "animeLang") {
      title = "Anime audio";
      subtitle = `Current ${nextDraft.animeLang}`;
      options = ANIME_AUDIO_SETTINGS_OPTIONS.map((option) => ({
        ...option,
        label: option.value === nextDraft.animeLang ? `${option.label}  ·  current` : option.label,
      })) as readonly ShellPickerOption<string>[];
    } else if (setting === "footerHints") {
      title = "Footer hint density";
      subtitle = `Current ${nextDraft.footerHints}`;
      options = FOOTER_HINT_OPTIONS.map((option) => ({
        ...option,
        label:
          option.value === nextDraft.footerHints ? `${option.label}  ·  current` : option.label,
      })) as readonly ShellPickerOption<string>[];
    }

    setActiveOverlay({
      type: "settings-choice",
      title,
      subtitle,
      setting,
      options,
      filterQuery: "",
      selectedIndex: 0,
      parentSelectedIndex,
      busy: false,
    });
  };

  const handleLocalAction = (action: ShellAction): boolean => {
    if (action === "settings" && appliedSettings && onSaveSettings) {
      openSettingsOverlay(appliedSettings);
      return true;
    }
    if (action === "provider" && providerOptions && onChangeProvider) {
      openProviderOverlay();
      return true;
    }
    if (action === "history" && loadHistoryPanel) {
      void openInfoOverlay({
        type: "history",
        title: "History",
        subtitle: "Recent playback positions without leaving browse",
        loader: loadHistoryPanel,
      });
      return true;
    }
    if (action === "diagnostics" && loadDiagnosticsPanel) {
      void openInfoOverlay({
        type: "diagnostics",
        title: "Diagnostics",
        subtitle: "Current runtime snapshot and recent events",
        loader: loadDiagnosticsPanel,
      });
      return true;
    }
    if (action === "help" && loadHelpPanel) {
      void openInfoOverlay({
        type: "help",
        title: "Help",
        subtitle: "Commands, editing, filtering, and shell behavior",
        loader: loadHelpPanel,
      });
      return true;
    }
    if (action === "about" && loadAboutPanel) {
      void openInfoOverlay({
        type: "about",
        title: "About",
        subtitle: "KitsuneSnipe beta",
        loader: loadAboutPanel,
      });
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
  const previewWidth = wideBrowse ? Math.max(36, Math.floor(innerWidth * 0.4)) : innerWidth;
  const listWidth = wideBrowse ? Math.max(42, innerWidth - previewWidth - 3) : innerWidth;
  const rowWidth = Math.max(20, listWidth - 4);
  const windowStart = getWindowStart(selectedIndex, options.length, maxVisible);
  const windowEnd = Math.min(windowStart + maxVisible, options.length);
  const visibleOptions = options.slice(windowStart, windowEnd);
  const filteredOverlayOptions =
    activeOverlay &&
    (activeOverlay.type === "provider" ||
      activeOverlay.type === "settings" ||
      activeOverlay.type === "settings-choice")
      ? activeOverlay.options.filter((option) => {
          const filter = activeOverlay.filterQuery.trim().toLowerCase();
          if (filter.length === 0) return true;
          return `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(filter);
        })
      : [];
  const previewMeta = selectedOption?.previewMeta ?? [];
  const previewBodyLines = wrapText(
    selectedOption?.previewBody ?? "Type a title and press Enter to search.",
    Math.max(previewWidth - 2, 24),
    ultraCompact ? 1 : compact ? 2 : 3,
  );

  useInput((input, key) => {
    if (input === "\x03") {
      if (process.stdin.isTTY) process.stdin.unref();
      process.exit(0);
    }

    if (activeOverlay) {
      if (input === "/") {
        setCommandMode(true);
        setCommandInput("");
        setHighlightedCommandIndex(0);
        return;
      }

      if (key.escape) {
        if (activeOverlay.type === "settings-choice" && draftSettings) {
          openSettingsOverlay(draftSettings);
          return;
        }
        closeOverlay();
        return;
      }

      if (
        activeOverlay.type === "provider" ||
        activeOverlay.type === "settings" ||
        activeOverlay.type === "settings-choice"
      ) {
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
          const options = filteredOverlayOptions;
          const target = options[activeOverlay.selectedIndex];
          if (!target) return;

          if (activeOverlay.type === "provider") {
            if (!onChangeProvider) return;
            setActiveOverlay({ ...activeOverlay, busy: true });
            void onChangeProvider(target.value)
              .then(() => {
                setActiveProvider(target.value);
                setActiveOverlay(null);
                clearResults(target.value);
              })
              .catch((error) => {
                setActiveOverlay({
                  ...activeOverlay,
                  busy: false,
                  subtitle: `Failed to switch provider: ${String(error)}`,
                });
              });
            return;
          }

          if (activeOverlay.type === "settings") {
            if (!draftSettings) return;
            const action = target.value;
            if (action === "__discard") {
              setDraftSettings(null);
              setActiveOverlay(null);
              return;
            }
            if (action === "__save") {
              if (!onSaveSettings) {
                setDraftSettings(null);
                setActiveOverlay(null);
                return;
              }
              setActiveOverlay({ ...activeOverlay, busy: true });
              void onSaveSettings(draftSettings)
                .then(() => {
                  setAppliedSettings(draftSettings);
                  setDraftSettings(null);
                  setActiveOverlay(null);
                })
                .catch((error) => {
                  setActiveOverlay({
                    ...activeOverlay,
                    busy: false,
                    subtitle: `Failed to save settings: ${String(error)}`,
                  });
                });
              return;
            }
            if (action === "headless") {
              openSettingsOverlay(
                { ...draftSettings, headless: !draftSettings.headless },
                activeOverlay.selectedIndex,
              );
              return;
            }
            if (action === "showMemory") {
              openSettingsOverlay(
                { ...draftSettings, showMemory: !draftSettings.showMemory },
                activeOverlay.selectedIndex,
              );
              return;
            }
            if (action === "autoNext") {
              openSettingsOverlay(
                { ...draftSettings, autoNext: !draftSettings.autoNext },
                activeOverlay.selectedIndex,
              );
              return;
            }
            openSettingsChoiceOverlay(
              draftSettings,
              action as SettingsChoiceValue,
              activeOverlay.selectedIndex,
            );
            return;
          }

          if (!draftSettings) return;
          const updatedDraft = { ...draftSettings };
          if (activeOverlay.setting === "defaultMode") {
            updatedDraft.defaultMode = target.value as "series" | "anime";
          } else if (activeOverlay.setting === "provider") {
            updatedDraft.provider = target.value;
          } else if (activeOverlay.setting === "animeProvider") {
            updatedDraft.animeProvider = target.value;
          } else if (activeOverlay.setting === "subLang") {
            updatedDraft.subLang = target.value;
          } else if (activeOverlay.setting === "animeLang") {
            updatedDraft.animeLang = target.value as "sub" | "dub";
          } else if (activeOverlay.setting === "footerHints") {
            updatedDraft.footerHints = target.value as "detailed" | "minimal";
          }
          openSettingsOverlay(updatedDraft, activeOverlay.parentSelectedIndex ?? 0);
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

      if (
        (key.upArrow || key.downArrow) &&
        !activeOverlay.loading &&
        activeOverlay.lines.length > 0
      ) {
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
    <Box flexDirection="column" paddingX={1}>
      <Box
        borderStyle="round"
        borderColor={palette.gray}
        flexDirection="column"
        paddingX={1}
        paddingY={0}
      >
        <Text color={palette.amber}>{APP_LABEL}</Text>
        <Box marginTop={1} justifyContent="space-between">
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
        {!ultraCompact ? <Text color={palette.muted}>{resultSubtitle}</Text> : null}
        <Box marginTop={1}>
          <Badge label={`provider ${activeProvider}`} tone="info" />
          {!ultraCompact ? <Badge label={mode === "anime" ? "anime mode" : "series mode"} /> : null}
          {activeOverlay ? (
            <Badge label={`${activeOverlay.title.toLowerCase()} panel`} tone="success" />
          ) : null}
        </Box>

        <Box marginTop={1}>
          <Text color={palette.cyan}>› </Text>
          <TextInput
            value={query}
            onChange={updateQuery}
            onSubmit={handleQuerySubmit}
            placeholder={placeholder}
            focus={!commandMode}
            showCursor
          />
        </Box>

        {queryDirty && options.length > 0 && !ultraCompact ? (
          <Text color={palette.gray}>Query changed · Press Enter to refresh results</Text>
        ) : null}

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
          <OverlayPanel
            overlay={
              activeOverlay.type === "provider"
                ? {
                    ...activeOverlay,
                    options: filteredOverlayOptions,
                    selectedIndex: Math.min(
                      activeOverlay.selectedIndex,
                      Math.max(filteredOverlayOptions.length - 1, 0),
                    ),
                  }
                : activeOverlay
            }
            width={innerWidth}
          />
        ) : options.length > 0 ? (
          <Box
            flexDirection={wideBrowse ? "row" : "column"}
            marginTop={1}
            justifyContent="space-between"
          >
            <Box flexDirection="column" width={wideBrowse ? listWidth : undefined}>
              {windowStart > 0 ? <Text color={palette.gray}> ▲ ...</Text> : null}
              {visibleOptions.map((option, index) => {
                const optionIndex = windowStart + index;
                const selected = optionIndex === selectedIndex;
                const secondary = option.detail ? `  ${truncateLine(option.detail, rowWidth)}` : "";
                const rowText = truncateLine(`${option.label}${secondary}`, rowWidth);

                return (
                  <Box key={optionIndex}>
                    <Text
                      backgroundColor={selected ? palette.cyan : undefined}
                      color={selected ? "black" : "white"}
                      bold={selected}
                      dimColor={!selected}
                    >
                      <Text color={selected ? "black" : palette.gray}>
                        {selected ? "❯ " : "  "}
                      </Text>
                      {rowText}
                    </Text>
                  </Box>
                );
              })}
              {windowEnd < options.length ? <Text color={palette.gray}> ▼ ...</Text> : null}
            </Box>

            <Box
              marginTop={wideBrowse ? 0 : 1}
              marginLeft={wideBrowse ? 1 : 0}
              flexDirection="column"
              borderStyle="round"
              borderColor={palette.green}
              paddingX={1}
              width={wideBrowse ? previewWidth : undefined}
            >
              <Text color={palette.green}>Selection Preview</Text>
              <Text bold color="white">
                {truncateLine(
                  selectedOption?.previewTitle ?? selectedOption?.label ?? "No selection yet",
                  previewWidth,
                )}
              </Text>
              {previewMeta.length > 0 && !ultraCompact ? (
                <Box marginTop={1}>
                  {previewMeta.slice(0, compact ? 2 : previewMeta.length).map((item, index) => (
                    <Badge
                      key={`${item}-${index}`}
                      label={item}
                      tone={index === 0 ? "info" : "neutral"}
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
        taskLabel={
          options.length > 0 && !queryDirty
            ? "Browse results and open a title"
            : `Search ${mode === "anime" ? "anime titles" : "movies and series"}`
        }
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
          { key: "/", label: "commands", action: "search" },
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
  const session = mountShell<BrowseShellResult<T>>({
    renderShell: (finish) => (
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
