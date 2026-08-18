const DEFAULT_INSTANCES_URL = "https://api.invidious.io/instances.json?sort_by=type,health,api";
const INSTANCE_COOLDOWN_MS = 5 * 60 * 1000;

type InvidiousInstanceRecord = {
  readonly uri?: string;
  readonly api?: boolean;
};

type CachedInstances = {
  readonly fetchedAt: number;
  readonly instances: readonly string[];
};

let cachedInstances: CachedInstances | null = null;
const cooldownUntil = new Map<string, number>();

export type InvidiousInstancePoolOptions = {
  readonly instancesUrl?: string;
  readonly preferredInstanceUrl?: string;
  readonly now?: () => number;
  readonly signal?: AbortSignal;
};

export async function fetchHealthyInvidiousInstances(
  options: InvidiousInstancePoolOptions = {},
): Promise<readonly string[]> {
  const now = options.now?.() ?? Date.now();
  pruneExpiredCooldowns(now);
  if (options.preferredInstanceUrl?.trim()) {
    const preferred = normalizeInstanceUrl(options.preferredInstanceUrl);
    if ((cooldownUntil.get(preferred) ?? 0) <= now) {
      return [preferred];
    }
  }

  if (cachedInstances && now - cachedInstances.fetchedAt < 15 * 60 * 1000) {
    return filterAvailableInstances(cachedInstances.instances, now);
  }

  const response = await fetch(options.instancesUrl ?? DEFAULT_INSTANCES_URL, {
    headers: { Accept: "application/json" },
    signal: options.signal,
  });
  if (!response.ok) {
    throw new Error(`Invidious instance list failed (${response.status})`);
  }

  const payload = (await response.json()) as readonly (readonly [
    string,
    InvidiousInstanceRecord,
  ])[];
  const instances = selectReachableInstances(payload);

  cachedInstances = { fetchedAt: now, instances };
  return filterAvailableInstances(instances, now);
}

export function markInvidiousInstanceFailure(instanceUrl: string, now = Date.now()): void {
  cooldownUntil.set(normalizeInstanceUrl(instanceUrl), now + INSTANCE_COOLDOWN_MS);
}

export async function pickInvidiousInstance(
  options: InvidiousInstancePoolOptions = {},
): Promise<string> {
  const instances = await fetchHealthyInvidiousInstances(options);
  if (instances.length === 0) {
    throw new Error("No healthy Invidious instances available");
  }
  const [instance] = instances;
  if (!instance) {
    throw new Error("No healthy Invidious instances available");
  }
  return instance;
}

/** Overlay networks a plain machine has no route to; reaching them needs a proxy we never spawn. */
const UNREACHABLE_HOST_SUFFIXES = [".onion", ".i2p", ".ygg"] as const;

function isReachableInstance(url: string): boolean {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    host = parsed.hostname.toLowerCase();
  } catch {
    return false;
  }
  return !UNREACHABLE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * Pick the instances worth trying, reachability first.
 *
 * Upstream's `api` flag is not dependable in either direction: as of 2026-08 every
 * working clearnet instance reports `api: false` while the `api: true`/`null` entries
 * are Tor, I2P and Yggdrasil addresses. Filtering on `api` alone therefore yielded a
 * pool of exclusively unroutable hosts, and each search burned three 15s timeouts
 * before falling back. So reachability is the hard filter and `api` is only a
 * preference — applied when it actually selects something, ignored when it does not,
 * which keeps this correct whichever way upstream flips next.
 */
function selectReachableInstances(
  payload: readonly (readonly [string, InvidiousInstanceRecord])[],
): readonly string[] {
  const reachable = payload
    .map(([host, meta]) => ({ url: normalizeInstanceUrl(meta?.uri?.trim() || host), meta }))
    .filter((entry) => isReachableInstance(entry.url));
  const apiEnabled = reachable.filter((entry) => entry.meta?.api === true);
  const selected = apiEnabled.length > 0 ? apiEnabled : reachable;
  return [...new Set(selected.map((entry) => entry.url))];
}

function filterAvailableInstances(instances: readonly string[], now: number): readonly string[] {
  return instances.filter((instance) => (cooldownUntil.get(instance) ?? 0) <= now);
}

function pruneExpiredCooldowns(now: number): void {
  for (const [instance, until] of cooldownUntil) {
    if (until <= now) cooldownUntil.delete(instance);
  }
}

function normalizeInstanceUrl(value: string): string {
  const trimmedInput = value.trim();
  let end = trimmedInput.length;
  while (end > 0 && trimmedInput.charCodeAt(end - 1) === 47) end -= 1;
  const trimmed = trimmedInput.slice(0, end);
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `https://${trimmed}`;
}
