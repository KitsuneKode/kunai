/**
 * Which hosts to send Miruro pipe requests to, and in what order.
 *
 * Every Miruro backend is reached through `/api/secure/pipe` on one of these
 * hosts, so this list is the anime lane's single point of failure. It has three
 * layers, each covering a failure the one before cannot:
 *
 * 1. **A static list, verified by hand**, so a cold start never waits on
 *    anything. All four served the pipe on 2026-09-11.
 * 2. **Miruro's own status page** (Uptime Kuma, public JSON), read in the
 *    background and cached. It names mirrors Kunai has not heard of yet, and
 *    reports which ones are down from its vantage point. A mirror it calls down
 *    is moved to the back, never dropped: its vantage point is not the user's.
 * 3. **The mirror that answered last goes first.** Reachability to individual
 *    mirrors flaps on some networks — the same host timed out, failed fast and
 *    answered within minutes of each other on 2026-09-11 — and once one works,
 *    the rest of the session should not pay to rediscover that.
 */

export const MIRURO_KNOWN_PIPE_BASE_URLS = [
  "https://www.miruro.bz",
  "https://www.miruro.ru",
  "https://www.miruro.to",
  "https://www.miruro.tv",
] as const;

export const MIRURO_STATUS_PAGE_URL = "https://status.miruro.com/api/status-page/miruro";
export const MIRURO_STATUS_HEARTBEAT_URL =
  "https://status.miruro.com/api/status-page/heartbeat/miruro";

/**
 * Only `miruro.<tld>` names are accepted from the status page. It is a remote
 * document, and a name that is not one of Miruro's own hosts must never become a
 * place Kunai sends requests.
 */
const MIRROR_NAME = /^miruro\.[a-z]{2,12}$/;

/** In the status page's "mirrors" group, but serves a landing page with no pipe. */
const NON_PIPE_MIRRORS = new Set(["miruro.com"]);

const STATUS_TTL_MS = 30 * 60_000;
const STATUS_TIMEOUT_MS = 4_000;

export type MiruroMirrorStatus = {
  readonly name: string;
  /** Latest heartbeat from the status page; `null` when it has none. */
  readonly up: boolean | null;
};

type StatusFetch = (input: string, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the "mirrors" group out of an Uptime Kuma status page and its heartbeat
 * document. Anything malformed yields fewer mirrors, never an exception — this
 * feeds a fallback path and must not be able to break it.
 */
export function parseMiruroStatusMirrors(page: unknown, heartbeat: unknown): MiruroMirrorStatus[] {
  if (!isRecord(page) || !Array.isArray(page.publicGroupList)) return [];
  const beats =
    isRecord(heartbeat) && isRecord(heartbeat.heartbeatList) ? heartbeat.heartbeatList : {};

  const mirrors: MiruroMirrorStatus[] = [];
  for (const group of page.publicGroupList) {
    if (!isRecord(group) || group.name !== "mirrors" || !Array.isArray(group.monitorList)) continue;
    for (const monitor of group.monitorList) {
      if (!isRecord(monitor)) continue;
      const name = typeof monitor.name === "string" ? monitor.name.trim().toLowerCase() : "";
      if (!MIRROR_NAME.test(name) || NON_PIPE_MIRRORS.has(name)) continue;
      const history = beats[String(monitor.id)];
      const latest = Array.isArray(history) ? history.at(-1) : undefined;
      const status = isRecord(latest) ? latest.status : undefined;
      mirrors.push({ name, up: status === 1 ? true : status === 0 ? false : null });
    }
  }
  return mirrors;
}

/**
 * Known mirrors first in their fixed order, then any the status page added.
 * Mirrors it reports down go to the back. The last mirror that answered leads.
 */
export function orderMiruroPipeBaseUrls(input: {
  readonly known: readonly string[];
  readonly discovered: readonly MiruroMirrorStatus[];
  readonly lastSuccess?: string | null;
}): string[] {
  const reportedDown = new Set(
    input.discovered.filter((mirror) => mirror.up === false).map((m) => `https://www.${m.name}`),
  );
  const all = [
    ...new Set([...input.known, ...input.discovered.map((mirror) => `https://www.${mirror.name}`)]),
  ];
  const ordered = [
    ...all.filter((url) => !reportedDown.has(url)),
    ...all.filter((url) => reportedDown.has(url)),
  ];
  const last = input.lastSuccess;
  if (last && ordered.includes(last)) {
    return [last, ...ordered.filter((url) => url !== last)];
  }
  return ordered;
}

let discovered: { readonly mirrors: readonly MiruroMirrorStatus[]; readonly at: number } | null =
  null;
let refreshing: Promise<void> | null = null;
let lastSuccessBaseUrl: string | null = null;

async function refreshMiruroStatus(fetchImpl: StatusFetch, now: number): Promise<void> {
  try {
    const read = async (url: string) => {
      const response = await fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as unknown;
    };
    const [page, heartbeat] = await Promise.all([
      read(MIRURO_STATUS_PAGE_URL),
      read(MIRURO_STATUS_HEARTBEAT_URL),
    ]);
    discovered = { mirrors: parseMiruroStatusMirrors(page, heartbeat), at: now };
  } catch {
    // Keep what we had and wait out the TTL: a status page that is down must
    // not be re-asked on every pipe call, and the static list still works.
    discovered = { mirrors: discovered?.mirrors ?? [], at: now };
  }
}

/**
 * The pipe base URLs to try, in order. Never waits on the network: a stale or
 * missing status snapshot starts a background refresh and the current best list
 * is returned immediately.
 */
export function miruroPipeBaseUrls(
  options: { readonly now?: number; readonly fetchImpl?: StatusFetch } = {},
): string[] {
  const now = options.now ?? Date.now();
  if ((!discovered || now - discovered.at > STATUS_TTL_MS) && !refreshing) {
    refreshing = refreshMiruroStatus(options.fetchImpl ?? fetch, now).finally(() => {
      refreshing = null;
    });
  }
  return orderMiruroPipeBaseUrls({
    known: MIRURO_KNOWN_PIPE_BASE_URLS,
    discovered: discovered?.mirrors ?? [],
    lastSuccess: lastSuccessBaseUrl,
  });
}

/** Called when a mirror returns a decodable pipe body. */
export function recordMiruroMirrorSuccess(baseUrl: string): void {
  lastSuccessBaseUrl = baseUrl;
}

/** Test-only seams. Module state is process-wide, so every test resets it. */
export const __testing = {
  reset(): void {
    discovered = null;
    refreshing = null;
    lastSuccessBaseUrl = null;
  },
  /** Resolves once any background status refresh has settled. */
  settle(): Promise<void> {
    return refreshing ?? Promise.resolve();
  },
};
