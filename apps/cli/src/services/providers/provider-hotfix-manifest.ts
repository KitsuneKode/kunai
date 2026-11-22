import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  utimesSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { writeAtomicJson } from "@/infra/fs/atomic-write";
import { getKunaiPaths } from "@/services/storage/storage-read-models";
import type { ProviderPriorityInput } from "@kunai/core";
import {
  canonicalizeManifestPayload,
  isSafeManifestHttpsUrl,
  setActiveProviderHotfixManifest,
  verifySignedProviderManifest,
  type ProviderHotfixManifest,
  type SignedProviderManifestEnvelope,
} from "@kunai/providers";
import { isJsonNumber, isJsonObject, isJsonString, type JsonValue } from "@kunai/types";

export const PROVIDER_MANIFEST_FILENAME = "providers-manifest.json";
export const PROVIDER_MANIFEST_BACKUP_FILENAME = "providers-manifest.prev.json";
export const PROVIDER_MANIFEST_STATE_FILENAME = "providers-manifest-state.json";
export const MAX_MANIFEST_BYTES = 256 * 1024;
export const MANIFEST_FETCH_TIMEOUT_MS = 10_000;
export const BACKGROUND_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type ManifestFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ProviderLaneGroups {
  readonly anime: readonly string[];
  readonly series: readonly string[];
  readonly youtube: readonly string[];
}

export interface ResetProviderManifestResult {
  readonly removed: boolean;
  readonly path: string;
}

export interface ProviderBootstrapHotfixResult {
  readonly priority: ProviderPriorityInput;
  readonly disabledProviderIds: readonly string[];
}

export type CachedProviderManifestState =
  | { readonly status: "absent"; readonly path: string }
  | {
      readonly status: "active";
      readonly path: string;
      readonly keyId: string;
      readonly signature: string;
      readonly manifest: ProviderHotfixManifest;
    }
  | { readonly status: "invalid"; readonly path: string; readonly reason: string };

export type ProviderManifestUpdateResult =
  | {
      readonly status: "updated" | "unchanged" | "dry-run";
      readonly path: string;
      readonly keyId: string;
      readonly manifest: ProviderHotfixManifest;
      readonly previousRevision: number | null;
      readonly backedUp: boolean;
    }
  | { readonly status: "rejected"; readonly path: string; readonly reason: string };

export function providerManifestCachePath(): string {
  return join(getKunaiPaths().cacheDir, PROVIDER_MANIFEST_FILENAME);
}

export function providerManifestBackupPath(cachePath?: string): string {
  if (!cachePath) return join(getKunaiPaths().cacheDir, PROVIDER_MANIFEST_BACKUP_FILENAME);
  return cachePath.endsWith(".json")
    ? cachePath.replace(/\.json$/, ".prev.json")
    : `${cachePath}.prev`;
}

/**
 * Persistent anti-rollback state path. Lives in `configDir` (not OS-purgeable
 * `cacheDir`) so clearing OS caches cannot reset the revision floor. When an
 * explicit `cachePath` is supplied (e.g. isolated tests), derives a sibling
 * file so tests never touch the user's real config directory.
 */
export function providerManifestStatePath(cachePath?: string, explicitStatePath?: string): string {
  if (explicitStatePath) return explicitStatePath;
  if (!cachePath || cachePath === providerManifestCachePath()) {
    return join(getKunaiPaths().configDir, PROVIDER_MANIFEST_STATE_FILENAME);
  }
  return cachePath.endsWith(".json")
    ? cachePath.replace(/\.json$/, ".state.json")
    : `${cachePath}.state.json`;
}

export function groupProvidersByLane(
  modules: readonly {
    readonly manifest: { readonly id: string; readonly mediaKinds: readonly string[] };
  }[],
): ProviderLaneGroups {
  const anime: string[] = [];
  const series: string[] = [];
  const youtube: string[] = [];
  for (const mod of modules) {
    if (mod.manifest.mediaKinds.includes("anime")) anime.push(mod.manifest.id);
    else if (mod.manifest.mediaKinds.includes("video")) youtube.push(mod.manifest.id);
    else series.push(mod.manifest.id);
  }
  return { anime, series, youtube };
}

