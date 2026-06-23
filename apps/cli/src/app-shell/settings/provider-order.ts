import type { KitsuneConfig } from "@/services/persistence/ConfigService";

function dedupeProviderOrder(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const id of ids) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    order.push(trimmed);
  }
  return order;
}

export function resolveSeriesProviderOrder(config: KitsuneConfig): string[] {
  return dedupeProviderOrder([config.provider, ...config.providerPriority]);
}

export function resolveAnimeProviderOrder(config: KitsuneConfig): string[] {
  return dedupeProviderOrder([config.animeProvider, ...config.animeProviderPriority]);
}

export function applySeriesProviderOrder(
  config: KitsuneConfig,
  order: readonly string[],
): KitsuneConfig {
  const normalized = dedupeProviderOrder(order);
  const first = normalized[0];
  if (!first) return config;
  return { ...config, provider: first, providerPriority: normalized.slice(1) };
}

export function applyAnimeProviderOrder(
  config: KitsuneConfig,
  order: readonly string[],
): KitsuneConfig {
  const normalized = dedupeProviderOrder(order);
  const first = normalized[0];
  if (!first) return config;
  return { ...config, animeProvider: first, animeProviderPriority: normalized.slice(1) };
}

export function moveProviderInOrder(
  order: readonly string[],
  providerId: string,
  direction: "up" | "down",
): string[] {
  const index = order.indexOf(providerId);
  if (index < 0) return [...order];
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= order.length) return [...order];
  const next = [...order];
  const current = next[index];
  const swap = next[target];
  if (!current || !swap) return [...order];
  next[index] = swap;
  next[target] = current;
  return next;
}

export function describeProviderOrder(order: readonly string[]): string {
  if (order.length === 0) return "none";
  return order.join(" → ");
}
