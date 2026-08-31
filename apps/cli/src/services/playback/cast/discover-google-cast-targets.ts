import type { GoogleCastPlaybackTarget } from "@/domain/playback/playback-target";

import { GoogleCastDialDiscoveryService } from "./GoogleCastDialDiscoveryService";
import { GoogleCastDiscoveryService } from "./GoogleCastDiscoveryService";
import { GoogleCastNativeDiscoveryService } from "./GoogleCastNativeDiscoveryService";

export async function discoverGoogleCastTargets(
  durationMs = 2_500,
  signal?: AbortSignal,
): Promise<readonly GoogleCastPlaybackTarget[]> {
  const mdns = new GoogleCastDiscoveryService().browse();
  try {
    const [, dialTargets, firstNativeTargets] = await Promise.all([
      Bun.sleep(durationMs),
      new GoogleCastDialDiscoveryService().discover(durationMs, signal),
      new GoogleCastNativeDiscoveryService().discover(),
    ]);
    const nativeTargets =
      firstNativeTargets.length > 0
        ? firstNativeTargets
        : await new GoogleCastNativeDiscoveryService().discover();
    const targets = new Map<string, GoogleCastPlaybackTarget>();
    for (const target of [...mdns.targets, ...dialTargets, ...nativeTargets]) {
      const key = target.host ? `${target.host}:${target.port ?? 8009}` : target.id;
      const current = targets.get(key);
      targets.set(key, current?.modelName ? current : target);
    }
    return [...targets.values()].sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    mdns.stop();
  }
}
