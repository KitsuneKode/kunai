import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import {
  applyHotfixToProviderBootstrap,
  getActiveProviderHotfixManifest,
} from "@/services/providers/provider-hotfix-manifest";
import { createProviderPrioritySnapshot } from "@/services/providers/provider-priority";
import type { ProviderPriorityInput } from "@kunai/core";

/** What reloading the registry needs: raw config and the registry's priority setter. */
export interface ProviderRegistryHotfixTarget {
  readonly config: { readonly getRaw: () => KitsuneConfig };
  readonly providerRegistry: {
    readonly setPriority: (
      input: ProviderPriorityInput & { readonly disabledProviderIds?: readonly string[] },
    ) => void;
  };
}

export type ExpiryScheduler = (task: () => void, delayMs: number) => () => void;

/** setTimeout's ceiling (~24.8 days); a longer wait re-arms on wake. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

const defaultExpiryScheduler: ExpiryScheduler = (task, delayMs) => {
  const timer = setTimeout(task, delayMs);
  // Never hold the process open just to tidy the registry.
  timer.unref?.();
  return () => clearTimeout(timer);
};

let cancelExpiryRefresh: (() => void) | null = null;

/**
 * Push the effective provider policy (user priority + active manifest) into the
 * registry, and arm one refresh for the manifest's `expiresAt`. Playback reads
 * the expiry-aware manifest on every resolve; the registry holds a copy, so
 * without the timer it kept manifest-disabled providers hidden in pickers
 * after expiry until an unrelated settings change.
 */
export function reloadProviderRegistryPriority(
  container: ProviderRegistryHotfixTarget,
  options: { readonly schedule?: ExpiryScheduler; readonly nowMs?: () => number } = {},
): void {
  const raw = container.config.getRaw();
  const manifest = getActiveProviderHotfixManifest(options.nowMs?.());
  const effective = applyHotfixToProviderBootstrap(
    createProviderPrioritySnapshot(raw),
    raw.disabledProviders,
    manifest,
  );
  container.providerRegistry.setPriority({
    ...effective.priority,
    disabledProviderIds: effective.disabledProviderIds,
  });

  cancelExpiryRefresh?.();
  cancelExpiryRefresh = null;
  if (!manifest) return;
  const expiresAtMs = Date.parse(manifest.expiresAt);
  if (!Number.isFinite(expiresAtMs)) return;
  const now = options.nowMs?.() ?? Date.now();
  const delayMs = Math.min(Math.max(expiresAtMs - now + 1_000, 0), MAX_TIMER_DELAY_MS);
  cancelExpiryRefresh = (options.schedule ?? defaultExpiryScheduler)(
    () => reloadProviderRegistryPriority(container, options),
    delayMs,
  );
}
