export type StreamHealthStrategy = "none" | "hls-manifest-get" | "head-then-range";

export type StreamHealthPolicyInput = {
  readonly url?: string | null;
  readonly cachedAt?: number | null;
  readonly now?: number;
  readonly staleAfterMs?: number;
};

export type StreamHealthPolicyDecision = {
  readonly shouldCheck: boolean;
  readonly strategy: StreamHealthStrategy;
  readonly reason: "no-cache" | "fresh" | "stale-hls" | "stale-direct";
  readonly ageMs?: number;
};

const DEFAULT_STALE_AFTER_MS = 2 * 60 * 60 * 1000;

export function resolveStreamHealthPolicy(
  input: StreamHealthPolicyInput,
): StreamHealthPolicyDecision {
  if (!input.url || input.cachedAt === undefined || input.cachedAt === null) {
    return { shouldCheck: false, strategy: "none", reason: "no-cache" };
  }

  const now = input.now ?? Date.now();
  const ageMs = Math.max(0, now - input.cachedAt);
  const staleAfterMs = input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  if (ageMs <= staleAfterMs) {
    return { shouldCheck: false, strategy: "none", reason: "fresh", ageMs };
  }

  if (isLikelyHlsManifest(input.url)) {
    return { shouldCheck: true, strategy: "hls-manifest-get", reason: "stale-hls", ageMs };
  }

  return { shouldCheck: true, strategy: "head-then-range", reason: "stale-direct", ageMs };
}

function isLikelyHlsManifest(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".m3u8");
  } catch {
    return url.toLowerCase().split("?")[0]?.endsWith(".m3u8") ?? false;
  }
}
