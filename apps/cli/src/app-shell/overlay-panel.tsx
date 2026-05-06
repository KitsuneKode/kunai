import type {
  KitsuneConfig,
  QuitNearEndBehavior,
  QuitNearEndThresholdMode,
} from "@/services/persistence/ConfigService";
import { Box, Text } from "ink";

import {
  formatPickerDisplayRow,
  formatPickerOptionRow,
  PickerOptionRow,
} from "./overlay-picker-row";
import { Badge } from "./shell-primitives";
import { getWindowStart, truncateLine, wrapText } from "./shell-text";
import { palette } from "./shell-theme";
import type { ShellPanelLine, ShellPickerOption } from "./types";

export { formatPickerDisplayRow, formatPickerOptionRow } from "./overlay-picker-row";

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
      type: "provider" | "history-picker";
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
  | "animeTitlePreference"
  | "showMemory"
  | "autoNext"
  | "resumeStartChoicePrompt"
  | "quitNearEndBehavior"
  | "quitNearEndThresholdMode"
  | "skipRecap"
  | "skipIntro"
  | "skipCredits"
  | "skipPreview"
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

const ANIME_TITLE_SETTINGS_OPTIONS: readonly ShellPickerOption<
  KitsuneConfig["animeTitlePreference"]
>[] = [
  { value: "english", label: "English", detail: "Prefer localized English titles when known" },
  { value: "romaji", label: "Romaji", detail: "Prefer romanized Japanese titles" },
  { value: "native", label: "Native", detail: "Prefer native Japanese titles" },
  { value: "provider", label: "Provider", detail: "Use the title returned by the active provider" },
];

const QUIT_NEAR_END_BEHAVIOR_OPTIONS: readonly ShellPickerOption<QuitNearEndBehavior>[] = [
  {
    value: "continue",
    label: "Continue",
    detail: "Quitting mpv near the end still allows auto-next when enabled",
  },
  {
    value: "pause",
    label: "Pause chain",
    detail: "Quitting mpv always stops the auto-next chain (EOF still advances)",
  },
];