const MANIFEST_LOCK_STALE_MS = 30_000;
const MANIFEST_LOCK_TIMEOUT_MS = 5_000;
const inProcessManifestLocks = new Map<string, Promise<void>>();

async function withManifestLock<T>(statePath: string, run: () => Promise<T>): Promise<T> {
  const previous = inProcessManifestLocks.get(statePath) ?? Promise.resolve();
  let releaseInProcess: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    releaseInProcess = resolve;
  });
  const chained = previous.then(() => current);
  inProcessManifestLocks.set(statePath, chained);
  await previous;

  const lockPath = `${statePath}.lock`;
  let lockFd: number | null = null;
  try {
    mkdirSync(dirname(lockPath), { recursive: true });
    const deadline = Date.now() + MANIFEST_LOCK_TIMEOUT_MS;
    while (lockFd === null) {
      try {
        lockFd = openSync(lockPath, "wx");
      } catch (error) {
        const code = error instanceof Error && "code" in error ? error.code : undefined;
        if (code !== "EEXIST") throw error;
        try {
          const ageMs = Date.now() - statSync(lockPath).mtimeMs;
          if (ageMs > MANIFEST_LOCK_STALE_MS) {
            unlinkSync(lockPath);
            continue;
          }
        } catch {
          continue;
        }
        if (Date.now() >= deadline) {
          throw new Error("Timed out waiting for provider manifest lock", { cause: error });
        }
        await Bun.sleep(15);
      }
    }
    return await run();
  } finally {
    if (lockFd !== null) {
      try {
        closeSync(lockFd);
      } catch {
        // Ignore close failure on cleanup.
      }
      try {
        unlinkSync(lockPath);
      } catch {
        // Ignore unlink race on cleanup.
      }
    }
    releaseInProcess();
    if (inProcessManifestLocks.get(statePath) === chained) {
      inProcessManifestLocks.delete(statePath);
    }
  }
}

function parseJsonPayload(text: string): JsonValue {
  // SAFETY: JSON.parse returns standard JSON values conforming to JsonValue.
  return JSON.parse(text) as JsonValue;
}

function readManifestHighWaterRevision(statePath: string): number | null {
  if (!existsSync(statePath)) return null;
  try {
    const parsed = parseJsonPayload(readFileSync(statePath, "utf8"));
    if (
      isJsonObject(parsed) &&
      isJsonNumber(parsed.highestRevision) &&
      Number.isInteger(parsed.highestRevision) &&
      parsed.highestRevision >= 1
    ) {
      return parsed.highestRevision;
    }
    return null;
  } catch {
    return null;
  }
}

