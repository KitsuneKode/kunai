import type { PresenceSnapshot, PresenceStatus } from "@/services/presence/PresenceService";

import type { SettingRowDef, SettingsRegistryContext } from "../types";
import {
  describeDiscordClientId,
  describeDiscordOpenUrl,
  PRESENCE_PRIVACY_OPTIONS,
  PRESENCE_PROVIDER_OPTIONS,
} from "./shared";

function resolvePresenceStatus(
  config: SettingsRegistryContext["config"],
  snapshot: PresenceSnapshot | null,
): PresenceStatus {
  return snapshot?.status ?? (config.presenceProvider === "off" ? "disabled" : "idle");
}

function presenceConnectionLabel(
  config: SettingsRegistryContext["config"],
  status: PresenceStatus,
): string {
  if (config.presenceProvider !== "discord") return "Connect Discord now";
  if (status === "ready") return "Disconnect Discord";
  if (status === "unavailable" || status === "error") return "Reconnect Discord now";
  return "Connect Discord now";
}

function presenceConnectionDetail(
  config: SettingsRegistryContext["config"],
  status: PresenceStatus,
): string {
  if (config.presenceProvider !== "discord") {
    return "Set Presence to Discord first, then connect local Discord IPC";
  }
  if (status === "ready") return "Clear Rich Presence and close the local Discord IPC client";
  if (status === "unavailable" || status === "error") {
    return "Retry local Discord IPC connection after a failed attempt";
  }
  return "Save pending settings and verify local Discord IPC without starting playback";
}

export function presenceSettingsRows(ctx: SettingsRegistryContext): SettingRowDef[] {
  const status = resolvePresenceStatus(ctx.config, ctx.presenceSnapshot);
  return [
    {
      kind: "section",
      id: "section:presence",
      label: "Presence",
      detail: "Discord status integration",
    },
    {
      kind: "enum",
      id: "presenceProvider",
      label: "Presence",
      detail: "Optional local social presence integration. Off by default.",
      options: PRESENCE_PROVIDER_OPTIONS,
      presentation: "submenu",
      read: (config) => config.presenceProvider,
      write: (config, value) => ({
        ...config,
        presenceProvider: value as typeof config.presenceProvider,
      }),
    },
    {
      kind: "enum",
      id: "presencePrivacy",
      label: "Presence privacy",
      detail: "Controls how much title detail presence integrations may expose",
      options: PRESENCE_PRIVACY_OPTIONS,
      presentation: "submenu",
      read: (config) => config.presencePrivacy,
      write: (config, value) => ({
        ...config,
        presencePrivacy: value as typeof config.presencePrivacy,
      }),
    },
    {
      kind: "status",
      id: "presenceStatus",
      label: "Discord status",
      detail:
        ctx.presenceSnapshot?.detail ??
        (ctx.config.presenceProvider === "off"
          ? "off"
          : "ready to connect. Connect now to verify local Discord IPC."),
      tone:
        status === "ready"
          ? "success"
          : status === "unavailable" || status === "error"
            ? "warning"
            : "info",
    },
    {
      kind: "text",
      id: "presenceDiscordClientId",
      label: "Discord client ID",
      detail: "Type a Discord application client id, or use KUNAI_DISCORD_CLIENT_ID",
      placeholder: "Type your Discord application client id, then press Enter",
      envOverride: "KUNAI_DISCORD_CLIENT_ID",
      read: (config) => config.presenceDiscordClientId,
      apply: (config, value) => ({ ...config, presenceDiscordClientId: value.trim() }),
      validate: (value) =>
        !value.trim() || /^\d{12,32}$/.test(value.trim())
          ? null
          : "Type a numeric Discord application client id, or clear to unset.",
    },
    {
      kind: "text",
      id: "presenceDiscordOpenUrl",
      label: "Discord open URL",
      detail: "Reserved for future handoffs; catalog buttons are auto-built from title ids",
      placeholder: "Type an https:// or kunai:// URL, then press Enter",
      read: (config) => config.presenceDiscordOpenUrl,
      apply: (config, value) => ({ ...config, presenceDiscordOpenUrl: value.trim() }),
      validate: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return null;
        try {
          const parsed = new URL(trimmed);
          return parsed.protocol === "https:" || parsed.protocol === "kunai:"
            ? null
            : "Type a safe https:// or kunai:// URL.";
        } catch {
          return "Type a safe https:// or kunai:// URL.";
        }
      },
    },
    {
      kind: "action",
      id: "presenceConnection",
      label: presenceConnectionLabel(ctx.config, status),
      detail: presenceConnectionDetail(ctx.config, status),
      run: async (actionCtx) => {
        if (actionCtx.config.presenceProvider !== "discord") {
          return "Set Presence to Discord first, then retry this action.";
        }
        const currentSnapshot = actionCtx.container.presence.getSnapshot();
        if (currentSnapshot.status === "ready") {
          const snapshot = await actionCtx.container.presence.disconnect("settings-disconnect");
          return `Discord presence: ${snapshot.status}  ·  ${snapshot.detail}`;
        }

        const { applySettingsToRuntime } =
          await import("@/app/bootstrap/apply-settings-to-runtime");
        await applySettingsToRuntime({
          container: actionCtx.container,
          next: actionCtx.config,
          previous: actionCtx.container.config.getRaw(),
        });
        const snapshot = await actionCtx.container.presence.connect();
        return `Discord presence: ${snapshot.status}  ·  ${snapshot.detail}`;
      },
    },
    {
      kind: "status",
      id: "presenceClientIdStatus",
      label: "Discord client ID source",
      detail: describeDiscordClientId(ctx.config),
      tone: describeDiscordClientId(ctx.config) === "bundled default" ? "info" : "success",
    },
    {
      kind: "status",
      id: "presenceOpenUrlStatus",
      label: "Discord open URL source",
      detail: describeDiscordOpenUrl(ctx.config),
      tone: describeDiscordOpenUrl(ctx.config) === "off" ? "info" : "success",
    },
  ];
}
