/**
 * Shared curl / curl-impersonate resolution for Cloudflare-fronted providers.
 *
 * Cloudflare fingerprints the TLS handshake, so a browser User-Agent over
 * plain curl's handshake is frequently still challenged. Where an impersonate
 * build exists we use it.
 *
 * Candidates are **discovered from PATH**, not listed here. A hardcoded
 * allowlist was the previous design and it rotted exactly as you would expect:
 * it named `curl_firefox135` / `curl_chrome136` and so kept selecting a stale
 * fingerprint on a machine carrying `curl_chrome150` and `curl_firefox147`,
 * while `curl_ff117` — lwthiker-era naming the maintained lexiforest fork never
 * ships — could never match at all. Upstream documents the wrapper naming as
 * `curl_<browser><version>[_os]`, so the shape is stable even though the
 * versions turn over every few weeks; discovery tracks it without edits.
 */
import { readdirSync } from "node:fs";
import { delimiter as PATH_DELIMITER, join } from "node:path";

export type CurlCandidate = {
  readonly path: string;
  readonly impersonates: boolean;
  /**
   * Browser profile of the selected impersonate build (`chrome150`), or `null`
   * for plain curl. Carried so capability reporting can distinguish "a curl" from
   * "a curl that clears Cloudflare" instead of collapsing both to a green tick.
   */
  readonly profile: string | null;
};

/**
 * Seam for PATH inspection. Tests supply their own so a ranking assertion does
 * not depend on what happens to be installed on the machine running them.
 */
export type CurlEnvironment = {
  /** Absolute-path lookup for a bare command name. */
  readonly which: (command: string) => string | null;
  /** Executable basenames visible on PATH, in PATH order. */
  readonly listPathEntries: () => readonly string[];
};

/**
 * Desktop families only, most-camouflaged first.
 *
 * Chrome leads because it carries the largest share of real browser traffic, so
 * its fingerprint is the least remarkable thing a WAF can see. Mobile builds
 * (`_android`, `_ios`) are deliberately excluded: a desktop CLI presenting a
 * phone's handshake is a mismatch a fingerprinter can notice. `curl_tor*` is
 * excluded for the same reason, more so.
 */
const FAMILY_RANK = ["chrome", "firefox", "ff", "safari", "edge"] as const;

/**
 * `curl_chrome150`, `curl_chrome133a`, `curl_firefox147`, `curl_safari260_ios`.
 *
 * The Windows release ships its wrappers as `.bat` around `curl-impersonate.exe`
 * — there are no extensionless wrappers in that archive at all — so matching
 * only `.exe` meant no Windows install could ever be discovered, however
 * correctly the user had set it up. `.cmd` is accepted alongside it because a
 * repackager may ship either.
 */
const WRAPPER_PATTERN = /^curl_([a-z]+?)(\d+)([a-z]*)(?:_(android|ios))?(?:\.(?:exe|bat|cmd))?$/i;

type ParsedWrapper = {
  readonly name: string;
  readonly family: string;
  readonly version: number;
  readonly revision: string;
};

function parseWrapper(entry: string): ParsedWrapper | null {
  const match = WRAPPER_PATTERN.exec(entry);
  if (!match) return null;
  const [, rawFamily = "", rawVersion = "", revision = "", mobile] = match;
  if (mobile) return null;
  const family = rawFamily.toLowerCase();
  if (!FAMILY_RANK.includes(family as (typeof FAMILY_RANK)[number])) return null;
  const version = Number.parseInt(rawVersion, 10);
  if (!Number.isFinite(version)) return null;
  return { name: entry, family, version, revision: revision.toLowerCase() };
}

/**
 * Best build wins within a family, then the most-camouflaged family wins.
 *
 * Ranking across families numerically would be meaningless — Safari's `260`
 * and Chrome's `150` do not live on one scale — so family is the outer key.
 */
function betterThan(a: ParsedWrapper, b: ParsedWrapper): boolean {
  const rankA = FAMILY_RANK.indexOf(a.family as (typeof FAMILY_RANK)[number]);
  const rankB = FAMILY_RANK.indexOf(b.family as (typeof FAMILY_RANK)[number]);
  if (rankA !== rankB) return rankA < rankB;
  if (a.version !== b.version) return a.version > b.version;
  return a.revision > b.revision;
}

function readPathEntries(): readonly string[] {
  // Windows environment variables are case-insensitive to the OS but not to
  // `process.env` in every runtime, and `Path` is the conventional casing there.
  const raw = process.env.PATH ?? process.env.Path ?? "";
  const entries: string[] = [];
  for (const dir of raw.split(PATH_DELIMITER)) {
    if (!dir) continue;
    try {
      for (const entry of readdirSync(dir)) {
        // Cheap prefix gate before the regex — a PATH directory can hold
        // thousands of entries and this runs on the capability-probe path.
        if (entry.startsWith("curl_")) entries.push(entry);
      }
    } catch {
      // An unreadable or absent PATH directory is normal, not an error.
    }
  }
  return entries;
}

/**
 * PATH does not change under a running process, and this is read from the
 * capability probe as well as from two providers, so the scan is paid once.
 * Injected environments bypass the cache — a test must never see another
 * test's PATH.
 */
let cachedPathEntries: readonly string[] | null = null;

function defaultListPathEntries(): readonly string[] {
  cachedPathEntries ??= readPathEntries();
  return cachedPathEntries;
}

/**
 * ani-cli sets cipher flags only on Darwin, and that restriction is
 * load-bearing: Windows `curl.exe` links Schannel, which rejects
 * `--tls13-ciphers` and does not understand OpenSSL cipher names, so passing
 * them there fails the request outright instead of hardening it.
 */
const CURL_CIPHERS =
  "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305";
const CURL_TLS13_CIPHERS =
  "TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256";

/**
 * An impersonate build already ships a matching handshake, so forcing
 * ani-cli's cipher list over it would undo the fingerprint it exists to
 * provide.
 */
export function curlCipherArgs(
  impersonates: boolean,
  platform: NodeJS.Platform = process.platform,
): readonly string[] {
  if (impersonates || platform !== "darwin") return [];
  return ["--ciphers", CURL_CIPHERS, "--tls13-ciphers", CURL_TLS13_CIPHERS];
}

export function resolveCurlCandidate(
  environment: Partial<CurlEnvironment> = {},
): CurlCandidate | null {
  const which = environment.which ?? ((command: string) => Bun.which(command));
  const listPathEntries = environment.listPathEntries ?? defaultListPathEntries;

  let best: ParsedWrapper | null = null;
  for (const entry of listPathEntries()) {
    const parsed = parseWrapper(entry);
    if (!parsed) continue;
    if (!best || betterThan(parsed, best)) best = parsed;
  }

  if (best) {
    const resolved = which(best.name);
    if (resolved) {
      return {
        path: resolved,
        impersonates: true,
        profile: `${best.family}${best.version}${best.revision}`,
      };
    }
  }

  const plain = which("curl");
  return plain ? { path: plain, impersonates: false, profile: null } : null;
}

export function isCloudflareChallengeText(text: string): boolean {
  return /just a moment/i.test(text);
}

/** Test-only: drop the memoized PATH scan. */
export const __testing = {
  resetPathCache(): void {
    cachedPathEntries = null;
  },
  parseWrapper,
  readPathEntries,
  /** Absolute path a discovered wrapper would resolve to, for probe seams. */
  joinPathEntry: join,
};
