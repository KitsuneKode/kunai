import { rotateInstallId } from "@/services/analytics/install-id";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

import { formatRelativeTime } from "../../media-panel-model";
import type { SettingRowDef, SettingsRegistryContext } from "../types";
import { storageSettingsRows } from "./storage";
import { updateSettingsRows } from "./updates";

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

/**
 * Shows the id the user actually owns, not the digest that goes on the wire.
 * A prefix is enough to tell one identity from another across a rotation, which
 * is the only question this line has to answer.
 */
function installIdDetail(config: KitsuneConfig): string {
  // Same rule as the ping detail above: a hand-edited or partial config must
  // not take the Settings screen down, so this cannot assume the key is present.
  const id = typeof config.installId === "string" ? config.installId.trim() : "";
  if (!id) return "No identifier exists yet";
  return `${id.slice(0, 8)}… · only its sha256 is ever sent`;
}

export function privacySettingsRows(ctx: SettingsRegistryContext): SettingRowDef[] {
  return [
    {
      kind: "section",
      id: "section:privacy",
      label: "Privacy & System",
      tabLabel: "Privacy",
      detail: "Usage analytics, updates, diagnostics, and reset actions",
    },
    {
      kind: "subheading",
      id: "subheading:analytics",
      label: "Analytics & Privacy",
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
    {
      kind: "action",
      id: "rotateInstallId",
      label: "Rotate install id",
      detail: installIdDetail(ctx.config),
      // Only meaningful while enabled: disabling already clears the id, so
      // offering rotation next to an off switch would imply one still exists.
      gate: { predicate: (config) => config.analytics === "enabled" },
      run: async (actionCtx) => {
        const next = rotateInstallId();
        await actionCtx.container.config.update({
          installId: next,
          // The new identity has to start its own cadence. Carrying the old
          // timestamps forward would suppress the first ping under the new id
          // for up to a day, and a rotation nobody can observe is not one.
          lastAnalyticsPingAt: 0,
          analyticsRetryAfter: 0,
        });
        await actionCtx.container.config.save();
        return `New install id ${next.slice(0, 8)}… — earlier pings cannot be linked to it.`;
      },
    },
    ...updateSettingsRows(ctx),
    {
      kind: "subheading",
      id: "subheading:advanced",
      label: "Advanced",
    },
    {
      kind: "boolean",
      id: "showMemory",
      label: "Memory panel",
      detail:
        "Hidden by default. Use /memory during playback for app, mpv, total, heap, and swap usage",
      read: (config) => config.showMemory,
      write: (config, value) => ({ ...config, showMemory: value }),
    },
    ...storageSettingsRows(ctx),
  ];
}
