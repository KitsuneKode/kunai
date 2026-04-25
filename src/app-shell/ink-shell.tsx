import React, { useEffect, useRef, useState } from "react";
import { Box, Text, render, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";

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
  type ShellAction,
  type ShellStatus,
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

function Footer({ actions }: { actions: readonly FooterAction[] }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box borderStyle="round" borderColor={palette.gray} paddingX={1}>
        {actions.map((action, index) => (
          <Box
            key={`${action.key}-${action.label}`}
            marginRight={index === actions.length - 1 ? 0 : 2}
          >
            <Text color={action.disabled ? palette.gray : palette.cyan}>
              {hotkeyLabel(action.key)}
            </Text>
            <Text color={action.disabled ? palette.gray : "white"}> {action.label}</Text>
          </Box>
        ))}
      </Box>
      {actions.some((action) => action.disabled && action.reason) ? (
        <Box marginTop={1}>
          <Text color={palette.gray}>
            {actions
              .filter((action) => action.disabled && action.reason)
              .map((action) => `${action.label}: ${action.reason}`)
              .join("  ·  ")}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
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
  footerActions,
  commands,
  onResolve,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  status?: ShellStatus;
  footerActions: readonly FooterAction[];
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

      <Footer actions={footerActions} />
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
      label: state.mode === "anime" ? "series mode" : "anime mode",
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
      footerActions={footerActions}
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
  onResolve,
}: {
  state: PlaybackShellState;
  onResolve: (action: ShellAction) => void;
}) {
  const commands =
    state.commands ??
    fallbackCommandState([
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
    footerActionFromCommand(commands, "settings", { key: "c", label: "settings" }),
    footerActionFromCommand(commands, "toggle-mode", { key: "a", label: "switch mode" }),
    footerActionFromCommand(commands, "provider", { key: "o", label: "provider" }),
    footerActionFromCommand(commands, "history", { key: "h", label: "history" }),
    footerActionFromCommand(commands, "diagnostics", { key: "d", label: "diagnostics" }),
    footerActionFromCommand(commands, "quit", { key: "q", label: "quit" }),
    footerActionFromCommand(commands, "pick-episode", { key: "e", label: "episodes" }),
    footerActionFromCommand(commands, "next", { key: "n", label: "next" }),
    footerActionFromCommand(commands, "previous", { key: "p", label: "previous" }),
    footerActionFromCommand(commands, "next-season", { key: "s", label: "next season" }),
  ];

  const location =
    state.type === "series"
      ? `S${String(state.season).padStart(2, "0")}E${String(state.episode).padStart(2, "0")}`
      : "Movie";

  useInput((_input, key) => {
    if (key.return) {
      onResolve("replay");
    }
  });

  return (
    <ShellFrame
      eyebrow={APP_LABEL}
      title={state.title}
      subtitle={`${location}  ·  Provider ${state.provider}  ·  Mode ${state.mode}`}
      status={state.status}
      footerActions={footerActions}
      commands={commands}
      onResolve={onResolve}
    >
      <Text color={palette.muted}>
        Playback controls stay visible and command-driven. Use `/` for direct actions without
        leaving the shell.
      </Text>
      {state.showMemory && state.memoryUsage ? (
        <Box marginTop={1}>
          <Text color={palette.gray}>{state.memoryUsage}</Text>
        </Box>
      ) : null}
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

export function openPlaybackShell(state: PlaybackShellState): Promise<ShellAction> {
  return openShell({ Component: PlaybackShell, props: { state } });
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
      const finishWithLog = (value: string | null) => {
        // #region agent log
        fetch("http://127.0.0.1:7354/ingest/f23bf8ed-06ee-406a-91ac-a87f92e34e82", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Debug-Session-Id": "d7fbe5",
          },
          body: JSON.stringify({
            sessionId: "d7fbe5",
            location: "ink-shell.tsx:openSearchShell.finish",
            message: "search finish",
            data: { hasValue: value !== null, len: value?.length ?? 0 },
            timestamp: Date.now(),
            hypothesisId: "D",
          }),
        }).catch(() => {});
        // #endregion
        finish(value);
      };

      return (
        <SearchShell
          mode={mode}
          provider={provider}
          initialValue={initialValue}
          placeholder={placeholder}
          onSubmit={(value) => finishWithLog(value.length > 0 ? value : null)}
          onCancel={() => finishWithLog(null)}
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

function truncateLine(value: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (value.length <= maxLength) return value;
  if (maxLength <= 1) return "…";
  return `${value.slice(0, maxLength - 1)}…`;
}

function deleteLastWord(value: string): string {
  return value.replace(/\s*\S+\s*$/, "");
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
  onSubmit,
  onCancel,
}: {
  title: string;
  subtitle: string;
  options: readonly ListOption<T>[];
  onSubmit: (value: T) => void;
  onCancel: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
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

  const selectedOption = filteredOptions[index];

  // Leave room for the frame, footer, and selected-item preview.
  const maxVisible = Math.max(5, stdout.rows - 16);
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

  useInput((input, key) => {
    // Ctrl+C handling
    if (input === "\x03") {
      if (process.stdin.isTTY) process.stdin.unref();
      process.exit(0);
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
      // #region agent log
      fetch("http://127.0.0.1:7354/ingest/f23bf8ed-06ee-406a-91ac-a87f92e34e82", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Debug-Session-Id": "d7fbe5",
        },
        body: JSON.stringify({
          sessionId: "d7fbe5",
          location: "ink-shell.tsx:ListShell.useInput",
          message: "return key",
          data: {
            index,
            confirmed,
            hasSelected: Boolean(selected),
            label: selected?.label?.slice(0, 80),
          },
          timestamp: Date.now(),
          hypothesisId: "A",
        }),
      }).catch(() => {});
      // #endregion
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
        <Box marginTop={1}>
          <Text bold color="white">
            {confirmed ? "✓ Selected" : title}
          </Text>
        </Box>
        <Text color={palette.muted}>{confirmed ? selectedLabel : subtitle}</Text>
        <Box marginTop={1}>
          <Text color={palette.cyan}>filter › </Text>
          <TextInput
            value={filterQuery}
            onChange={setFilterQuery}
            placeholder="Type to narrow this list"
            showCursor
          />
        </Box>
        <Text color={palette.gray}>
          {`Selected ${filteredOptions.length > 0 ? index + 1 : 0} of ${filteredOptions.length}  ·  Showing ${filteredOptions.length} of ${options.length}  ·  Enter confirms  ·  Esc clears/back`}
        </Text>
        <Box flexDirection="column" marginTop={1}>
          {windowStart > 0 && <Text color={palette.gray}> ▲ ...</Text>}
          {visibleOptions.map((option, i) => {
            const optionIndex = windowStart + i;
            const selected = optionIndex === index;
            const isConfirmed = confirmed && selected;
            const itemPrefix = isConfirmed ? "✓" : selected ? "❯" : " ";
            const itemTone = isConfirmed ? palette.green : selected ? palette.amber : palette.gray;
            const secondary = option.detail ? `  ${truncateLine(option.detail, rowWidth)}` : "";
            const rowText = truncateLine(`${option.label}${secondary}`, rowWidth);
            return (
              <Box key={optionIndex} marginBottom={i === visibleOptions.length - 1 ? 0 : 0}>
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
        <Box
          marginTop={1}
          flexDirection="column"
          borderStyle="round"
          borderColor={palette.cyan}
          paddingX={1}
        >
          <Text color={palette.cyan}>Current Selection</Text>
          <Text bold color="white">
            {truncateLine(selectedLabel, innerWidth)}
          </Text>
          <Text color={palette.muted}>{truncateLine(selectedDetail, innerWidth * 2)}</Text>
        </Box>
      </Box>
      <Footer
        actions={[
          { key: "type", label: "filter", action: "search" },
          { key: "↑↓", label: "navigate", action: "search" },
          { key: "enter", label: "select", action: "search" },
          { key: "esc", label: "clear/back", action: "quit" },
        ]}
      />
    </Box>
  );
}

function BrowseShell<T>({
  mode,
  provider,
  initialQuery,
  placeholder,
  commands,
  onSearch,
  onResolve,
  onSubmit,
  onCancel,
}: {
  mode: "series" | "anime";
  provider: string;
  initialQuery?: string;
  placeholder: string;
  commands: readonly ResolvedAppCommand[];
  onSearch: (query: string) => Promise<BrowseShellSearchResponse<T>>;
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
  const [options, setOptions] = useState<readonly BrowseShellOption<T>[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedDetail, setSelectedDetail] = useState("Type a title and press Enter to search.");
  const [resultSubtitle, setResultSubtitle] = useState(
    `Provider ${provider}  ·  Enter searches  ·  / commands`,
  );
  const [searchState, setSearchState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [lastSearchedQuery, setLastSearchedQuery] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [emptyMessage, setEmptyMessage] = useState("Type a title and press Enter to search.");
  const requestIdRef = useRef(0);

  const clearResults = () => {
    setOptions([]);
    setSelectedIndex(0);
    setSearchState("idle");
    setLastSearchedQuery("");
    setErrorMessage(null);
    setEmptyMessage("Type a title and press Enter to search.");
    setResultSubtitle(`Provider ${provider}  ·  Enter searches  ·  / commands`);
    setSelectedDetail("Type a title and press Enter to search.");
  };

  const updateQuery = (nextValue: string) => {
    setQuery(nextValue);
    if (nextValue.trim().length === 0) {
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

  useEffect(() => {
    const option = options[selectedIndex];
    if (!option) return;
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
  const maxVisible = Math.max(5, stdout.rows - 18);
  const innerWidth = Math.max(24, stdout.columns - 8);
  const rowWidth = Math.max(20, innerWidth - 4);
  const windowStart = getWindowStart(selectedIndex, options.length, maxVisible);
  const windowEnd = Math.min(windowStart + maxVisible, options.length);
  const visibleOptions = options.slice(windowStart, windowEnd);

  useInput((input, key) => {
    if (input === "\x03") {
      if (process.stdin.isTTY) process.stdin.unref();
      process.exit(0);
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
          onResolve(toShellAction(resolved.id));
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

    if (input === "/" && query.length === 0) {
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
          <Text bold color="white">
            {mode === "anime" ? "Browse anime" : "Browse titles"}
          </Text>
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
        <Text color={palette.muted}>{resultSubtitle}</Text>

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

        {queryDirty && options.length > 0 ? (
          <Text color={palette.gray}>Query changed · Press Enter to refresh results</Text>
        ) : null}

        {searchState === "error" && errorMessage ? (
          <Box marginTop={1}>
            <Text color={palette.red}>{errorMessage}</Text>
          </Box>
        ) : null}

        {options.length > 0 ? (
          <Box flexDirection="column" marginTop={1}>
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
                    <Text color={selected ? "black" : palette.gray}>{selected ? "❯ " : "  "}</Text>
                    {rowText}
                  </Text>
                </Box>
              );
            })}
            {windowEnd < options.length ? <Text color={palette.gray}> ▼ ...</Text> : null}
          </Box>
        ) : (
          <Box marginTop={1}>
            <Text color={palette.gray}>{emptyMessage}</Text>
          </Box>
        )}

        <Box
          marginTop={1}
          flexDirection="column"
          borderStyle="round"
          borderColor={palette.cyan}
          paddingX={1}
        >
          <Text color={palette.cyan}>Current Selection</Text>
          <Text bold color="white">
            {truncateLine(selectedOption?.label ?? "No selection yet", innerWidth)}
          </Text>
          <Text color={palette.muted}>
            {truncateLine(selectedDetail, Math.max(innerWidth, 48))}
          </Text>
        </Box>
      </Box>

      {commandMode ? (
        <CommandPalette
          input={commandInput}
          commands={commands}
          highlightedIndex={highlightedCommandIndex}
        />
      ) : null}

      <Footer
        actions={[
          {
            key: "enter",
            label: options.length > 0 && !queryDirty ? "select" : "search",
            action: "search",
          },
          { key: "↑↓", label: "navigate", action: "search" },
          { key: "tab", label: "switch mode", action: "toggle-mode" },
          { key: "/", label: "commands when empty", action: "search" },
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
  placeholder,
  commands,
  onSearch,
}: {
  mode: "series" | "anime";
  provider: string;
  initialQuery?: string;
  placeholder: string;
  commands: readonly ResolvedAppCommand[];
  onSearch: (query: string) => Promise<BrowseShellSearchResponse<T>>;
}): Promise<BrowseShellResult<T>> {
  const session = mountShell<BrowseShellResult<T>>({
    renderShell: (finish) => (
      <BrowseShell
        mode={mode}
        provider={provider}
        initialQuery={initialQuery}
        placeholder={placeholder}
        commands={commands}
        onSearch={onSearch}
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
}: {
  title: string;
  subtitle: string;
  options: readonly ListOption<T>[];
}): Promise<T | null> {
  // #region agent log
  fetch("http://127.0.0.1:7354/ingest/f23bf8ed-06ee-406a-91ac-a87f92e34e82", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "d7fbe5",
    },
    body: JSON.stringify({
      sessionId: "d7fbe5",
      location: "ink-shell.tsx:openListShell",
      message: "openListShell invoked",
      data: { title, optionCount: options.length },
      timestamp: Date.now(),
      hypothesisId: "E",
    }),
  }).catch(() => {});
  // #endregion

  const session = mountShell<T | null>({
    renderShell: (finish) => {
      const finishWithLog = (value: T | null) => {
        // #region agent log
        fetch("http://127.0.0.1:7354/ingest/f23bf8ed-06ee-406a-91ac-a87f92e34e82", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Debug-Session-Id": "d7fbe5",
          },
          body: JSON.stringify({
            sessionId: "d7fbe5",
            location: "ink-shell.tsx:openListShell.finish",
            message: "finish called",
            data: {
              hasValue: value !== null,
              title,
              optionCount: options.length,
            },
            timestamp: Date.now(),
            hypothesisId: "B",
          }),
        }).catch(() => {});
        // #endregion
        finish(value);
      };

      return (
        <ListShell
          title={title}
          subtitle={subtitle}
          options={options}
          onSubmit={(value) => finishWithLog(value)}
          onCancel={() => finishWithLog(null)}
        />
      );
    },
    fallbackValue: null,
  });

  void session.result.finally(() => {
    // #region agent log
    fetch("http://127.0.0.1:7354/ingest/f23bf8ed-06ee-406a-91ac-a87f92e34e82", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "d7fbe5",
      },
      body: JSON.stringify({
        sessionId: "d7fbe5",
        location: "ink-shell.tsx:openListShell.waitUntilExit",
        message: "waitUntilExit resolved",
        data: { title },
        timestamp: Date.now(),
        hypothesisId: "C",
      }),
    }).catch(() => {});
    // #endregion
  });

  return session.result;
}

export function formatMemoryUsage(): string {
  const memory = process.memoryUsage();
  const toMb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `Mem  RSS ${toMb(memory.rss)}  ·  Heap ${toMb(memory.heapUsed)}/${toMb(memory.heapTotal)}`;
}
