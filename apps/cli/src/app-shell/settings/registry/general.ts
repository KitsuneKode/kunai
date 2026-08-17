import type { KitsuneConfig } from "@/services/persistence/ConfigService";

import { formatRelativeTime } from "../../media-panel-model";
import type { SettingRowDef, SettingsRegistryContext } from "../types";
import { FOOTER_HINT_OPTIONS } from "./shared";

const ANALYTICS_DETAIL =
  "Optional anonymous install, version, OS, architecture, and timestamp ping";

/**
 * Say when the last ping actually left, not just that the toggle is on.
 *
 * A setting that sends something on your behalf should be able to answer "and
 * when did it last do that" without the user opening a JSON payload or trusting
 * the switch. Silence here is what makes an opt-in feel like something happening
 * to you rather than something you turned on.
 *
 * Only shown while enabled: `lastAnalyticsPingAt` survives a disable so a
 * re-enable does not immediately re-send, and reporting a send date next to an
 * off switch would read as if it were still sending.
 */
export function analyticsSettingDetail(config: KitsuneConfig): string {
  if (config.analytics !== "enabled") return ANALYTICS_DETAIL;

  const sentAt = config.lastAnalyticsPingAt;
  if (!sentAt) return `${ANALYTICS_DETAIL} · nothing sent yet`;

  // A hand-edited or corrupt config must not take the Settings screen down.
  // `toISOString()` throws on an invalid Date, and "finite and positive" is not
  // enough: anything past ECMAScript's ±8.64e15 ms range is invalid too, which
  // `Number.MAX_SAFE_INTEGER` comfortably is.
  const MAX_TIME_MS = 8.64e15;
  if (!Number.isFinite(sentAt) || sentAt <= 0 || sentAt > MAX_TIME_MS) return ANALYTICS_DETAIL;

  const when = formatRelativeTime(new Date(sentAt).toISOString());
  return when ? `${ANALYTICS_DETAIL} · last sent ${when}` : ANALYTICS_DETAIL;
}

const DEFAULT_MODE_OPTIONS = [
  { value: "series", label: "Series mode", detail: "Browse movies and TV on launch" },
  { value: "anime", label: "Anime mode", detail: "Browse anime on launch" },
  { value: "youtube", label: "YouTube mode", detail: "Browse and play YouTube on launch" },
] as const;

export function generalSettingsRows(ctx: SettingsRegistryContext): SettingRowDef[] {
  return [
    {
      kind: "section",
      id: "section:general",
      label: "General",
      detail: "Launch mode and how much shortcut help the shell shows",
    },
    {
      kind: "enum",
      id: "defaultMode",
      label: "Default startup mode",
      detail: "First catalog after launch: series, anime, or YouTube",
      options: DEFAULT_MODE_OPTIONS,
      presentation: "submenu",
      read: (config) => config.defaultMode,
      write: (config, value) => {
        if (value === "anime" || value === "youtube" || value === "series") {
          return { ...config, defaultMode: value };
        }
        return { ...config, defaultMode: "series" };
      },
    },
    {
      kind: "enum",
      id: "footerHints",
      label: "Footer hints",
      detail: "Detailed = footer shows key legend; minimal = task line only during playback",
      options: FOOTER_HINT_OPTIONS,
      presentation: "submenu",
      read: (config) => config.footerHints,
      write: (config, value) =>
        value === "minimal"
          ? { ...config, footerHints: "minimal" }
          : { ...config, footerHints: "detailed" },
    },
    {
      kind: "boolean",
      id: "usageAnalytics",
      label: "Usage analytics",
      detail: analyticsSettingDetail(ctx.config),
      read: (config) => config.analytics === "enabled",
      write: (config, value) =>
        value
          ? { ...config, analytics: "enabled" }
          : { ...config, analytics: "disabled", installId: "" },
    },
  ];
}
