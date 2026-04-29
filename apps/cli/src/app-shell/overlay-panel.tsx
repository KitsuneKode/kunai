import React from "react";
import { Box, Text } from "ink";

import type { KitsuneConfig } from "@/services/persistence/ConfigService";

import { Badge } from "./shell-primitives";
import { getWindowStart, truncateLine, wrapText } from "./shell-text";
import { palette } from "./shell-theme";
import type { ShellPanelLine, ShellPickerOption } from "./types";

export type BrowseOverlay =
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

export type SettingsChoiceValue = SettingsAction;

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

export function buildSettingsSummary(config: KitsuneConfig): string {
  return `${config.defaultMode} default  ·  series ${config.provider}  ·  anime ${config.animeProvider}  ·  footer ${config.footerHints}`;
}

export function buildSettingsOptions(
  config: KitsuneConfig,
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

export function buildSettingsProviderOptions({
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

export function buildSettingsChoiceOverlay({
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

export function settingsEqual(
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

export function OverlayPanel({
  overlay,
  width,
  maxLinesOverride,
}: {
  overlay: BrowseOverlay;
  width: number;
  maxLinesOverride?: number;
}) {
  const contentWidth = Math.max(24, width - 4);
  const maxLines = maxLinesOverride ?? (overlay.type === "episode-picker" ? 8 : 6);
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
