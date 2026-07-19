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
  const instances = payload
    .map(([host, meta]) => {
      if (meta?.api === false) return null;
      return normalizeInstanceUrl(host);
    })
    .filter((value): value is string => Boolean(value));

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
