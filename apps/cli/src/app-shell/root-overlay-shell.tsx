import React, { useEffect, useState } from "react";
import { Box, useInput, useStdout } from "ink";

import type { Container } from "@/container";
import type { SessionState } from "@/domain/session/SessionState";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { useLineEditor } from "@/app-shell/line-editor";

import {
  buildAboutPanelLines,
  buildDiagnosticsPanelLines,
  buildHistoryPickerOptions,
  buildHelpPanelLines,
  buildHistoryPanelLines,
  buildProviderPickerOptions,
} from "./panel-data";
import {
  hasPendingRootHistorySelection,
  resolveRootHistorySelection,
  type RootHistorySelection,
} from "./root-history-bridge";
import {
  buildSettingsChoiceOverlay,
  buildSettingsOptions,
  buildSettingsProviderOptions,
  buildSettingsSummary,
  type BrowseOverlay,
  OverlayPanel,
  settingsEqual,
  type SettingsChoiceValue,
} from "./overlay-panel";
import { hasPendingRootPicker, resolveRootPicker } from "./root-picker-bridge";
import { type RootOwnedOverlay } from "./root-shell-state";
import { CommandPalette, useShellInput } from "./shell-command-ui";
import { InlineBadge, ShellFooter } from "./shell-primitives";
import type { FooterAction, ShellPanelLine } from "./types";
import { applySettingsToRuntime, handleShellAction } from "./workflows";
import { resolveCommands } from "./commands";

export function RootOverlayShell({
  overlay,
  state,
  container,
  onRedraw,
}: {
  overlay: RootOwnedOverlay;
  state: SessionState;
  container: Container;
  onRedraw: () => void;
}) {
  const { stdout } = useStdout();
  const maxLines = Math.max(6, Math.min(12, (stdout.rows ?? 24) - 18));
  const [scrollIndex, setScrollIndex] = useState(0);
  const [filterQuery, setFilterQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const filterEditor = useLineEditor({
    value: filterQuery,
    onChange: (nextValue) => {
      setFilterQuery(nextValue);
      setSelectedIndex(0);
    },
    onRedraw,
  });
  const [asyncLines, setAsyncLines] = useState<readonly ShellPanelLine[] | null>(null);
  const [loadingAsyncLines, setLoadingAsyncLines] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<KitsuneConfig | null>(null);
  const [settingsChoice, setSettingsChoice] = useState<SettingsChoiceValue | null>(null);
  const [settingsParentIndex, setSettingsParentIndex] = useState(0);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [historySelections, setHistorySelections] = useState<readonly RootHistorySelection[]>([]);
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
  const filteredHistoryOptions =
    overlay.type === "history"
      ? buildHistoryPickerOptions(
          historySelections
            .filter(({ entry }) => {
              const filter = filterQuery.trim().toLowerCase();
              if (filter.length === 0) return true;
              return `${entry.title} ${entry.provider} s${entry.season}e${entry.episode}`
                .toLowerCase()
                .includes(filter);
            })
            .map(({ titleId, entry }) => [titleId, entry] as const),
        )
      : [];
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
  const { commandMode, commandInput, commandCursor, highlightedIndex } = useShellInput({
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
    setHistorySelections([]);
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
        setHistorySelections(
          Object.entries(entries).map(([titleId, entry]) => ({
            titleId,
            entry,
          })),
        );
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
      if (overlay.type === "history" && hasPendingRootHistorySelection()) {
        resolveRootHistorySelection(null);
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
      } else if (overlay.type === "history") {
        const picked = filteredHistoryOptions[selectedIndex]?.value ?? null;
        const selected = historySelections.find((entry) => entry.titleId === picked) ?? null;
        resolveRootHistorySelection(selected);
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
        overlay.type === "history" ||
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
        overlay.type === "history" ||
        overlay.type === "settings" ||
        overlay.type === "season_picker" ||
        overlay.type === "episode_picker" ||
        overlay.type === "subtitle_picker"
      ) {
        const optionCount =
          overlay.type === "provider_picker"
            ? filteredProviderOptions.length
            : overlay.type === "history"
              ? filteredHistoryOptions.length
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
      overlay.type === "history" ||
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
      if (input === "/") {
        return;
      }
      if (filterEditor.handleInput(input, key)) {
        return;
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
      : overlay.type === "history"
        ? {
            type: "history-picker",
            title,
            subtitle,
            options: filteredHistoryOptions,
            filterQuery,
            selectedIndex: Math.min(selectedIndex, Math.max(filteredHistoryOptions.length - 1, 0)),
            busy: loadingAsyncLines,
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
              overlay.type === "diagnostics"
            ? {
                type: overlay.type,
                title,
                subtitle,
                lines,
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
          {overlay.type === "provider_picker" ||
          overlay.type === "history" ||
          overlay.type === "settings" ? (
            <InlineBadge
              label={`${
                overlay.type === "provider_picker"
                  ? filteredProviderOptions.length
                  : overlay.type === "history"
                    ? filteredHistoryOptions.length
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
            cursor={commandCursor}
            commands={commands}
            highlightedIndex={highlightedIndex}
          />
        ) : null}
        <ShellFooter
          taskLabel={
            overlay.type === "provider_picker"
              ? "Provider picker  ·  Type to filter, Enter to switch, Esc closes"
              : overlay.type === "history"
                ? "History picker  ·  Type to filter, Enter to resume, Esc closes"
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
