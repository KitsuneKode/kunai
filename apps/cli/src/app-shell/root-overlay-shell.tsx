import { useLineEditor } from "@/app-shell/line-editor";
import type { Container } from "@/container";
import type { SessionState } from "@/domain/session/SessionState";
import type {
  AutoDownloadMode,
  KitsuneConfig,
  QuitNearEndBehavior,
  QuitNearEndThresholdMode,
} from "@/services/persistence/ConfigService";
import { Box, useInput, useStdout } from "ink";
import { useEffect, useState } from "react";

import { resolveCommandContext } from "./commands";
import { DownloadManagerContent } from "./download-manager-shell";
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
  getRootOverlayInitialIndex,
  getRootOverlayResetKey,
  getRootOverlaySubtitle,
  getRootOverlayTitle,
  isRootChoiceOverlay,
  isRootMediaPickerOverlay,
} from "./root-overlay-model";
import { type RootOwnedOverlay } from "./root-shell-state";
import { CommandPalette, useShellInput } from "./shell-command-ui";
import { InlineBadge, ShellFooter } from "./shell-primitives";
import type { FooterAction, ShellPanelLine } from "./types";

function getLatestPresenceErrorDetail(container: Container): string | null {
  const event = container.diagnosticsStore
    .getRecent(20)
    .find((entry) => entry.category === "presence" && entry.context?.error);
  const raw = event?.context?.error;
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  return raw.trim();
}

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
  const pickerFilterQuery = isRootMediaPickerOverlay(overlay)
    ? (overlay.filterQuery ?? "")
    : filterQuery;
  const pickerSelectedIndex = isRootMediaPickerOverlay(overlay)
    ? (overlay.selectedIndex ?? (overlay.type === "episode_picker" ? overlay.initialIndex : 0) ?? 0)
    : selectedIndex;
  const filterEditor = useLineEditor({
    value: pickerFilterQuery,
    onChange: (nextValue) => {
      if (isRootMediaPickerOverlay(overlay)) {
        if (!overlay.id) return;
        container.stateManager.dispatch({
          type: "UPDATE_PICKER_FILTER",
          id: overlay.id,
          filterQuery: nextValue,
        });
        return;
      }
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
  const [historyFilterMode, setHistoryFilterMode] = useState<"all" | "watching" | "completed">(
    "all",
  );
  const overlayResetKey = getRootOverlayResetKey(overlay);
  const overlayInitialIndex = getRootOverlayInitialIndex(overlay);
  const commands = resolveCommandContext(state, "rootOverlay");
  const settingsSeriesProviderOptions = buildSettingsProviderOptions({
    providers: container.providerRegistry
      .getAll()
      .map((p) => p.metadata)
      .filter((metadata) => !metadata.isAnimeProvider),
    currentProvider: settingsDraft?.provider ?? container.config.provider,
  });
  const settingsAnimeProviderOptions = buildSettingsProviderOptions({
    providers: container.providerRegistry
      .getAll()
      .map((p) => p.metadata)
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
            capabilitySnapshot: container.capabilitySnapshot,
          })
        : overlay.type === "diagnostics"
          ? buildDiagnosticsPanelLines({
              state,
              recentEvents: container.diagnosticsStore.getRecent(10),
              capabilitySnapshot: container.capabilitySnapshot,
              presenceSnapshot: container.presence.getSnapshot(),
            })
          : [];
  const lines = overlay.type === "history" ? (asyncLines ?? []) : staticLines;
  const providerOptions =
    overlay.type === "provider_picker"
      ? buildProviderPickerOptions({
          providers: container.providerRegistry
            .getAll()
            .map((p) => p.metadata)
            .filter((metadata) => metadata.isAnimeProvider === overlay.isAnime),
          currentProvider: overlay.currentProvider,
        })
      : [];
  const providerInitialIndex =
    overlay.type === "provider_picker"
      ? Math.max(
          0,
          providerOptions.findIndex((option) => option.value === overlay.currentProvider),
        )
      : 0;
  const genericPickerOptions =
    overlay.type === "season_picker" ||
    overlay.type === "episode_picker" ||
    overlay.type === "subtitle_picker" ||
    overlay.type === "source_picker" ||
    overlay.type === "quality_picker"
      ? overlay.options.map((option) => ({
          value: option.value,
          label: option.label,
          detail: option.detail,
          tone: option.tone,
          badge: option.badge,
        }))
      : [];
  const filteredProviderOptions = providerOptions.filter((option) => {
    const filter = filterQuery.trim().toLowerCase();
    if (filter.length === 0) return true;
    return `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(filter);
  });
  const filteredGenericPickerOptions = genericPickerOptions.filter((option) => {
    const filter = pickerFilterQuery.trim().toLowerCase();
    if (filter.length === 0) return true;
    return `${option.label} ${option.detail ?? ""} ${option.badge ?? ""}`
      .toLowerCase()
      .includes(filter);
  });
  const filteredHistoryOptions =
    overlay.type === "history"
      ? buildHistoryPickerOptions(
          historySelections
            .filter(({ entry }) => {
              const filter = filterQuery.trim().toLowerCase();
              if (filter.length > 0) {
                const isCompleted = entry.duration > 0 && entry.timestamp / entry.duration >= 0.95;
                if (filter === "completed" && isCompleted) return true;
                if (filter === "watching" && !isCompleted) return true;
                return `${entry.title} ${entry.provider} s${entry.season}e${entry.episode}`
                  .toLowerCase()
                  .includes(filter);
              }

              const isCompleted = entry.duration > 0 && entry.timestamp / entry.duration >= 0.95;
              if (historyFilterMode === "completed" && !isCompleted) return false;
              if (historyFilterMode === "watching" && isCompleted) return false;
              return true;
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
            options: buildSettingsOptions(settingsDraft, container.presence.getSnapshot()),
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
  const title = getRootOverlayTitle(overlay);
  const subtitle = getRootOverlaySubtitle({
    overlay,
    state,
    settingsDraft,
    config: container.config.getRaw(),
    settingsError,
  });
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
        action === "presence" ||
        action === "help" ||
        action === "about" ||
        action === "diagnostics" ||
        action === "downloads" ||
        action === "history" ||
        action === "provider"
      ) {
        if (isRootMediaPickerOverlay(overlay) && overlay.id) {
          container.stateManager.dispatch({ type: "CANCEL_PICKER", id: overlay.id });
        } else {
          container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
        }
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
                : action === "downloads"
                  ? { type: "downloads" }
                  : action === "settings" || action === "presence"
                    ? { type: "settings" }
                    : { type: action },
        });
      }
    },
  });

  useEffect(() => {
    setScrollIndex(0);
    setFilterQuery("");
    setSelectedIndex(
      overlay.type === "provider_picker" ? providerInitialIndex : overlayInitialIndex,
    );
    setAsyncLines(null);
    setLoadingAsyncLines(false);
    setSettingsDraft(overlay.type === "settings" ? container.config.getRaw() : null);
    setSettingsChoice(null);
    setSettingsParentIndex(0);
    setSettingsBusy(false);
    setSettingsError(null);
    setHistorySelections([]);
  }, [container.config, overlay.type, overlayResetKey, overlayInitialIndex, providerInitialIndex]);

  useEffect(() => {
    if (overlay.type !== "history") {
      return;
    }

    let cancelled = false;
    setLoadingAsyncLines(true);

    void container.historyStore
      .getAll()
      .then((entries) => {
        if (cancelled) return undefined;
        setHistorySelections(
          Object.entries(entries).map(([titleId, entry]) => ({
            titleId,
            entry,
          })),
        );
        setAsyncLines(buildHistoryPanelLines(Object.entries(entries)));
        return undefined;
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
      if (isRootMediaPickerOverlay(overlay) && overlay.id) {
        if ((overlay.filterQuery ?? "").length > 0) {
          container.stateManager.dispatch({
            type: "UPDATE_PICKER_FILTER",
            id: overlay.id,
            filterQuery: "",
          });
          return;
        }
        container.stateManager.dispatch({ type: "CANCEL_PICKER", id: overlay.id });
        return;
      }
      if (overlay.type === "history" && hasPendingRootHistorySelection()) {
        resolveRootHistorySelection(null);
      }
      container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
      return;
    }
    if (overlay.type === "history" && input === "f") {
      setHistoryFilterMode((prev) =>
        prev === "all" ? "watching" : prev === "watching" ? "completed" : "all",
      );
      return;
    }
    if (key.return) {
      if (overlay.type === "settings") {
        const picked = filteredSettingsOptions[selectedIndex];
        if (!picked || !settingsDraft) {
          if (settingsChoice === "presenceDiscordClientId" && settingsDraft) {
            const typedClientId = filterQuery.trim();
            if (/^\d{12,32}$/.test(typedClientId)) {
              setSettingsDraft({ ...settingsDraft, presenceDiscordClientId: typedClientId });
              setSettingsChoice(null);
              setFilterQuery("");
              setSelectedIndex(settingsParentIndex);
              setSettingsError("Discord client id saved in draft. Press S to save settings.");
              return;
            }
            setSettingsError("Type a numeric Discord application client id, or Esc to cancel.");
          }
          return;
        }
        if (picked.value.startsWith("section:")) {
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
          } else if (settingsChoice === "animeAudio") {
            next.animeLanguageProfile = {
              ...next.animeLanguageProfile,
              audio: picked.value,
            };
          } else if (settingsChoice === "animeSubtitle") {
            next.animeLanguageProfile = {
              ...next.animeLanguageProfile,
              subtitle: picked.value,
            };
          } else if (settingsChoice === "seriesAudio") {
            next.seriesLanguageProfile = {
              ...next.seriesLanguageProfile,
              audio: picked.value,
            };
          } else if (settingsChoice === "seriesSubtitle") {
            next.seriesLanguageProfile = {
              ...next.seriesLanguageProfile,
              subtitle: picked.value,
            };
          } else if (settingsChoice === "movieAudio") {
            next.movieLanguageProfile = {
              ...next.movieLanguageProfile,
              audio: picked.value,
            };
          } else if (settingsChoice === "movieSubtitle") {
            next.movieLanguageProfile = {
              ...next.movieLanguageProfile,
              subtitle: picked.value,
            };
          } else if (settingsChoice === "animeTitlePreference") {
            next.animeTitlePreference = picked.value as typeof next.animeTitlePreference;
          } else if (settingsChoice === "footerHints") {
            next.footerHints = picked.value as "detailed" | "minimal";
          } else if (settingsChoice === "autoDownload") {
            next.autoDownload = picked.value as AutoDownloadMode;
          } else if (settingsChoice === "presenceProvider") {
            next.presenceProvider = picked.value as typeof next.presenceProvider;
          } else if (settingsChoice === "presencePrivacy") {
            next.presencePrivacy = picked.value as typeof next.presencePrivacy;
          } else if (settingsChoice === "presenceDiscordClientId") {
            const typedClientId = filterQuery.trim();
            if (/^\d{12,32}$/.test(typedClientId)) {
              next.presenceDiscordClientId = typedClientId;
            } else if (picked.value === "__clear__" || picked.value === "__env__") {
              next.presenceDiscordClientId = "";
            } else if (picked.value === "__keep__") {
              // Keep the existing draft value.
            } else {
              setSettingsError("Type a numeric Discord application client id, or Esc to cancel.");
              return;
            }
          } else if (settingsChoice === "quitNearEndBehavior") {
            next.quitNearEndBehavior = picked.value as QuitNearEndBehavior;
          } else if (settingsChoice === "quitNearEndThresholdMode") {
            next.quitNearEndThresholdMode = picked.value as QuitNearEndThresholdMode;
          }
          setSettingsDraft(next);
          setSettingsChoice(null);
          setFilterQuery("");
          setSelectedIndex(settingsParentIndex);
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
        if (picked.value === "autoCleanupWatched") {
          setSettingsDraft({
            ...settingsDraft,
            autoCleanupWatched: !settingsDraft.autoCleanupWatched,
          });
          setSettingsError(null);
          return;
        }
        if (picked.value === "resumeStartChoicePrompt") {
          setSettingsDraft({
            ...settingsDraft,
            resumeStartChoicePrompt: !settingsDraft.resumeStartChoicePrompt,
          });
          setSettingsError(null);
          return;
        }
        if (picked.value === "skipRecap") {
          setSettingsDraft({ ...settingsDraft, skipRecap: !settingsDraft.skipRecap });
          setSettingsError(null);
          return;
        }
        if (picked.value === "skipIntro") {
          setSettingsDraft({ ...settingsDraft, skipIntro: !settingsDraft.skipIntro });
          setSettingsError(null);
          return;
        }
        if (picked.value === "skipCredits") {
          setSettingsDraft({ ...settingsDraft, skipCredits: !settingsDraft.skipCredits });
          setSettingsError(null);
          return;
        }
        if (picked.value === "skipPreview") {
          setSettingsDraft({ ...settingsDraft, skipPreview: !settingsDraft.skipPreview });
          setSettingsError(null);
          return;
        }
        if (picked.value === "presenceConnection") {
          if (settingsDraft.presenceProvider !== "discord") {
            setSettingsError("Set Presence to Discord first, then retry this action.");
            return;
          }
          const currentSnapshot = container.presence.getSnapshot();
          const shouldDisconnect = currentSnapshot.status === "ready";
          setSettingsBusy(true);
          setSettingsError(null);
          void (async () => {
            try {
              if (shouldDisconnect) {
                const snapshot = await container.presence.disconnect("settings-disconnect");
                setSettingsError(`Discord presence: ${snapshot.status}  ·  ${snapshot.detail}`);
              } else {
                const { applySettingsToRuntime } = await import("./workflows");
                await applySettingsToRuntime({
                  container,
                  next: settingsDraft,
                  previous: container.config.getRaw(),
                });
                const snapshot = await container.presence.connect();
                setSettingsDraft(container.config.getRaw());
                if (snapshot.status === "ready") {
                  setSettingsError(`Discord presence: ${snapshot.status}  ·  ${snapshot.detail}`);
                } else {
                  const errorDetail = getLatestPresenceErrorDetail(container);
                  setSettingsError(
                    errorDetail
                      ? `Discord presence: ${snapshot.status}  ·  ${snapshot.detail}  ·  ${errorDetail}`
                      : `Discord presence: ${snapshot.status}  ·  ${snapshot.detail}  ·  Make sure Discord desktop is running, then retry connect.`,
                  );
                }
              }
            } catch (error) {
              setSettingsError(
                `Failed to ${shouldDisconnect ? "disconnect" : "connect"} Discord presence: ${String(error)}`,
              );
            } finally {
              setSettingsBusy(false);
            }
          })();
          return;
        }
        if (picked.value === "clearCache") {
          void (async () => {
            const { handleShellAction } = await import("./workflows");
            await handleShellAction({ action: "clear-cache", container });
          })();
          return;
        }
        if (picked.value === "clearHistory") {
          void (async () => {
            const { handleShellAction } = await import("./workflows");
            await handleShellAction({ action: "clear-history", container });
          })();
          return;
        }
        if (picked.value === "presenceStatus") {
          setSettingsError(
            `Discord presence: ${container.presence.getSnapshot().status}  ·  ${container.presence.getSnapshot().detail}`,
          );
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
        overlay.type === "subtitle_picker" ||
        overlay.type === "source_picker" ||
        overlay.type === "quality_picker"
      ) {
        const picked = filteredGenericPickerOptions[pickerSelectedIndex]?.value ?? null;
        if (!picked || !overlay.id) return;
        container.stateManager.dispatch({
          type: "RESOLVE_PICKER",
          id: overlay.id,
          value: picked,
        });
        return;
      }
      container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
      return;
    }
    if (key.upArrow || key.downArrow) {
      if (isRootChoiceOverlay(overlay)) {
        if (isRootMediaPickerOverlay(overlay) && overlay.id) {
          container.stateManager.dispatch({
            type: "MOVE_PICKER_SELECTION",
            id: overlay.id,
            delta: key.upArrow ? -1 : 1,
          });
          return;
        }
        const optionCount =
          overlay.type === "provider_picker"
            ? filteredProviderOptions.length
            : overlay.type === "history"
              ? filteredHistoryOptions.length
              : overlay.type === "settings"
                ? filteredSettingsOptions.length
                : filteredGenericPickerOptions.length;
        if (optionCount > 0) {
          setSelectedIndex((current) =>
            key.upArrow ? (current - 1 + optionCount) % optionCount : (current + 1) % optionCount,
          );
        }
      } else {
        if (key.upArrow) {
          setScrollIndex((current) => Math.max(0, current - 1));
        } else {
          setScrollIndex((current) => Math.min(Math.max(lines.length - maxLines, 0), current + 1));
        }
      }
      return;
    }
    if (isRootChoiceOverlay(overlay)) {
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
        void (async () => {
          try {
            const { applySettingsToRuntime } = await import("./workflows");
            await applySettingsToRuntime({
              container,
              next: settingsDraft,
              previous: container.config.getRaw(),
            });
            container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
          } catch (error) {
            setSettingsBusy(false);
            setSettingsError(`Failed to save settings: ${String(error)}`);
          }
        })();
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
              selectedIndex: Math.min(
                selectedIndex,
                Math.max(filteredSettingsOptions.length - 1, 0),
              ),
              busy: settingsBusy,
            }
          : overlay.type === "season_picker" ||
              overlay.type === "episode_picker" ||
              overlay.type === "subtitle_picker" ||
              overlay.type === "source_picker" ||
              overlay.type === "quality_picker"
            ? {
                type: "episode-picker",
                title,
                subtitle,
                options: filteredGenericPickerOptions,
                filterQuery: pickerFilterQuery,
                selectedIndex: Math.min(
                  pickerSelectedIndex,
                  Math.max(filteredGenericPickerOptions.length - 1, 0),
                ),
                busy: false,
              }
            : overlay.type === "help" || overlay.type === "about" || overlay.type === "diagnostics"
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

  if (overlay.type === "downloads") {
    return (
      <Box flexDirection="column" flexGrow={1} justifyContent="space-between">
        <Box flexDirection="column" flexGrow={1}>
          <Box>
            <InlineBadge label="panel downloads" tone="success" />
          </Box>
          <DownloadManagerContent
            container={container}
            onClose={() => container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" })}
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
            taskLabel="Download queue  ·  x cancel/remove, r retry, Esc closes"
            actions={footerActions}
            mode="detailed"
            commandMode={commandMode}
          />
        </Box>
      </Box>
    );
  }

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
          ) : isRootMediaPickerOverlay(overlay) ? (
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
                  : isRootMediaPickerOverlay(overlay)
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
