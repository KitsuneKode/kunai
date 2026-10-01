import {
  parseRetryAfterHeader,
  providerHttpErrorForStatus,
  type ProviderRuntimeContext,
} from "@kunai/types";

import { providerFetch } from "../runtime/fetch";
import { EndpointResilienceTracker } from "../shared/provider-cache";
import { ProviderQueryCache } from "../shared/provider-query";
import { createTimeoutSignal } from "../shared/timeout-signal";
import { YOUTUBE_PROVIDER_ID } from "./manifest";

const DEFAULT_INSTANCES_URL = "https://api.invidious.io/instances.json?sort_by=type,health,api";
const INSTANCE_COOLDOWN_MS = 5 * 60 * 1000;
/**
 * The registry lookup is the only fetch on the search path that was unbounded —
 * every Invidious data request already carries `INVIDIOUS_FETCH_TIMEOUT_MS`, but
 * this one inherited whatever the caller passed, which is often nothing. A hung
 * registry then stalls search itself, before a single instance is even tried.
 * Shorter than the data timeout on purpose: this is a lookup standing between
 * the user and their results, and a stale cache or the static fallback is a far
 * better answer than waiting.
 */
const INSTANCE_REGISTRY_TIMEOUT_MS = 5_000;

type InvidiousInstanceRecord = {
  readonly uri?: string;
  readonly api?: boolean;
};

/**
 * An empty registry page is not the same failure as an unreachable one — it
 * still routes through the stale-pool fallback, but a caller with no previous
 * pool must see `[]` (empty), not a thrown fetch error.
 */
class EmptyInstancePoolError extends Error {}

/**
 * Keyed by registry URL, not a single slot.
 *
 * Production uses one URL, so a bare variable worked — but it meant any change
 * of `instancesUrl` silently answered from the previous registry's pool, and it
 * made every test in a file share one cache entry regardless of the URL each
 * one served. `staleIfError` is the "a broken or empty registry still names
 * instances that very likely work" rule.
 */
const instanceRegistry = new ProviderQueryCache<string, readonly string[]>({
  ttlMs: 15 * 60 * 1000,
  // A stale pool is a better answer than an error — except when the "error" is
  // the caller walking away, which is not a fetch failure worth masking.
  staleIfError: (_error, call) => call?.signal?.aborted !== true,
  maxEntries: 8,
});
/**
 * Instance cooldowns — one failed request parks an instance for the policy
 * window. Single-strike is right here: the pool always has more instances to
 * substitute, so a sick one earns nothing by being re-asked immediately.
 */
const instanceHealth = new EndpointResilienceTracker({
  cooldownMs: INSTANCE_COOLDOWN_MS,
  maxEntries: 256,
});

export type InvidiousInstancePoolOptions = {
  readonly instancesUrl?: string;
  readonly preferredInstanceUrl?: string;
  readonly now?: () => number;
  readonly signal?: AbortSignal;
  readonly context?: ProviderRuntimeContext;
};

export async function fetchHealthyInvidiousInstances(
  options: InvidiousInstancePoolOptions = {},
): Promise<readonly string[]> {
  const now = options.now?.() ?? Date.now();
  if (options.preferredInstanceUrl?.trim()) {
    const preferred = normalizeInstanceUrl(options.preferredInstanceUrl);
    if (instanceHealth.shouldTry(preferred, now)) {
      return [preferred];
    }
  }

  const instancesUrl = options.instancesUrl ?? DEFAULT_INSTANCES_URL;
  const instances = await instanceRegistry
    .query(
      instancesUrl,
      async () => {
        const response = await providerFetch(options.context, instancesUrl, {
          headers: { Accept: "application/json" },
          signal: createTimeoutSignal(options.signal, INSTANCE_REGISTRY_TIMEOUT_MS),
        });
        if (!response.ok) {
          throw providerHttpErrorForStatus({
            status: response.status,
            message: `Invidious instance list failed (${response.status})`,
            providerId: YOUTUBE_PROVIDER_ID,
            stage: "instance-list",
            retryAfterMs: parseRetryAfterHeader(response.headers.get("retry-after")),
          });
        }
        const payload = await response.json();
        // A 200 carrying the wrong shape (`{}`, an object, a string) is as
        // useless as a failed fetch — malformed data takes the same stale-pool
        // recovery path as a thrown request.
        if (!Array.isArray(payload)) {
          throw new Error("Invidious instance list returned an unexpected shape");
        }
        // SAFETY: Array.isArray narrows to any[]; selectReachableInstances
        // validates each row's shape before trusting the tuple fields.
        const selected = selectReachableInstances(
          payload as readonly (readonly [string, InvidiousInstanceRecord])[],
        );
        // An empty selection is not a healthy pool — caching it made
        // `pickInvidiousInstance` throw from a *cached* empty pool for 15
        // minutes, so YouTube stayed broken long after the registry recovered.
        // Throwing routes it through staleIfError like any other failure.
        if (selected.length === 0) {
          throw new EmptyInstancePoolError("registry listed no reachable instances");
        }
        return selected;
      },
      { at: now, signal: options.signal },
    )
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- rejection handler: the thrown value is genuinely untyped
    .catch((error: unknown) => {
      // The registry is a directory, not the service: an expired directory
      // still names instances that very likely still work, and a caller-aborted
      // fetch must never serve stale data as if it were fresh.
      if (options.signal?.aborted) throw error;
      if (error instanceof EmptyInstancePoolError) return [] satisfies readonly string[];
      throw error;
    });

  return filterAvailableInstances(instances, now);
}

export function markInvidiousInstanceFailure(instanceUrl: string, now = Date.now()): void {
  instanceHealth.recordFailure(normalizeInstanceUrl(instanceUrl), { at: now });
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
  return instances.filter((instance) => instanceHealth.shouldTry(instance, now));
}

function normalizeInstanceUrl(value: string): string {
  const trimmedInput = value.trim();
  let end = trimmedInput.length;
  while (end > 0 && trimmedInput.charCodeAt(end - 1) === 47) end -= 1;
  const trimmed = trimmedInput.slice(0, end);
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `https://${trimmed}`;
}