export function resolveTrustedManifestPublicKeys(
  explicit?: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  if (explicit && Object.keys(explicit).length > 0) return explicit;
  const raw = process.env.KUNAI_PROVIDER_MANIFEST_PUBKEYS?.trim();
  if (!raw) return {};
  try {
    const parsed = parseJsonPayload(raw);
    if (!isJsonObject(parsed)) return {};
    const entries: [string, string][] = [];
    for (const [keyId, pem] of Object.entries(parsed)) {
      if (isJsonString(pem) && pem.trim().length > 0) {
        entries.push([keyId, pem]);
      }
    }
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

export function loadCachedProviderHotfixManifest(
  options: {
    readonly path?: string;
    readonly trustedPublicKeysById?: Readonly<Record<string, string>>;
    readonly nowMs?: number;
  } = {},
): CachedProviderManifestState {
  const path = options.path ?? providerManifestCachePath();
  if (!existsSync(path)) return { status: "absent", path };
  const trusted = resolveTrustedManifestPublicKeys(options.trustedPublicKeysById);
  if (Object.keys(trusted).length === 0) {
    return { status: "invalid", path, reason: "No trusted manifest signing keys configured" };
  }
  let rawText: string;
  try {
    rawText = readFileSync(path, "utf8");
  } catch {
    return { status: "invalid", path, reason: "Could not read cached manifest" };
  }
  if (Buffer.byteLength(rawText, "utf8") > MAX_MANIFEST_BYTES) {
    return { status: "invalid", path, reason: "Cached manifest exceeds size limit" };
  }
  let parsed: JsonValue;
  try {
    parsed = parseJsonPayload(rawText);
  } catch {
    return { status: "invalid", path, reason: "Cached manifest is not valid JSON" };
  }
  const verified = verifySignedProviderManifest(parsed, trusted, options.nowMs);
  if (!verified.ok) {
    return { status: "invalid", path, reason: verified.reason };
  }
  return {
    status: "active",
    path,
    keyId: verified.keyId,
    signature: verified.signature,
    manifest: verified.manifest,
  };
}

async function readResponseTextBounded(response: Response, maxBytes: number): Promise<string> {
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader) {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(`Manifest exceeds maximum size (${maxBytes} bytes)`);
    }
  }
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new Error(`Manifest exceeds maximum size (${maxBytes} bytes)`);
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Manifest exceeds maximum size (${maxBytes} bytes)`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(combined);
}

function checkManifestDoesNotBrickAnyLane(
  manifest: ProviderHotfixManifest,
  knownProvidersByLane:
    | Readonly<Record<string, readonly string[]>>
    | ProviderLaneGroups
    | undefined,
): string | null {
  if (!knownProvidersByLane) return null;
  for (const [lane, ids] of Object.entries(knownProvidersByLane)) {
    if (!Array.isArray(ids) || ids.length === 0) continue;
    const allDisabled = ids.every((id: string) => manifest.providers[id]?.disabled === true);
    if (allDisabled) {
      return `Manifest would disable every provider in the "${lane}" lane`;
    }
  }
  return null;
}

export async function fetchAndCacheProviderHotfixManifest(options: {
  readonly url: string;
  readonly trustedPublicKeysById?: Readonly<Record<string, string>>;
  readonly path?: string;
  readonly statePath?: string;
  readonly nowMs?: number;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly dryRun?: boolean;
  readonly force?: boolean;
  readonly knownProvidersByLane?: Readonly<Record<string, readonly string[]>> | ProviderLaneGroups;
  readonly fetchImpl?: ManifestFetch;
}): Promise<ProviderManifestUpdateResult> {
  const path = options.path ?? providerManifestCachePath();
  const statePath = providerManifestStatePath(options.path, options.statePath);
  if (!isSafeManifestHttpsUrl(options.url)) {
    return {
      status: "rejected",
      path,
      reason: "Manifest URL must be a public HTTPS URL without credentials",
    };
  }
  const trusted = resolveTrustedManifestPublicKeys(options.trustedPublicKeysById);
  if (Object.keys(trusted).length === 0) {
    return {
      status: "rejected",
      path,
      reason:
        "No trusted Ed25519 manifest public keys configured (set KUNAI_PROVIDER_MANIFEST_PUBKEYS)",
    };
  }

  const fetchFn: ManifestFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? MANIFEST_FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_MANIFEST_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let parsed: JsonValue;
  try {
    const response = await fetchFn(options.url, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        status: "rejected",
        path,
        reason: `Manifest fetch failed with HTTP ${response.status}`,
      };
    }
    const text = await readResponseTextBounded(response, maxBytes);
    parsed = parseJsonPayload(text);
  } catch (error) {
    const detail = controller.signal.aborted
      ? `Manifest fetch timed out after ${timeoutMs}ms`
      : error instanceof Error
        ? error.message
        : String(error);
    return { status: "rejected", path, reason: `Manifest fetch failed: ${detail}` };
  } finally {
    clearTimeout(timer);
  }

  const verified = verifySignedProviderManifest(parsed, trusted, options.nowMs);
  if (!verified.ok) {
    return { status: "rejected", path, reason: verified.reason };
  }

  const brickReason = checkManifestDoesNotBrickAnyLane(
    verified.manifest,
    options.knownProvidersByLane,
  );
  if (brickReason) {
    return { status: "rejected", path, reason: brickReason };
  }

  return withManifestLock(statePath, async (): Promise<ProviderManifestUpdateResult> => {
    const existing = loadCachedProviderHotfixManifest({
      path,
      trustedPublicKeysById: trusted,
      nowMs: options.nowMs,
    });
    const previousRevision = existing.status === "active" ? existing.manifest.revision : null;
    const highWaterRevision = readManifestHighWaterRevision(statePath);
    const floorRevision = Math.max(previousRevision ?? 0, highWaterRevision ?? 0);

    if (floorRevision > 0 && !options.force) {
      if (verified.manifest.revision < floorRevision) {
        return {
          status: "rejected",
          path,
          reason: `Manifest revision downgrade rejected (highest seen rev ${floorRevision} > incoming rev ${verified.manifest.revision})`,
        };
      }
      if (
        existing.status === "active" &&
        previousRevision !== null &&
        verified.manifest.revision === previousRevision
      ) {
        const incomingCanonical = Buffer.from(canonicalizeManifestPayload(verified.manifest));
        const existingCanonical = Buffer.from(canonicalizeManifestPayload(existing.manifest));
        if (!incomingCanonical.equals(existingCanonical)) {
          return {
            status: "rejected",
            path,
            reason: `Conflicting manifest payload for already-installed revision ${previousRevision}`,
          };
        }
        return {
          status: "unchanged",
          path,
          keyId: verified.keyId,
          manifest: verified.manifest,
          previousRevision,
          backedUp: false,
        };
      }
    }

    if (options.dryRun) {
      return {
        status: "dry-run",
        path,
        keyId: verified.keyId,
        manifest: verified.manifest,
        previousRevision,
        backedUp: false,
      };
    }

    let backedUp = false;
    if (existing.status === "active" && existsSync(path)) {
      const previousEnvelope: SignedProviderManifestEnvelope = {
        keyId: existing.keyId,
        signature: existing.signature,
        manifest: existing.manifest,
      };
      await writeAtomicJson(providerManifestBackupPath(path), previousEnvelope);
      backedUp = true;
    }

    const envelope: SignedProviderManifestEnvelope = {
      keyId: verified.keyId,
      signature: verified.signature,
      manifest: verified.manifest,
    };
    await writeAtomicJson(path, envelope);
    const nextHighWater = options.force
      ? verified.manifest.revision
      : Math.max(floorRevision, verified.manifest.revision);
    await writeAtomicJson(statePath, {
      highestRevision: nextHighWater,
      updatedAt: new Date(options.nowMs ?? Date.now()).toISOString(),
    });

    return {
      status: "updated",
      path,
      keyId: verified.keyId,
      manifest: verified.manifest,
      previousRevision,
      backedUp,
    };
  });
}

export async function rollbackCachedProviderHotfixManifest(
  options: {
    readonly path?: string;
    readonly statePath?: string;
    readonly trustedPublicKeysById?: Readonly<Record<string, string>>;
    readonly nowMs?: number;
  } = {},
): Promise<
  | {
      readonly ok: true;
      readonly path: string;
      readonly keyId: string;
      readonly manifest: ProviderHotfixManifest;
    }
  | { readonly ok: false; readonly path: string; readonly reason: string }
> {
  const path = options.path ?? providerManifestCachePath();
  const statePath = providerManifestStatePath(options.path, options.statePath);
  return withManifestLock(statePath, async () => {
    const backupPath = providerManifestBackupPath(path);
    const backupState = loadCachedProviderHotfixManifest({
      path: backupPath,
      trustedPublicKeysById: options.trustedPublicKeysById,
      nowMs: options.nowMs,
    });
    if (backupState.status !== "active") {
      return {
        ok: false,
        path,
        reason:
          backupState.status === "absent"
            ? "No previous verified manifest backup exists to roll back to"
            : `Backup manifest failed verification: ${backupState.reason}`,
      };
    }
    const backupEnvelope: SignedProviderManifestEnvelope = {
      keyId: backupState.keyId,
      signature: backupState.signature,
      manifest: backupState.manifest,
    };
    await writeAtomicJson(path, backupEnvelope);
    return { ok: true, path, keyId: backupState.keyId, manifest: backupState.manifest };
  });
}

export function resetCachedProviderHotfixManifest(
  options: {
    readonly path?: string;
    readonly statePath?: string;
    readonly includeBackup?: boolean;
  } = {},
): ResetProviderManifestResult {
  const path = options.path ?? providerManifestCachePath();
  let removed = false;
  if (existsSync(path)) {
    unlinkSync(path);
    removed = true;
  }
  if (options.includeBackup) {
    const backup = providerManifestBackupPath(path);
    if (existsSync(backup)) unlinkSync(backup);
    const state = providerManifestStatePath(options.path, options.statePath);
    if (existsSync(state)) unlinkSync(state);
  }
  return { removed, path };
}

/**
 * Throttled, opt-in background manifest check. Runs only when both a manifest
 * URL and trusted Ed25519 public keys are configured, skips if the cached file
 * is fresher than `minIntervalMs`, and fails silently offline.
 */
export async function maybeBackgroundRefreshProviderManifest(
  options: {
    readonly url?: string;
    readonly trustedPublicKeysById?: Readonly<Record<string, string>>;
    readonly path?: string;
    readonly nowMs?: number;
    readonly minIntervalMs?: number;
    readonly knownProvidersByLane?:
      | Readonly<Record<string, readonly string[]>>
      | ProviderLaneGroups;
    readonly fetchImpl?: ManifestFetch;
  } = {},
): Promise<"skipped" | "updated" | "unchanged" | "failed"> {
  const url = options.url ?? process.env.KUNAI_PROVIDER_MANIFEST_URL?.trim();
  const trusted = resolveTrustedManifestPublicKeys(options.trustedPublicKeysById);
  if (!url || Object.keys(trusted).length === 0) return "skipped";

  const path = options.path ?? providerManifestCachePath();
  const nowMs = options.nowMs ?? Date.now();
  const minIntervalMs = options.minIntervalMs ?? BACKGROUND_REFRESH_INTERVAL_MS;

  if (existsSync(path)) {
    try {
      const ageMs = nowMs - statSync(path).mtimeMs;
      if (ageMs >= 0 && ageMs < minIntervalMs) return "skipped";
    } catch {
      // Proceed to refresh if stat fails.
    }
  }

  const result = await fetchAndCacheProviderHotfixManifest({
    url,
    trustedPublicKeysById: trusted,
    path: options.path,
    nowMs,
    knownProvidersByLane: options.knownProvidersByLane,
    fetchImpl: options.fetchImpl,
  });
  if (result.status === "updated") {
    setActiveProviderHotfixManifest(result.manifest);
    return "updated";
  }
  if (result.status === "unchanged") {
    try {
      const now = new Date(nowMs);
      utimesSync(path, now, now);
    } catch {
      // Best-effort mtime refresh for throttle window.
    }
    return "unchanged";
  }
  return "failed";
}

function mergeLanePriority(
  userOrder: readonly string[],
  hotfixOrder: readonly string[] | undefined,
  disabledSet: ReadonlySet<string>,
): readonly string[] {
  if (!hotfixOrder || hotfixOrder.length === 0) return userOrder;
  const lead = userOrder[0];
  const combined = [
    ...(lead && !disabledSet.has(lead) ? [lead] : []),
    ...hotfixOrder,
    ...userOrder,
  ];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of combined) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

export { getActiveProviderHotfixManifest, setActiveProviderHotfixManifest } from "@kunai/providers";

export function applyHotfixToProviderBootstrap(
  priority: ProviderPriorityInput,
  disabledProviders: readonly string[],
  manifest: ProviderHotfixManifest | null | undefined,
): ProviderBootstrapHotfixResult {
  if (!manifest) {
    return { priority, disabledProviderIds: disabledProviders };
  }
  const disabledSet = new Set(disabledProviders);
  for (const [providerId, entry] of Object.entries(manifest.providers)) {
    if (entry.disabled) disabledSet.add(providerId);
  }
  return {
    priority: {
      providerPriority: mergeLanePriority(
        priority.providerPriority,
        manifest.lanePriorities?.series ?? manifest.lanePriorities?.movie,
        disabledSet,
      ),
      animeProviderPriority: mergeLanePriority(
        priority.animeProviderPriority,
        manifest.lanePriorities?.anime,
        disabledSet,
      ),
      youtubeProviderPriority: mergeLanePriority(
        priority.youtubeProviderPriority ?? [],
        manifest.lanePriorities?.youtube,
        disabledSet,
      ),
    },
    disabledProviderIds: [...disabledSet],
  };
}
