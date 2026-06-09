import { shouldApplyStartAtSeek } from "./mpv-start-seek";

export type NormalizedStreamHttpHeaders = {
  readonly referer?: string;
  readonly userAgent?: string;
  readonly origin?: string;
};

/** Canonical HTTP header fields used for mpv launch args and persistent loadfile options. */
export function normalizeStreamHttpHeaders(
  headers: Record<string, string> | undefined,
): NormalizedStreamHttpHeaders {
  const source = headers ?? {};
  const referer = source.referer ?? source.Referer;
  const userAgent = source["user-agent"] ?? source["User-Agent"];
  const origin = source.origin ?? source.Origin;
  return {
    referer: typeof referer === "string" && referer.trim().length > 0 ? referer.trim() : undefined,
    userAgent:
      typeof userAgent === "string" && userAgent.trim().length > 0 ? userAgent.trim() : undefined,
    origin: typeof origin === "string" && origin.trim().length > 0 ? origin.trim() : undefined,
  };
}

/**
 * Identity for persistent mpv session reuse. Per-episode referer drift (Videasy/Cineplay) is
 * applied via file-local loadfile options instead of respawning the player process.
 */
export function buildPersistentSessionHeadersKey(
  headers: Record<string, string> | undefined,
): string {
  const { userAgent, origin } = normalizeStreamHttpHeaders(headers);
  return JSON.stringify({
    origin: origin ?? "",
    userAgent: userAgent ?? "",
  });
}

export type PersistentLoadfileOptions = {
  readonly start: string;
  readonly referrer?: string;
  readonly "user-agent"?: string;
  readonly "http-header-fields"?: string;
};

export function buildPersistentLoadfileOptions(
  startAt: number | undefined,
  headers: Record<string, string> | undefined,
): PersistentLoadfileOptions {
  const { referer, userAgent, origin } = normalizeStreamHttpHeaders(headers);
  return {
    start: shouldApplyStartAtSeek(startAt) ? String(startAt) : "0",
    ...(referer ? { referrer: referer } : {}),
    ...(userAgent ? { "user-agent": userAgent } : {}),
    ...(origin ? { "http-header-fields": `Origin: ${origin}` } : {}),
  };
}

export function buildPersistentLoadfileCommand(
  url: string,
  startAt?: number,
  headers?: Record<string, string>,
): ["loadfile", string, "replace", -1, PersistentLoadfileOptions] {
  return ["loadfile", url, "replace", -1, buildPersistentLoadfileOptions(startAt, headers)];
}