const QUIT_THRESHOLD_MODE_OPTIONS: readonly ShellPickerOption<QuitNearEndThresholdMode>[] = [
  {
    value: "credits-or-90-percent",
    label: "Credits or last 5s",
    detail: "Prefer AniSkip/IntroDB credits start, else last five seconds",
  },
  {
    value: "percent-only",
    label: "95% watched",
    detail: "Treat as near-end when watched ≥ 95% of reported duration",
  },
  {
    value: "seconds-only",
    label: "Last 5 seconds",
    detail: "Ignore segment timing; only last five seconds count as near-end",
  },
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
      value: "animeTitlePreference",
      label: `Anime title names  ·  ${config.animeTitlePreference}`,
      detail: "Choose English, Romaji, native, or provider titles in anime search",
    },
    {
      value: "showMemory",
      label: `Memory panel  ·  ${config.showMemory ? "opens on playback" : "on demand"}`,
      detail: "Press m during playback for fresh app, mpv, total, heap, and swap usage",
    },
    {
      value: "autoNext",
      label: `Autoplay next  ·  ${config.autoNext ? "on" : "off"}`,
      detail: "Close mpv on EOF and continue through the next available released episode",
    },
    {
      value: "resumeStartChoicePrompt",
      label: `Resume vs start-over prompt  ·  ${config.resumeStartChoicePrompt ? "on" : "off"}`,
      detail:
        "When autoplay resumes mid-episode, show mpv overlay (R/O) before seeking; off jumps straight to saved time",
    },
    {
      value: "quitNearEndBehavior",
      label: `Quit near end  ·  ${config.quitNearEndBehavior}`,
      detail: "Whether quitting mpv near the natural end can still trigger auto-next",
    },
    {
      value: "quitNearEndThresholdMode",
      label: `Near-end detection  ·  ${config.quitNearEndThresholdMode}`,
      detail: "How Kunai decides you were “close enough” to the end for quit + completion",
    },
    {
      value: "skipRecap",
      label: `Skip recaps  ·  ${config.skipRecap ? "on" : "off"}`,
      detail: "Auto-skip recap segments when IntroDB timing exists",
    },
    {
      value: "skipIntro",
      label: `Skip intros  ·  ${config.skipIntro ? "on" : "off"}`,
      detail: "Auto-skip intro segments when IntroDB timing exists",
    },
    {
      value: "skipCredits",
      label: `Skip credits  ·  ${config.skipCredits ? "on" : "off"}`,
      detail: "Auto-skip credits segments when IntroDB or AniSkip timing exists",
    },
    {
      value: "skipPreview",
      label: `Skip previews  ·  ${config.skipPreview ? "on" : "off"}`,
      detail: "Auto-skip preview segments when IntroDB timing exists",
    },
    {
      value: "footerHints",
      label: `Footer hints  ·  ${config.footerHints}`,
      detail: "Detailed keeps two lines, minimal keeps only the task line",
    },
    {
      value: "clearCache",
      label: "Clear stream cache",
      detail: "Wipe the local SQLite stream cache",
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
  } else if (setting === "animeTitlePreference") {
    title = "Anime title names";
    subtitle = `Current ${config.animeTitlePreference}`;
    options = ANIME_TITLE_SETTINGS_OPTIONS.map((option) => ({
      ...option,
      label:
        option.value === config.animeTitlePreference ? `${option.label}  ·  current` : option.label,
    })) as readonly ShellPickerOption<string>[];
  } else if (setting === "footerHints") {
    title = "Footer hint density";
    subtitle = `Current ${config.footerHints}`;
    options = FOOTER_HINT_OPTIONS.map((option) => ({
      ...option,
      label: option.value === config.footerHints ? `${option.label}  ·  current` : option.label,
    })) as readonly ShellPickerOption<string>[];
  } else if (setting === "quitNearEndBehavior") {
    title = "Quit near end";
    subtitle = `Current ${config.quitNearEndBehavior}`;
    options = QUIT_NEAR_END_BEHAVIOR_OPTIONS.map((option) => ({
      ...option,
      label:
        option.value === config.quitNearEndBehavior ? `${option.label}  ·  current` : option.label,
    })) as readonly ShellPickerOption<string>[];
  } else if (setting === "quitNearEndThresholdMode") {
    title = "Near-end detection";
    subtitle = `Current ${config.quitNearEndThresholdMode}`;
    options = QUIT_THRESHOLD_MODE_OPTIONS.map((option) => ({
      ...option,
      label:
        option.value === config.quitNearEndThresholdMode
          ? `${option.label}  ·  current`
          : option.label,
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
    case "info":
      return palette.cyan;
    case "warning":
      return palette.amber;
    case "error":
      return palette.red;
    case "neutral":
    default:
      return palette.muted;
  }
}

/** Matches panel border/title accents for picker list focus styling. */
function pickerFocusAccent(type: Extract<BrowseOverlay, { filterQuery: string }>["type"]): string {
  if (type === "settings" || type === "settings-choice") return palette.green;
  if (type === "provider") return palette.amber;
  return palette.cyan;
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
  const isPickerOverlay =
    overlay.type === "provider" ||
    overlay.type === "history-picker" ||
    overlay.type === "settings" ||
    overlay.type === "settings-choice" ||
    overlay.type === "episode-picker";
  const isLineOverlay =
    overlay.type === "help" ||
    overlay.type === "about" ||
    overlay.type === "diagnostics" ||
    overlay.type === "history" ||
    overlay.type === "details";
  const optionWindowStart = isPickerOverlay
    ? getWindowStart(overlay.selectedIndex, overlay.options.length, maxLines)
    : 0;
  const optionWindowEnd = optionWindowStart + maxLines;
  const visibleOptions = isPickerOverlay
    ? overlay.options.slice(optionWindowStart, optionWindowEnd)
    : [];
  const pickerAccent = isPickerOverlay
    ? pickerFocusAccent((overlay as Extract<BrowseOverlay, { filterQuery: string }>).type)
    : palette.cyan;

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
      {isPickerOverlay ? (
        <>
          <Box marginTop={1}>
            <Text color={palette.gray}>
              {overlay.filterQuery.length > 0
                ? `Filter: ${overlay.filterQuery}`
                : overlay.type === "provider"
                  ? "Type to narrow providers"
                  : overlay.type === "history-picker"
                    ? "Type to narrow history (or filter by 'completed', 'watching')"
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
              const accentColor =
                option.tone === "success"
                  ? palette.green
                  : option.tone === "warning"
                    ? palette.amber
                    : null;
              return (
                <Text
                  key={`${option.value}-${optionIndex}`}
                  backgroundColor={selected ? palette.surfaceElevated : undefined}
                  bold={selected}
                  wrap="truncate-end"
                >
                  <PickerOptionRow
                    label={option.label}
                    detail={option.detail}
                    badge={option.badge}
                    width={Math.max(0, contentWidth)}
                    selected={selected}
                    accentColor={accentColor}
                    pickerAccent={pickerAccent}
                  />
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
                  : overlay.type === "history-picker"
                    ? "Loading history…"
                    : "Saving settings…"
                : overlay.type === "provider"
                  ? "Type to filter, ↑↓ to choose, Enter to switch, Esc to close"
                  : overlay.type === "history-picker"
                    ? "Type to filter, ↑↓ to choose, Enter to resume, Esc to close"
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
      ) : isLineOverlay && overlay.loading ? (
        <Box marginTop={1}>
          <Text color={palette.amber}>Loading panel…</Text>
        </Box>
      ) : isLineOverlay ? (
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
            .map((line: ShellPanelLine) => (
              <Box
                key={`${line.label}-${line.detail ?? ""}`}
                flexDirection="column"
                marginBottom={1}
              >
                <Text color={resolvePanelTone(line.tone)}>
                  {truncateLine(line.label, contentWidth)}
                </Text>
                {line.detail
                  ? wrapText(line.detail, contentWidth, 2).map((detailLine) => (
                      <Text key={`${line.label}-${detailLine}`} color={palette.gray}>
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
      ) : null}
    </Box>
  );
}
