import React, { useState, useEffect } from "react";
import { Box, Text, render, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";

import { parseCommand, suggestCommands, type AppCommandId } from "./commands";
import {
  toShellAction,
  type FooterAction,
  type HomeShellState,
  type PlaybackShellState,
  type ShellAction,
  type ShellStatus,
} from "./types";

const palette = {
  amber: "#d4a44c",
  cyan: "#78dce8",
  green: "#8dd694",
  red: "#ff8b8b",
  gray: "#7c7f8a",
  muted: "#a6acb9",
};

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
            <Text color={action.disabled ? palette.gray : "white"}>
              {" "}
              {action.label}
            </Text>
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

function CommandPalette({
  input,
  allowed,
}: {
  input: string;
  allowed: readonly AppCommandId[];
}) {
  const matches = suggestCommands(input, allowed).slice(0, 4);

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
      <Box flexDirection="column" marginTop={1}>
        {matches.length > 0 ? (
          matches.map((command) => (
            <Text key={command.id} color={palette.muted}>
              /{command.aliases[0]} {command.description}
            </Text>
          ))
        ) : (
          <Text color={palette.gray}>No matching commands</Text>
        )}
      </Box>
    </Box>
  );
}

function useShellInput({
  footerActions,
  commandSet,
  onResolve,
}: {
  footerActions: readonly FooterAction[];
  commandSet: readonly AppCommandId[];
  onResolve: (action: ShellAction) => void;
}) {
  const [commandMode, setCommandMode] = useState(false);
  const [commandInput, setCommandInput] = useState("");

  useInput((input, key) => {
    if (key.escape) {
      if (commandMode) {
        setCommandMode(false);
        setCommandInput("");
        return;
      }
      onResolve("quit");
      return;
    }

    if (commandMode) {
      if (key.return) {
        const command = parseCommand(commandInput);
        if (command && commandSet.includes(command.id)) {
          onResolve(toShellAction(command.id));
          return;
        }
        setCommandInput("");
        setCommandMode(false);
        return;
      }
      if (key.backspace || key.delete) {
        setCommandInput((current) => current.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setCommandInput((current) => current + input);
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

  return { commandMode, commandInput };
}

function ShellFrame({
  eyebrow,
  title,
  subtitle,
  status,
  footerActions,
  commandSet,
  onResolve,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  status?: ShellStatus;
  footerActions: readonly FooterAction[];
  commandSet: readonly AppCommandId[];
  onResolve: (action: ShellAction) => void;
  children: React.ReactNode;
}) {
  const { commandMode, commandInput } = useShellInput({
    footerActions,
    commandSet,
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
          {status ? (
            <Text color={statusColor(status.tone)}>{status.label}</Text>
          ) : null}
        </Box>
        <Text color={palette.muted}>{subtitle}</Text>
        <Box marginTop={1} flexDirection="column">
          {children}
        </Box>
      </Box>

      {commandMode ? (
        <CommandPalette input={commandInput} allowed={commandSet} />
      ) : null}

      <Footer actions={footerActions} />
    </Box>
  );
}

function HomeShell({
  state,
  onResolve,
}: {
  state: HomeShellState;
  onResolve: (action: ShellAction) => void;
}) {
  const footerActions: readonly FooterAction[] = [
    { key: "/", label: "commands", action: "search" },
    { key: "enter", label: "search", action: "search" },
    { key: "c", label: "settings", action: "settings" },
    {
      key: "a",
      label: state.mode === "anime" ? "series mode" : "anime mode",
      action: "toggle-mode",
    },
    { key: "q", label: "quit", action: "quit" },
  ];

  const commandSet: readonly AppCommandId[] = [
    "search",
    "settings",
    "toggle-mode",
    "quit",
  ];

  useInput((_input, key) => {
    if (key.return) onResolve("search");
  });

  return (
    <ShellFrame
      eyebrow="KitsuneSnipe"
      title="Fast stream search without prompt spaghetti"
      subtitle={`Mode ${state.mode}  ·  Provider ${state.provider}  ·  Subs ${
        state.subtitle
      }${state.mode === "anime" ? `  ·  Audio ${state.animeLang}` : ""}`}
      status={state.status}
      footerActions={footerActions}
      commandSet={commandSet}
      onResolve={onResolve}
    >
      <Text color={palette.muted}>
        Press Enter to search, or use `/` for commands. Settings and mode switch
        stay reachable before the first query.
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
  const footerActions: readonly FooterAction[] = [
    { key: "/", label: "commands", action: "replay" },
    { key: "r", label: "replay", action: "replay" },
    { key: "c", label: "settings", action: "settings" },
    { key: "a", label: "switch mode", action: "toggle-mode" },
    { key: "o", label: "provider", action: "provider" },
    { key: "q", label: "quit", action: "quit" },
    {
      key: "n",
      label: "next",
      action: "next",
      disabled: state.type !== "series",
      reason: "only available for series",
    },
    {
      key: "p",
      label: "previous",
      action: "previous",
      disabled: state.type !== "series" || state.episode <= 1,
      reason:
        state.type !== "series"
          ? "only available for series"
          : "already at episode 1",
    },
    {
      key: "s",
      label: "next season",
      action: "next-season",
      disabled: state.type !== "series",
      reason: "only available for series",
    },
  ];

  const commandSet: readonly AppCommandId[] = [
    "settings",
    "toggle-mode",
    "quit",
    "provider",
    "replay",
    "next",
    "previous",
    "next-season",
  ];

  const location =
    state.type === "series"
      ? `S${String(state.season).padStart(2, "0")}E${String(
          state.episode,
        ).padStart(2, "0")}`
      : "Movie";

  return (
    <ShellFrame
      eyebrow="KitsuneSnipe"
      title={state.title}
      subtitle={`${location}  ·  Provider ${state.provider}  ·  Mode ${state.mode}`}
      status={state.status}
      footerActions={footerActions}
      commandSet={commandSet}
      onResolve={onResolve}
    >
      <Text color={palette.muted}>
        Playback controls stay visible and command-driven. Use `/` for direct
        actions without leaving the shell.
      </Text>
      {state.showMemory && state.memoryUsage ? (
        <Box marginTop={1}>
          <Text color={palette.gray}>{state.memoryUsage}</Text>
        </Box>
      ) : null}
    </ShellFrame>
  );
}

function openShell<TProps>({
  Component,
  props,
}: {
  Component: React.ComponentType<
    TProps & { onResolve: (action: ShellAction) => void }
  >;
  props: TProps;
}): Promise<ShellAction> {
  if (process.stdin.isTTY) process.stdin.ref();
  return new Promise((resolve) => {
    let settled = false;
    const onResolve = (action: ShellAction) => {
      if (settled) return;
      settled = true;
      ink.unmount();
      resolve(action);
    };

    const ink = render(<Component {...props} onResolve={onResolve} />);
    ink.waitUntilExit().then(() => {
      if (!settled) resolve("quit");
    });
  });
}

export function openHomeShell(state: HomeShellState): Promise<ShellAction> {
  return openShell({ Component: HomeShell, props: { state } });
}

export function openPlaybackShell(
  state: PlaybackShellState,
): Promise<ShellAction> {
  return openShell({ Component: PlaybackShell, props: { state } });
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

  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box
        borderStyle="round"
        borderColor={palette.gray}
        flexDirection="column"
        paddingX={1}
      >
        <Text color={palette.amber}>KitsuneSnipe</Text>
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
          <TextInput
            value={value}
            onChange={setValue}
            placeholder={placeholder}
            onSubmit={(next) => onSubmit(next.trim())}
          />
        </Box>
      </Box>
    </Box>
  );
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
  if (process.stdin.isTTY) process.stdin.ref();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      ink.unmount();
      resolve(value);
    };

    const ink = render(
      <SearchShell
        mode={mode}
        provider={provider}
        initialValue={initialValue}
        placeholder={placeholder}
        onSubmit={(value) => finish(value.length > 0 ? value : null)}
        onCancel={() => finish(null)}
      />,
    );

    ink.waitUntilExit().then(() => {
      if (!settled) resolve(null);
    });
  });
}

type ListOption<T> = {
  value: T;
  label: string;
  detail?: string;
};

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

  useInput((input, key) => {
    if (key.escape || input === "q") {
      onCancel();
      return;
    }
    if (key.return) {
      const selected = options[index];
      if (selected) onSubmit(selected.value);
      return;
    }
    if (key.upArrow || input === "k") {
      setIndex((current) => (current - 1 + options.length) % options.length);
      return;
    }
    if (key.downArrow || input === "j") {
      setIndex((current) => (current + 1) % options.length);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box
        borderStyle="round"
        borderColor={palette.gray}
        flexDirection="column"
        paddingX={1}
      >
        <Text color={palette.amber}>KitsuneSnipe</Text>
        <Box marginTop={1}>
          <Text bold color="white">
            {title}
          </Text>
        </Box>
        <Text color={palette.muted}>{subtitle}</Text>
        <Box flexDirection="column" marginTop={1}>
          {options.map((option, optionIndex) => {
            const selected = optionIndex === index;
            return (
              <Box
                key={optionIndex}
                flexDirection="column"
                marginBottom={optionIndex === options.length - 1 ? 0 : 1}
              >
                <Text color={selected ? palette.cyan : "white"}>
                  {selected ? "› " : "  "}
                  {option.label}
                </Text>
                {option.detail ? (
                  <Text color={palette.gray}>
                    {selected ? "  " : "  "}
                    {option.detail}
                  </Text>
                ) : null}
              </Box>
            );
          })}
        </Box>
      </Box>
      <Footer
        actions={[
          { key: "↑↓", label: "navigate", action: "search" },
          { key: "enter", label: "select", action: "search" },
          { key: "q", label: "cancel", action: "quit" },
        ]}
      />
    </Box>
  );
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
  if (process.stdin.isTTY) process.stdin.ref();

  return new Promise((resolve) => {
    let resolved = false;

    const finish = (value: T | null) => {
      if (resolved) return;
      resolved = true;
      ink.unmount();
      resolve(value);
    };

    const ink = render(
      <ListShell
        title={title}
        subtitle={subtitle}
        options={options}
        onSubmit={(value) => finish(value)}
        onCancel={() => finish(null)}
      />,
    );

    // Fallback: resolve to null (cancel) if shell exits without explicit selection
    ink.waitUntilExit().then(() => {
      if (!resolved) finish(null);
    });
  });
}

export function formatMemoryUsage(): string {
  const memory = process.memoryUsage();
  const toMb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `Mem  RSS ${toMb(memory.rss)}  ·  Heap ${toMb(memory.heapUsed)}/${toMb(
    memory.heapTotal,
  )}`;
}
