import { scrubbedChildEnv } from "./child-env";
import {
  curlArgvHead,
  curlTransportArgs,
  isCloudflareChallengeText,
  resolveCurlCandidate,
} from "./curl-impersonate";
import { TTLCache } from "./provider-cache";
import { createTimeoutSignal } from "./timeout-signal";
import { CHROME_124_USER_AGENT } from "./user-agent";

export { resolveCurlCandidate as resolveAnidbCurl } from "./curl-impersonate";

const ANIDB_BASE = "https://anidb.app";
const ANIDB_REFERER = "https://anidb.app/";
const ANIDB_USER_AGENT = CHROME_124_USER_AGENT;

/** curl reports the final status after redirects; the body keeps the rest. */
const ANIDB_STATUS_WRITE_OUT = ["-w", "\n%{http_code}"] as const;

function splitAnidbStatus(stdout: string): { readonly body: string; readonly status: number } {
  const cut = stdout.lastIndexOf("\n");
  if (cut < 0) return { body: "", status: Number.parseInt(stdout, 10) || 0 };
  const status = Number.parseInt(stdout.slice(cut + 1), 10);
  return { body: stdout.slice(0, cut), status: Number.isFinite(status) ? status : 0 };
}

const ANIDB_CURL_TIMEOUT_EXIT_CODE = 28;

/** curl killed by SIGINT / SIGTERM — 128 + signal number. */
const ANIDB_CURL_SIGINT_EXIT_CODE = 130;
const ANIDB_CURL_SIGTERM_EXIT_CODE = 143;

/**
 * AniDB TTFB from constrained networks sits close to the curl budget, so a lone
 * timed-out attempt is usually transient congestion rather than a dead route.
 * Retry once on exit 28 (`--max-time` exceeded) only: every other exit code
 * (DNS, refused, TLS) fails deterministically and a retry would just double the
 * latency before the same error.
 */
export async function runAnidbCurlWithRetry(
  args: readonly string[],
  signal?: AbortSignal,
  spawnOnce: (
    args: readonly string[],
    signal?: AbortSignal,
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }> = defaultSpawnOnce,
): Promise<string> {
  let result = await spawnOnce(args, signal);
  if (result.exitCode === ANIDB_CURL_TIMEOUT_EXIT_CODE) {
    result = await spawnOnce(args, signal);
  }
  if (result.exitCode !== 0) {
    // Quitting kunai mid-resolve kills curl, and "curl exit 130" matches
    // neither "abort" nor "cancel", so the failure classifier read a plain
    // Ctrl-C as an unknown network fault: retryable, worth a fallback provider,
    // and logged at ERROR. Say cancelled in the one place that knows the
    // process was signalled, so the existing cancellation handling applies.
    if (signal?.aborted === true) throw signal.reason ?? new Error("anidb curl cancelled");
    if (
      result.exitCode === ANIDB_CURL_SIGINT_EXIT_CODE ||
      result.exitCode === ANIDB_CURL_SIGTERM_EXIT_CODE
    ) {
      throw new Error(`anidb curl cancelled (exit ${result.exitCode})`);
    }
    throw new Error(result.stderr.trim() || `curl exit ${result.exitCode}`);
  }
  return result.stdout;
}

function defaultSpawnOnce(
  args: readonly string[],
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([...args], {
    stdout: "pipe",
    stderr: "pipe",
    signal,
    env: scrubbedChildEnv(),
  });
  return Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).then(([stdout, stderr, exitCode]) => ({ stdout, stderr, exitCode }));
}

const malCache = new TTLCache<string, number | null>(3_600_000, { maxEntries: 512 });

function isUnusableAnidbPage(body: string): boolean {
  return isCloudflareChallengeText(body) || /under maintenance/i.test(body);
}

async function fetchAnimePage(showId: string, signal?: AbortSignal): Promise<string | undefined> {
  const url = `${ANIDB_BASE}/anime/${encodeURIComponent(showId)}`;
  const curl = resolveCurlCandidate();
  if (!curl) {
    const response = await fetch(url, {
      headers: { "User-Agent": ANIDB_USER_AGENT, Referer: ANIDB_REFERER },
      signal: createTimeoutSignal(signal, 15_000),
    });
    const body = await response.text();
    return response.ok && !isUnusableAnidbPage(body) ? body : undefined;
  }
  const stdout = await runAnidbCurlWithRetry(
    [
      ...curlArgvHead(curl),
      "-sL",
      "-A",
      ANIDB_USER_AGENT,
      "-H",
      `Referer: ${ANIDB_REFERER}`,
      "--max-time",
      "12",
      ...(await curlTransportArgs(curl, url, signal)),
      ...ANIDB_STATUS_WRITE_OUT,
      "--",
      url,
    ],
    signal,
  );
  const { body, status } = splitAnidbStatus(stdout);
  return status < 400 && !isUnusableAnidbPage(body) ? body : undefined;
}

export async function fetchAnidbMalId(
  showId: string,
  signal?: AbortSignal,
): Promise<number | undefined> {
  const cached = malCache.get(showId);
  if (cached !== undefined) return cached ?? undefined;

  try {
    const page = await fetchAnimePage(showId, signal);
    if (page === undefined) return undefined;
    const malId = Number(/https:\/\/myanimelist\.net\/anime\/(\d+)/.exec(page)?.[1]);
    const result = Number.isFinite(malId) && malId > 0 ? malId : null;
    malCache.set(showId, result);
    return result ?? undefined;
  } catch {
    // A transport failure is not evidence that the show has no MAL link.
    return undefined;
  }
}

/** Test hook: the MAL cache lives in module state and outlives a test file. */
export function clearAnidbCachesForTest(): void {
  malCache.clear();
}

/** Historic AniDB catalog ids are `slug-<numeric>`; persisted providerNativeIds keep them. */
function anidbNumericId(showId: string): number | null {
  const match = /-(\d+)$/.exec(showId.trim());
  if (!match?.[1]) return null;
  const numeric = Number(match[1]);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

export function looksLikeAnidbShowId(value: string | undefined): value is string {
  if (!value?.trim()) return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*-\d+$/i.test(value.trim()) && anidbNumericId(value) !== null;
}
