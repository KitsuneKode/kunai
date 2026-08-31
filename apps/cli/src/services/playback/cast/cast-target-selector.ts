import { isIP } from "node:net";

import type { GoogleCastPlaybackTarget } from "@/domain/playback/playback-target";

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
