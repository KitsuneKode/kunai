import { createHash } from "node:crypto";
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
import { createDeadlineSignal, type ProviderPriorityInput } from "@kunai/core";
import {
  canonicalizeManifestPayload,
  describeAllMangaCryptoOverrideProblem,
  isSafeManifestHttpsUrl,
  setActiveProviderHotfixManifest,
  verifySignedProviderManifest,
  type ProviderHotfixManifest,
  type SignedProviderManifestEnvelope,
} from "@kunai/providers";
import { isJsonNumber, isJsonObject, isJsonString, type JsonValue } from "@kunai/types";

import { defaultManifestUrl, pinnedManifestPublicKeys } from "./provider-manifest-pin";

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
        // Every path below either takes the lock or waits on the deadline: an
        // unlink that keeps failing (EPERM on Windows while another process holds
        // the file, or a directory at the lock path) must not spin forever.
        let stale = false;
        try {
          const lockStat = statSync(lockPath);
          if (lockStat.isDirectory()) {
            throw new Error(`Provider manifest lock path is a directory: ${lockPath}`, {
              cause: error,
            });
          }
          stale = Date.now() - lockStat.mtimeMs > MANIFEST_LOCK_STALE_MS;
        } catch (statError) {
          if (
            statError instanceof Error &&
            statError.message.startsWith("Provider manifest lock path")
          ) {
            throw statError;
          }
          // Vanished between open and stat: retry after the short wait below.
        }
        if (stale) {
          try {
            unlinkSync(lockPath);
            continue;
          } catch {
            // Could not clear it; fall through to the deadline.
          }
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

/**
 * What survives a cache purge. `highestRevision` + `payloadSha256` pin the body
 * of the highest revision ever installed, so a different body re-signed under
 * the same revision is refused even after the cache file is gone. `hold` is set
 * by `providers rollback` / `providers reset`: the background refresh honours it
 * so neither is silently undone, and an explicit `providers update` clears it.
 */
export interface ProviderManifestStateFile {
  readonly highestRevision: number | null;
  readonly payloadSha256: string | null;
  readonly hold: "rollback" | "reset" | null;
}

export function readProviderManifestState(statePath: string): ProviderManifestStateFile {
  const empty: ProviderManifestStateFile = {
    highestRevision: null,
    payloadSha256: null,
    hold: null,
  };
  if (!existsSync(statePath)) return empty;
  try {
    const parsed = parseJsonPayload(readFileSync(statePath, "utf8"));
    if (!isJsonObject(parsed)) return empty;
    const revision =
      isJsonNumber(parsed.highestRevision) &&
      Number.isInteger(parsed.highestRevision) &&
      parsed.highestRevision >= 1
        ? parsed.highestRevision
        : null;
    const sha =
      isJsonString(parsed.payloadSha256) && /^[0-9a-f]{64}$/.test(parsed.payloadSha256)
        ? parsed.payloadSha256
        : null;
    const hold = parsed.hold === "rollback" || parsed.hold === "reset" ? parsed.hold : null;
    return { highestRevision: revision, payloadSha256: sha, hold };
  } catch {
    return empty;
  }
}

async function writeProviderManifestState(
  statePath: string,
  state: ProviderManifestStateFile,
  nowMs: number,
): Promise<void> {
  await writeAtomicJson(statePath, { ...state, updatedAt: new Date(nowMs).toISOString() });
}

function manifestPayloadSha256(manifest: ProviderHotfixManifest): string {
  return createHash("sha256").update(canonicalizeManifestPayload(manifest)).digest("hex");
}

export function resolveTrustedManifestPublicKeys(
  explicit?: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  if (explicit && Object.keys(explicit).length > 0) return explicit;
  const raw = process.env.KUNAI_PROVIDER_MANIFEST_PUBKEYS?.trim();
  if (!raw) return pinnedManifestPublicKeys();
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
  // Runs on every launch: refuse an oversized (damaged) cache from its size on
  // disk, before reading and decoding it.
  try {
    if (statSync(path).size > MAX_MANIFEST_BYTES) {
      return { status: "invalid", path, reason: "Cached manifest exceeds size limit" };
    }
  } catch {
    return { status: "invalid", path, reason: "Could not read cached manifest" };
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
  if (!verified.ok) return { status: "invalid", path, reason: verified.reason };
  return {
    status: "active",
    path,
    keyId: verified.keyId,
    signature: verified.signature,
    manifest: verified.manifest,
  };
}

async function releaseUnreadBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

async function readResponseTextBounded(response: Response, maxBytes: number): Promise<string> {
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader) {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > maxBytes) {
      await releaseUnreadBody(response);
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
  /** Background refresh: refuse while `providers rollback`/`reset` holds updates. */
  readonly respectHold?: boolean;
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
  const deadline = createDeadlineSignal(undefined, timeoutMs);

  let parsed: JsonValue;
  try {
    const response = await fetchFn(options.url, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: deadline.signal,
    });
    if (!response.ok) {
      await releaseUnreadBody(response);
      return {
        status: "rejected",
        path,
        reason: `Manifest fetch failed with HTTP ${response.status}`,
      };
    }
    const text = await readResponseTextBounded(response, maxBytes);
    parsed = parseJsonPayload(text);
  } catch (error) {
    const detail = deadline.signal.aborted
      ? `Manifest fetch timed out after ${timeoutMs}ms`
      : error instanceof Error
        ? error.message
        : String(error);
    return { status: "rejected", path, reason: `Manifest fetch failed: ${detail}` };
  } finally {
    deadline.release();
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

  const cryptoProblem = describeAllMangaCryptoOverrideProblem(
    verified.manifest.providers.allanime?.cryptoOverrides,
  );
  if (cryptoProblem) {
    return { status: "rejected", path, reason: cryptoProblem };
  }

  return withManifestLock(statePath, async (): Promise<ProviderManifestUpdateResult> => {
    const existing = loadCachedProviderHotfixManifest({
      path,
      trustedPublicKeysById: trusted,
      nowMs: options.nowMs,
    });
    const previousRevision = existing.status === "active" ? existing.manifest.revision : null;
    const priorState = readProviderManifestState(statePath);
    const highWaterRevision = priorState.highestRevision;
    const floorRevision = Math.max(previousRevision ?? 0, highWaterRevision ?? 0);
    const incomingSha256 = manifestPayloadSha256(verified.manifest);

    if (options.respectHold && priorState.hold) {
      return {
        status: "rejected",
        path,
        reason: `Held by providers ${priorState.hold}; run \`kunai providers update\` to resume updates`,
      };
    }

    if (floorRevision > 0 && !options.force) {
      if (
        highWaterRevision !== null &&
        verified.manifest.revision === highWaterRevision &&
        priorState.payloadSha256 !== null &&
        priorState.payloadSha256 !== incomingSha256
      ) {
        return {
          status: "rejected",
          path,
          reason: `Conflicting manifest payload for already-seen revision ${highWaterRevision}`,
        };
      }
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
    // Pin the body of the high-water revision. Installing below it (only with
    // --force lowering the floor, or when it equals the floor) keeps the pin
    // describing whichever payload owns `nextHighWater`.
    const nextSha256 =
      nextHighWater === verified.manifest.revision ? incomingSha256 : priorState.payloadSha256;
    await writeProviderManifestState(
      statePath,
      { highestRevision: nextHighWater, payloadSha256: nextSha256, hold: null },
      options.nowMs ?? Date.now(),
    );

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
    // Hold: without it the next background refresh re-fetches the newer
    // revision and silently undoes the rollback.
    await writeProviderManifestState(
      statePath,
      { ...readProviderManifestState(statePath), hold: "rollback" },
      options.nowMs ?? Date.now(),
    );
    return { ok: true, path, keyId: backupState.keyId, manifest: backupState.manifest };
  });
}

export async function resetCachedProviderHotfixManifest(
  options: {
    readonly path?: string;
    readonly statePath?: string;
    readonly includeBackup?: boolean;
    readonly nowMs?: number;
  } = {},
): Promise<ResetProviderManifestResult> {
  const path = options.path ?? providerManifestCachePath();
  const statePath = providerManifestStatePath(options.path, options.statePath);
  return withManifestLock(statePath, async () => {
    let removed = false;
    if (existsSync(path)) {
      unlinkSync(path);
      removed = true;
    }
    if (options.includeBackup) {
      const backup = providerManifestBackupPath(path);
      if (existsSync(backup)) unlinkSync(backup);
    }
    // Bundled defaults until the user asks for an update. Without the hold the
    // next launch's background refresh reinstalls the published manifest. A
    // plain reset keeps the revision floor and body pin; --force drops them.
    const prior = options.includeBackup
      ? { highestRevision: null, payloadSha256: null }
      : readProviderManifestState(statePath);
    await writeProviderManifestState(
      statePath,
      {
        highestRevision: prior.highestRevision,
        payloadSha256: prior.payloadSha256,
        hold: "reset",
      },
      options.nowMs ?? Date.now(),
    );
    return { removed, path };
  });
}

/**
 * When a provider just went down locally, a fix may already be published:
 * check sooner than the 6-hour background interval. Still throttled (at most
 * one check per window per process, and the cache-age gate), still opt-in
 * (needs a manifest URL and trusted keys), and still a no-op offline.
 */
export const URGENT_REFRESH_MIN_INTERVAL_MS = 15 * 60 * 1000;
let lastUrgentRefreshAtMs = Number.NEGATIVE_INFINITY;

export function resetUrgentProviderManifestRefreshForTest(): void {
  lastUrgentRefreshAtMs = Number.NEGATIVE_INFINITY;
}

export async function maybeUrgentProviderManifestRefresh(
  options: Parameters<typeof maybeBackgroundRefreshProviderManifest>[0] = {},
): Promise<"skipped" | "updated" | "unchanged" | "failed"> {
  const nowMs = options.nowMs ?? Date.now();
  if (nowMs - lastUrgentRefreshAtMs < URGENT_REFRESH_MIN_INTERVAL_MS) return "skipped";
  const outcome = await maybeBackgroundRefreshProviderManifest({
    ...options,
    nowMs,
    minIntervalMs: URGENT_REFRESH_MIN_INTERVAL_MS,
  });
  // Only a real attempt consumes the window. A skip (no URL or keys, or a
  // cache still inside its gate) made no request; consuming the window there
  // would hide a provider that stays down until the next 6-hour check.
  if (outcome !== "skipped") lastUrgentRefreshAtMs = nowMs;
  return outcome;
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
  const url = options.url ?? defaultManifestUrl();
  const trusted = resolveTrustedManifestPublicKeys(options.trustedPublicKeysById);
  if (!url || Object.keys(trusted).length === 0) return "skipped";

  const path = options.path ?? providerManifestCachePath();
  const nowMs = options.nowMs ?? Date.now();
  const minIntervalMs = options.minIntervalMs ?? BACKGROUND_REFRESH_INTERVAL_MS;
  if (readProviderManifestState(providerManifestStatePath(options.path)).hold) return "skipped";

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
    respectHold: true,
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
