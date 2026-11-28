import React from "react";

import { ShellFooter } from "../../shell-primitives";
import type { FooterAction } from "../../types";
import { settingsEqual } from "../settings-equal";
import type { SettingsUiState } from "../types";

function settingsFooterActions(mode: "main" | "submenu" | "reorder" | "input" | "search") {
  if (mode === "input") {
    return [
      { key: "enter", label: "save", primary: true },
      { key: "esc", label: "cancel" },
      { key: "ctrl+u", label: "clear" },
    ] satisfies readonly FooterAction[];
  }
  if (mode === "reorder") {
    return [
      { key: "↑↓", label: "select" },
      { key: "[ / ]", label: "move" },
      { key: "shift+↑↓", label: "move" },
      { key: "esc", label: "back" },
    ] satisfies readonly FooterAction[];
  }
  if (mode === "submenu") {
    return [
      { key: "↑↓", label: "select" },
      { key: "enter", label: "pick", primary: true },
      { key: "esc", label: "back" },
    ] satisfies readonly FooterAction[];
  }
  if (mode === "search") {
    return [
      { key: "enter", label: "done", primary: true },
      { key: "esc", label: "clear" },
    ] satisfies readonly FooterAction[];
  }
  return [
    { key: "tab", label: "sections" },
    { key: "space", label: "toggle" },
    { key: "enter", label: "open", primary: true },
    { key: "/", label: "search" },
    { key: "esc", label: "close" },
  ] satisfies readonly FooterAction[];
}

export const SettingsFooter = React.memo(function SettingsFooter({
  state,
  mode,
  commandMode = false,
}: {
  readonly state: SettingsUiState;
  readonly mode: "main" | "submenu" | "reorder" | "input" | "search";
  readonly commandMode?: boolean;
}) {
  const dirty = !settingsEqual(state.draft, state.snapshot);
  const actions = state.busy
    ? ([{ key: "esc", label: "cancel" }] satisfies readonly FooterAction[])
    : settingsFooterActions(mode);
  const taskLabel = state.busy
    ? "Settings · working"
    : dirty
      ? "Settings · changes apply automatically"
      : "Settings";

  return (
    <ShellFooter
      taskLabel={taskLabel}
      actions={actions}
      mode="minimal"
      commandMode={commandMode}
      companionHint={false}
    />
  );
});
