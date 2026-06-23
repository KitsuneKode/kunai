import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import {
  isLikelyRelayToken,
  isSafeProviderRelayBaseUrl,
} from "@/services/providers/provider-relay-settings";

import type { SettingsChoiceValue } from "./overlay-panel";

export const SETTINGS_TEXT_INPUT_CHOICES = new Set<SettingsChoiceValue>([
  "downloadPath",
  "presenceDiscordClientId",
  "presenceDiscordOpenUrl",
  "videasySessionToken",
  "providerRelayBaseUrl",
  "providerRelayToken",
]);

export function isSettingsTextInputChoice(
  choice: SettingsChoiceValue | null | undefined,
): choice is SettingsChoiceValue {
  return choice !== null && choice !== undefined && SETTINGS_TEXT_INPUT_CHOICES.has(choice);
}

export function settingsTextInputPlaceholder(choice: SettingsChoiceValue): string {
  switch (choice) {
    case "downloadPath":
      return "Type an absolute download path, then press Enter";
    case "presenceDiscordClientId":
      return "Type your Discord application client id, then press Enter";
    case "presenceDiscordOpenUrl":
      return "Type an https:// or kunai:// URL, then press Enter";
    case "videasySessionToken":
      return "Type your Videasy session token, then press Enter";
    case "providerRelayBaseUrl":
      return "Type your relay server URL, then press Enter";
    case "providerRelayToken":
      return "Type your relay bearer token, then press Enter";
    default:
      return "Type your value, then press Enter";
  }
}

export type SettingsTextInputApplyResult =
  | { readonly ok: true; readonly next: KitsuneConfig; readonly message: string }
  | { readonly ok: false; readonly message: string };

export function applySettingsTextInput(
  choice: SettingsChoiceValue,
  draft: KitsuneConfig,
  query: string,
): SettingsTextInputApplyResult | null {
  const typed = query.trim();
  if (!typed) return null;

  switch (choice) {
    case "downloadPath":
      if (!typed.startsWith("/")) {
        return { ok: false, message: "Type an absolute download path, or Esc to cancel." };
      }
      return {
        ok: true,
        next: { ...draft, downloadPath: typed },
        message: "Download path saved in draft.",
      };
    case "presenceDiscordClientId":
      if (!/^\d{12,32}$/.test(typed)) {
        return {
          ok: false,
          message: "Type a numeric Discord application client id, or Esc to cancel.",
        };
      }
      return {
        ok: true,
        next: { ...draft, presenceDiscordClientId: typed },
        message: "Saved in draft — auto-syncs to disk.",
      };
    case "presenceDiscordOpenUrl":
      if (!isSafeDiscordOpenUrl(typed)) {
        return { ok: false, message: "Type a safe https:// or kunai:// URL, or Esc to cancel." };
      }
      return {
        ok: true,
        next: { ...draft, presenceDiscordOpenUrl: typed },
        message: "Saved in draft — auto-syncs to disk.",
      };
    case "videasySessionToken":
      if (!isLikelyVideasySessionToken(typed)) {
        return { ok: false, message: "Type a Videasy session token, or Esc to cancel." };
      }
      return {
        ok: true,
        next: { ...draft, videasySessionToken: typed },
        message: "Saved in draft — auto-syncs to disk.",
      };
    case "providerRelayBaseUrl":
      if (!isSafeProviderRelayBaseUrl(typed)) {
        return {
          ok: false,
          message: "Type a safe https:// relay URL or local http://127.0.0.1 URL.",
        };
      }
      return {
        ok: true,
        next: {
          ...draft,
          providerRelay: {
            ...draft.providerRelay,
            baseUrl: typed,
            ...(draft.providerRelay.baseUrl?.trim() ? {} : { enabled: true }),
          },
        },
        message: "Saved in draft — auto-syncs to disk.",
      };
    case "providerRelayToken":
      if (!isLikelyRelayToken(typed)) {
        return { ok: false, message: "Type a relay bearer token, or Esc to cancel." };
      }
      return {
        ok: true,
        next: {
          ...draft,
          providerRelay: { ...draft.providerRelay, token: typed },
        },
        message: "Saved in draft — auto-syncs to disk.",
      };
    default:
      return null;
  }
}

function isSafeDiscordOpenUrl(value: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "kunai:";
  } catch {
    return false;
  }
}

function isLikelyVideasySessionToken(value: string): boolean {
  return value.length >= 16 && !/\s/.test(value);
}
