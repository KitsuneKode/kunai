import type { Container } from "@/container";
import type { ProviderLane } from "@/domain/types";
import type { CoreProviderManifest } from "@kunai/core";
import type { ProviderId } from "@kunai/types";

export type ProviderStatusTab = "all" | "movie" | "anime" | "youtube";

export interface ProviderStatusEntry {
  readonly id: string;
  readonly name: string;
  readonly lane: ProviderLane;
  readonly recommended: boolean;
  readonly disabled: boolean;
  readonly isActive: boolean;
  readonly status: "healthy" | "degraded" | "down" | "unknown" | "probing";
  readonly latencyMs?: number;
  readonly httpStatus?: number;
  readonly capabilities: readonly string[];
  readonly description: string;
  readonly domain?: string;
  readonly checkedAt?: string;
  readonly evidence?: string;
  readonly observations?: number;
  readonly consecutiveFailures?: number;
}

export interface ProviderStatusMatrix {
  readonly entries: readonly ProviderStatusEntry[];
  readonly totalCount: number;
  readonly healthyCount: number;
  readonly degradedCount: number;
  readonly downCount: number;
  readonly disabledCount: number;
}

/** Canonical probe endpoints for providers to measure live reachability and latency. */
export const PROVIDER_PROBE_ENDPOINTS = {
  movy: {
    url: "https://api.wecollege.net",
    headers: { Referer: "https://www.movy.sx/", Origin: "https://www.movy.sx" },
  },
  vidrock: {
    url: "https://vidrock.net",
    headers: { "User-Agent": "Mozilla/5.0" },
  },
  rivestream: {
    url: "https://www.rivestream.app/",
    headers: { "User-Agent": "Mozilla/5.0" },
  },
  cineby: {
    url: "https://cineby.sc",
    headers: { "User-Agent": "Mozilla/5.0" },
  },
  videasy: {
    url: "https://api.videasy.to",
    headers: { "User-Agent": "Mozilla/5.0" },
  },
  vidlink: {
    url: "https://vidlink.pro",
    headers: { "User-Agent": "Mozilla/5.0" },
  },
  rgshows: {
    url: "https://rgshows.me",
    headers: { "User-Agent": "Mozilla/5.0" },
  },
  allmanga: {
    url: "https://mkissa.to",
    headers: { "User-Agent": "Mozilla/5.0", Origin: "https://mkissa.to" },
  },
  hianime: {
    url: "https://hianime.at",
    headers: { "User-Agent": "Mozilla/5.0", Referer: "https://hianime.at/" },
  },
  kickassanime: {
    url: "https://kaa.lt",
    headers: { "User-Agent": "Mozilla/5.0" },
  },
  animegg: {
    url: "https://animegg.org",
    headers: { "User-Agent": "Mozilla/5.0" },
  },
  miruro: {
    url: "https://www.miruro.bz",
    headers: { "User-Agent": "Mozilla/5.0" },
  },
  anidb: {
    url: "https://anidb.app",
    headers: { "User-Agent": "Mozilla/5.0" },
  },
  youtube: {
    url: "https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=kunai",
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
  },
} as const satisfies Record<
  string,
  { readonly url: string; readonly headers?: Record<string, string> }
>;

function formatCapabilities(manifest?: CoreProviderManifest): readonly string[] {
  if (!manifest) return ["Direct"];
  const caps: string[] = [];
  const manifestCaps = new Set(manifest.capabilities ?? []);
  if (manifestCaps.has("quality-ranked")) caps.push("4K/1080p");
  if (manifestCaps.has("subtitle-resolve")) caps.push("Sub");
  if (manifest.mediaKinds?.includes("anime")) caps.push("Dub");
  if (manifestCaps.has("multi-source")) caps.push("Multi");
  if (manifestCaps.has("source-resolve")) caps.push("HLS");
  return caps.length > 0 ? caps : ["Direct"];
}

