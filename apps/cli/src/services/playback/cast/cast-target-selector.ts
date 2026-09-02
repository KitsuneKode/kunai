import { isIP } from "node:net";

import type { GoogleCastPlaybackTarget } from "@/domain/playback/playback-target";

import { discoverGoogleCastTargets } from "./discover-google-cast-targets";

export function normalizeGoogleCastDeviceName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .trim()
    .toLocaleLowerCase();
}

export function googleCastTargetFromSelector(selector: string): GoogleCastPlaybackTarget {
  const value = selector.trim();
  const hostWithPort = value.match(/^([^\s:]+):(\d{1,5})$/);
  const host = hostWithPort?.[1] ?? value;
  const port = hostWithPort ? Number(hostWithPort[2]) : undefined;
  const isEndpoint = isIP(host) !== 0 || host.endsWith(".local");
  return {
    kind: "google-cast",
    id: isEndpoint ? `endpoint:${host}:${port ?? 8009}` : `name:${value.toLocaleLowerCase()}`,
    name: value,
    ...(isEndpoint ? { host, port: port ?? 8009 } : {}),
    capabilities: ["audio", "video"],
  };
}

export async function resolveGoogleCastTargetSelector(
  selector: string,
  discover: () => Promise<readonly GoogleCastPlaybackTarget[]> = () => discoverGoogleCastTargets(),
): Promise<GoogleCastPlaybackTarget> {
  const candidate = googleCastTargetFromSelector(selector);
  if (candidate.host) return candidate;
  const normalized = normalizeGoogleCastDeviceName(selector);
  const match = (await discover()).find(
    (target) => normalizeGoogleCastDeviceName(target.name) === normalized,
  );
  if (match) return match;
  throw new Error(
    `Google Cast device not found: ${selector}. Run --cast-list, use --cast to choose, or provide its IP address.`,
  );
}
