import type { ProviderCacheRepository } from "@kunai/storage";
import type { ProviderCachePort } from "@kunai/types";

/**
 * Back the provider cache port with the SQLite `provider_cache` table.
 *
 * The repository is synchronous (bun:sqlite), but the port is async so a future
 * backing store need not be. Every operation degrades to `null` / no-op on a
 * store error: a broken cache must slow a resolve down, never fail it. JSON is
 * the wire format, and `ttlMs` becomes an absolute `expiresAt` here so the
 * provider never has to know the clock.
 */
export function createProviderCachePort(
  repository: ProviderCacheRepository,
  now: () => Date = () => new Date(),
): ProviderCachePort {
  return {
    async read<T = unknown>(namespace: string, key: string): Promise<T | null> {
      try {
        const payload = repository.read(namespace, key, now());
        if (payload === null) return null;
        return JSON.parse(payload) as T;
      } catch {
        return null;
      }
    },
    async write(namespace: string, key: string, value: unknown, ttlMs: number): Promise<void> {
      try {
        const nowDate = now();
        const expiresAt = new Date(nowDate.getTime() + Math.max(0, ttlMs)).toISOString();
        repository.write(namespace, key, JSON.stringify(value), expiresAt, nowDate.toISOString());
      } catch {
        // A cache write must never fail the resolve that produced the value.
      }
    },
  };
}