export function buildProviderStatusMatrix(
  container: Container,
  overrides: ReadonlyMap<string, Partial<ProviderStatusEntry>> = new Map(),
): ProviderStatusMatrix {
  const rawConfig = container.config.getRaw();
  const state = container.stateManager.getState();
  const disabledSet = new Set(rawConfig.disabledProviders ?? []);
  const allProviders = container.providerRegistry.getAllRegistered();

  const entries: ProviderStatusEntry[] = allProviders.map((provider) => {
    const meta = provider.metadata;
    const id = meta.id;
    const manifest = container.providerRegistry.getManifest(id);
    const lane: ProviderLane =
      meta.providerLane ??
      (manifest?.mediaKinds?.includes("anime")
        ? "anime"
        : manifest?.mediaKinds?.includes("video")
          ? "youtube"
          : "series");

    const disabled = disabledSet.has(id);
    const activeProviderForLane =
      lane === "anime"
        ? (rawConfig.animeProvider ?? state.provider)
        : lane === "youtube"
          ? (rawConfig.youtubeProvider ?? "youtube")
          : (rawConfig.provider ?? state.provider);

    const isActive = state.provider === id || activeProviderForLane === id;
    // SAFETY: provider id comes from registered provider metadata matching ProviderId
    const health = container.providerHealth.get(id as ProviderId);
    const override = overrides.get(id);

    let status: ProviderStatusEntry["status"] = override?.status ?? health?.status ?? "unknown";
    if (disabled && status !== "probing") {
      status = "unknown";
    }

    const latencyMs = override?.latencyMs ?? health?.medianResolveMs;
    const httpStatus = override?.httpStatus;

    let evidence = override?.evidence;
    if (!evidence) {
      if (disabled) {
        evidence = "Disabled in user config";
      } else if (health) {
        const rate =
          health.recentFailureRate !== undefined
            ? `${Math.round((1 - health.recentFailureRate) * 100)}% reachability`
            : "";
        const obs = health.observations ? ` (${health.observations} checks)` : "";
        evidence =
          [rate, obs].filter(Boolean).join("") ||
          (health.status === "healthy" ? "Operational" : health.status);
      } else if (id === "allmanga") {
        evidence = "Epoch 2965 verified (build 186)";
      } else if (id === "youtube") {
        evidence = "Google Suggestions + Invidious pool ready";
      } else {
        evidence = manifest?.recommended ? "Recommended tier ready" : "Alternative provider";
      }
    }

    return {
      id,
      name: manifest?.displayName ?? meta.name ?? id,
      lane,
      recommended: manifest?.recommended ?? false,
      disabled,
      isActive,
      status,
      latencyMs,
      httpStatus,
      capabilities: formatCapabilities(manifest),
      description: manifest?.description ?? meta.description ?? "",
      domain: manifest?.domain ?? meta.domain,
      checkedAt: override?.checkedAt ?? health?.checkedAt,
      evidence,
      observations: health?.observations,
      consecutiveFailures: health?.consecutiveFailures,
    };
  });

  const healthyCount = entries.filter((e) => !e.disabled && e.status === "healthy").length;
  const degradedCount = entries.filter((e) => !e.disabled && e.status === "degraded").length;
  const downCount = entries.filter((e) => !e.disabled && e.status === "down").length;
  const disabledCount = entries.filter((e) => e.disabled).length;

  return {
    entries,
    totalCount: entries.length,
    healthyCount,
    degradedCount,
    downCount,
    disabledCount,
  };
}

export async function probeSingleProvider(
  providerId: string,
  container: Container,
  signal?: AbortSignal,
): Promise<{
  status: "healthy" | "degraded" | "down";
  latencyMs: number;
  httpStatus?: number;
  evidence: string;
}> {
  // SAFETY: providerId is registered in providerRegistry matching ProviderId
  const typedId = providerId as ProviderId;
  // SAFETY: key membership verified before indexed access
  const probeConfig = Object.hasOwn(PROVIDER_PROBE_ENDPOINTS, providerId)
    ? PROVIDER_PROBE_ENDPOINTS[providerId as keyof typeof PROVIDER_PROBE_ENDPOINTS]
    : undefined;
  const url =
    probeConfig?.url ??
    `https://${container.providerRegistry.get(providerId)?.metadata.domain ?? `${providerId}.com`}`;
  const startTime = performance.now();

  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
        : AbortSignal.timeout(5000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        ...probeConfig?.headers,
      },
    });

    const latencyMs = Math.round(performance.now() - startTime);
    const httpStatus = response.status;

    let status: "healthy" | "degraded" | "down" = "healthy";
    let evidence = `HTTP ${httpStatus} (${latencyMs}ms)`;

    if (httpStatus >= 200 && httpStatus < 400) {
      status = latencyMs > 2500 ? "degraded" : "healthy";
      evidence = `HTTP ${httpStatus} OK · ${latencyMs}ms response`;
    } else if (httpStatus === 403 || httpStatus === 429) {
      status = "degraded";
      evidence = `HTTP ${httpStatus} · Shield/rate limited (${latencyMs}ms)`;
    } else {
      status = "down";
      evidence = `HTTP ${httpStatus} error (${latencyMs}ms)`;
    }

    container.providerHealth.set({
      providerId: typedId,
      status,
      checkedAt: new Date().toISOString(),
      medianResolveMs: latencyMs,
      observations: (container.providerHealth.get(typedId)?.observations ?? 0) + 1,
      consecutiveFailures:
        status === "healthy"
          ? 0
          : (container.providerHealth.get(typedId)?.consecutiveFailures ?? 0) + 1,
    });

    return { status, latencyMs, httpStatus, evidence };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - startTime);
    const errorMsg = err instanceof Error ? err.message : String(err);
    const isTimeout = /timed? out|abort/i.test(errorMsg);
    const status: "healthy" | "degraded" | "down" = "down";
    const evidence = isTimeout
      ? `Connection timed out (>5000ms)`
      : `Network unreachable: ${errorMsg.slice(0, 30)}`;

    container.providerHealth.set({
      providerId: typedId,
      status: "down",
      checkedAt: new Date().toISOString(),
      medianResolveMs: latencyMs,
      consecutiveFailures: (container.providerHealth.get(typedId)?.consecutiveFailures ?? 0) + 1,
    });

    return { status, latencyMs, evidence };
  }
}
