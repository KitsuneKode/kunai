import { isJsonNumber, isJsonObject, isJsonString, type JsonValue } from "@kunai/types";

import type { PlayerPlaybackEvent } from "./PlayerService";

/** Decode only the explicit bridge key action; ordinary audio observations are not intent. */
export function parseMpvAudioIntent(
  value: string | undefined,
  currentMediaPath: string | null,
): Extract<PlayerPlaybackEvent, { type: "track-changed" }> | null {
  if (!currentMediaPath || !value || value.length > 8_192) return null;
  let payload: JsonValue;
  try {
    // SAFETY: JSON.parse returns JSON values; the expected object and fields are checked below.
    payload = JSON.parse(value) as JsonValue;
  } catch {
    return null;
  }
  if (!isJsonObject(payload)) return null;
  const { id, language, path } = payload;
  if (path !== currentMediaPath || !isJsonNumber(id) || !Number.isSafeInteger(id) || id <= 0)
    return null;
  if (!isJsonString(language)) return null;
  const normalized = language.trim().toLowerCase().replaceAll("_", "-");
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(normalized)) return null;
  if (["und", "zxx", "mul"].includes(normalized.split("-")[0] ?? "")) return null;
  let canonicalLanguage: string;
  try {
    // Canonicalize aliases before both reconnect and session consumers see them.
    // Keep legitimate three-letter languages without a two-letter equivalent.
    canonicalLanguage = new Intl.Locale(normalized).toString().toLowerCase();
  } catch {
    return null;
  }
  // Media paths authorize the observation locally; they never leave this boundary.
  return {
    type: "track-changed",
    trackType: "audio",
    id,
    audioLanguageIntent: canonicalLanguage,
  };
}
