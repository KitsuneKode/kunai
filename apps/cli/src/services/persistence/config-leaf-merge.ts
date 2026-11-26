/**
 * Leaf-level merging for nested config objects such as `sync`.
 *
 * A config key is the unit of "dirty", but `sync` holds independent choices
 * (per-tracker enabled / trackWatched / syncList, pause). Two writers that each
 * changed one leaf must not overwrite the other's by persisting a whole object
 * built from an older snapshot (Sol review #2). These helpers name the leaves a
 * change touched and replay only those onto a newer base.
 */

import { isJsonObject, type LooseJsonValue } from "@kunai/types";

/** A path of property names from a config key's value down to one leaf. */
export type LeafPath = readonly string[];

type LooseJsonObject = { readonly [key: string]: LooseJsonValue };

/** Config values are JSON documents; this is the one place that view is taken. */
function asJson<T>(value: T): LooseJsonValue {
  // SAFETY: every config value round-trips through JSON.stringify/parse on disk.
  return value as LooseJsonValue;
}

function asObject(value: LooseJsonValue): LooseJsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

/** True for a nested settings object (not an array, not a primitive). */
export function isNestedConfigValue<T>(value: T): boolean {
  return asObject(asJson(value)) !== undefined;
}

/**
 * Every leaf that differs between two values. Objects recurse; anything else
 * (arrays, primitives, a type change) is one leaf compared by JSON, which is
 * how config is persisted.
 */
export function changedLeafPaths<T>(previous: T, next: T): LeafPath[] {
  return leafDiff(asJson(previous), asJson(next), []);
}

function leafDiff(previous: LooseJsonValue, next: LooseJsonValue, prefix: LeafPath): LeafPath[] {
  const before = asObject(previous);
  const after = asObject(next);
  if (before && after) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].flatMap((key) => leafDiff(before[key], after[key], [...prefix, key]));
  }
  return JSON.stringify(previous) === JSON.stringify(next) ? [] : [prefix];
}

/**
 * `base` with each path's value taken from `source`, deleting a leaf `source`
 * no longer has. Neither input is mutated. An empty path means the whole value.
 */
export function applyLeafPaths<T>(base: T, source: T, paths: readonly LeafPath[]): T {
  const from = asJson(source);
  let result = structuredClone(asJson(base));
  for (const path of paths) result = withLeaf(result, path, readLeaf(from, path));
  // SAFETY: only leaves of `source` (a T) were written into a clone of `base` (a T).
  return result as T;
}

function readLeaf(value: LooseJsonValue, path: LeafPath): LooseJsonValue {
  let current = value;
  for (const key of path) current = asObject(current)?.[key];
  return current;
}

function withLeaf(target: LooseJsonValue, path: LeafPath, value: LooseJsonValue): LooseJsonValue {
  const [head, ...rest] = path;
  if (head === undefined) return structuredClone(value);
  const { [head]: current, ...siblings } = asObject(target) ?? {};
  const child = withLeaf(current, rest, value);
  return child === undefined ? siblings : { ...siblings, [head]: child };
}

/** Merge newly changed leaves into what a key has already accumulated. */
function mergeLeafPaths(
  existing: readonly LeafPath[] | undefined,
  added: readonly LeafPath[],
): LeafPath[] {
  const seen = new Map((existing ?? []).map((path) => [JSON.stringify(path), path]));
  for (const path of added) seen.set(JSON.stringify(path), path);
  return [...seen.values()];
}

/**
 * Which leaves of each nested config key this process changed. A key absent
 * here, or marked whole, persists whole — the old per-key behaviour. Keys that
 * own a vaulted secret (`youtubeMetadata`, `providerRelay`) always stay whole:
 * their secret preservation is handled separately and must not be merged.
 */
export class DirtyConfigLeaves<C extends object> {
  private readonly leaves = new Map<keyof C, LeafPath[] | "whole">();

  constructor(private readonly wholeOnlyKeys: ReadonlySet<keyof C>) {}

  markWhole(key: keyof C): void {
    this.leaves.set(key, "whole");
  }

  /** Record an `update()` of `key` from `previous` to `next`. */
  record<K extends keyof C>(key: K, previous: C[K], next: C[K]): void {
    const existing = this.leaves.get(key);
    if (
      existing === "whole" ||
      this.wholeOnlyKeys.has(key) ||
      !isNestedConfigValue(previous) ||
      !isNestedConfigValue(next)
    ) {
      this.leaves.set(key, "whole");
      return;
    }
    this.leaves.set(key, mergeLeafPaths(existing, changedLeafPaths(previous, next)));
  }

  /**
   * The value to persist for `key`: this process's changed leaves replayed onto
   * the key's value on disk, or its whole value when leaves are not tracked or
   * disk has no object to merge into.
   */
  persistedValue<K extends keyof C>(key: K, current: C[K], onDisk: C[K] | undefined): C[K] {
    const leaves = this.leaves.get(key);
    if (!Array.isArray(leaves) || onDisk === undefined || !isNestedConfigValue(onDisk)) {
      return current;
    }
    return applyLeafPaths(onDisk, current, leaves);
  }

  isLeafMerged(key: keyof C): boolean {
    return Array.isArray(this.leaves.get(key));
  }

  clear(key: keyof C): void {
    this.leaves.delete(key);
  }
}
