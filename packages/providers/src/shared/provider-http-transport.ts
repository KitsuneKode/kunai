/**
 * Shared relay-aware text transport for Cloudflare-fronted providers.
 *
 * One choreography, per-provider policy:
 *
 *   context.fetch (carries the user relay) → curl/curl-impersonate → raw fetch
 *
 * The rules that must hold in every provider that adopts it:
 *
 * - A response the relay marked (`isRelayedResponse`) is final — re-asking the
 *   same URL direct would silently bypass the relay the user deployed (#460).
 *   `relayedStatusIsFinal` / `relayedChallengeIsFinal` exist for the two cases
 *   where that stops being true: a stale relay answering 404s of its own
 *   (anidb), and a challenge a local impersonate fingerprint can clear when
 *   the relay's could not (anidb).
 * - An unmarked response came back locally, so falling through to curl is the
 *   legitimate TLS-fingerprint bypass, not a relay dodge.
 * - A transport failure (DNS, refused, reset, timeout) is worth a second
 *   transport; a *caller* abort is not — `signal.aborted` short-circuits
 *   before curl is even spawned, so quitting mid-resolve never buys a curl
 *   request nobody is waiting on.
 *
 * Errors that leave this layer are typed: {@link ProviderHttpError} (or a
 * provider's subclass via `statusError`) for upstream statuses,
 * {@link ProviderRelayedUpstreamError} for final relay answers, and
 * {@link ProviderTransportError} for "no HTTP response" — so the cycle
 * classifier reads structure, never message prose (#458).
 */
import {
  blockedLiteralTargetReason,
  httpStatusIsRetryable,
  httpStatusToResolveErrorCode,
  isRelayedResponse,
  isRelayOwnedError,
  parseRetryAfterHeader,
  ProviderHttpError,
  providerHttpErrorForStatus,
  resolvedAddressBlockReason,
  type ProviderId,
  type ProviderRuntimeContext,
  type ResolveErrorCode,
} from "@kunai/types";

import { readResponseTextCapped, readStreamTextCapped } from "./bounded-body";
import {
  curlCipherArgs,
  isCloudflareChallengeText,
  resolveCurlCandidate,
  type CurlEnvironment,
} from "./curl-impersonate";
import { createGuardedFetch, PROVIDER_API_SENSITIVE_HEADERS } from "./stream-reachability";
import { createTimeoutSignal } from "./timeout-signal";

/**
 * The last-resort leg walks redirects through the same per-hop literal/DNS
 * blocklist as providerFetch — a bare fetch() would follow Location anywhere.
 * Hop 0 stays exempt for the same reason: provider endpoints are code-fixed
 * or user-configured.
 */
const guardedTransportFetch = createGuardedFetch({
  extraSensitiveHeaders: PROVIDER_API_SENSITIVE_HEADERS,
  allowInitialPrivateTarget: true,
});

/* ------------------------------------------------------------------------ */
/* Transport failure taxonomy                                               */
/* ------------------------------------------------------------------------ */

/**
 * Why a request never produced an HTTP response. The distinctions that matter
 * downstream:
 *
 * - `offline` — DNS resolution or route failure (ENOTFOUND, EAI_AGAIN,
 *   ENETUNREACH). The network cannot reach the host at all; retrying inside
 *   one resolve cannot heal it, so it classifies non-retryable.
 * - `refused` — TCP connect refused. The host answered the route and rejected
 *   the port — host-scoped evidence, not a global outage.
 * - `reset` — connection reset or premature close mid-response.
 * - `tls` — handshake/certificate failure.
 * - `timeout` — deadline expired before an answer arrived.
 * - `unknown` — anything else; kept retryable like today.
 */
export type ProviderTransportKind = "offline" | "refused" | "reset" | "timeout" | "tls" | "unknown";

/**
 * A fetch/curl failure that never reached an HTTP response, carrying the
 * granular kind so classification reads structure instead of message prose.
 * Extends {@link ProviderHttpError} so every existing
 * `instanceof ProviderHttpError` classifier sees it without a new case.
 */
export class ProviderTransportError extends ProviderHttpError {
  override readonly name = "ProviderTransportError";
  readonly transportKind: ProviderTransportKind;

  constructor(input: {
    readonly message: string;
    readonly transportKind: ProviderTransportKind;
    readonly providerId?: ProviderId | string;
    readonly stage?: string;
    readonly cause?: unknown;
  }) {
    super({
      message: input.message,
      providerId: input.providerId,
      stage: input.stage,
      code: transportKindToCode(input.transportKind),
      retryable: transportKindIsRetryable(input.transportKind),
      cause: input.cause,
    });
    this.transportKind = input.transportKind;
  }
}

export function transportKindToCode(kind: ProviderTransportKind): ResolveErrorCode {
  return kind === "timeout" ? "timeout" : "network-error";
}

export function transportKindIsRetryable(kind: ProviderTransportKind): boolean {
  // `offline` mirrors isOfflineNetworkFailure: a dead route is answered once,
  // not retried to the attempt cap.
  return kind !== "offline";
}

const OFFLINE_ERROR_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "ENETDOWN",
  "EHOSTUNREACH",
  "ERR_NAME_NOT_RESOLVED",
  "ERR_INTERNET_DISCONNECTED",
]);

const REFUSED_ERROR_CODES = new Set(["ECONNREFUSED"]);
const RESET_ERROR_CODES = new Set(["ECONNRESET", "EPIPE", "UND_ERR_SOCKET", "UND_ERR_CLOSED"]);
const TIMEOUT_ERROR_CODES = new Set([
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);
const TLS_ERROR_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

/**
 * Read the transport kind out of a thrown fetch error. Runtime `fetch` wraps
 * the real socket error in `TypeError: fetch failed` with the errno on
 * `error.cause` (or `cause.errors` for an AggregateError), so the walk goes
 * through `cause` chains rather than trusting the outer name/message.
 */
/* oxlint-disable anti-slop/no-runtime-typeof anti-slop/no-unknown-parameters -- errno/transport probes: runtimes hide socket codes behind untyped cause chains, so the duck-typed walks below ARE the boundary parse */

export function transportKindFromFetchError(error: unknown): ProviderTransportKind {
  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  const code = findErrorCode(error);
  if (code) {
    if (OFFLINE_ERROR_CODES.has(code)) return "offline";
    if (REFUSED_ERROR_CODES.has(code)) return "refused";
    if (RESET_ERROR_CODES.has(code)) return "reset";
    if (TIMEOUT_ERROR_CODES.has(code)) return "timeout";
    if (TLS_ERROR_CODES.has(code)) return "tls";
  }
  // Runtimes that hide the errno still put a signature phrase in the message
  // chain — sniff it as the last resort so offline stays non-retryable.
  if (messageChainIncludes(error, ["enotfound", "eai_again", "enetunreach", "ehostunreach"])) {
    return "offline";
  }
  if (messageChainIncludes(error, ["econnrefused", "connection refused"])) return "refused";
  if (messageChainIncludes(error, ["econnreset", "connection reset", "socket hang up"])) {
    return "reset";
  }
  if (messageChainIncludes(error, ["timed out", "etimedout"])) return "timeout";
  if (messageChainIncludes(error, ["certificate", "ssl", "tls"])) return "tls";
  return "unknown";
}

function findErrorCode(error: unknown, depth = 0): string | undefined {
  if (depth > 4 || typeof error !== "object" || error === null) return undefined;
  // SAFETY: object-guarded above; carrier fields are probed as unknown.
  const record = error as { code?: unknown; cause?: unknown; errors?: unknown };
  if (typeof record.code === "string" && /^[A-Z_]+$/i.test(record.code)) {
    return record.code.toUpperCase();
  }
  if (Array.isArray(record.errors)) {
    for (const inner of record.errors) {
      const found = findErrorCode(inner, depth + 1);
      if (found) return found;
    }
  }
  return findErrorCode(record.cause, depth + 1);
}

function messageChainIncludes(error: unknown, needles: readonly string[]): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const message =
      current instanceof Error ? current.message : typeof current === "string" ? current : "";
    const lower = message.toLowerCase();
    if (needles.some((needle) => lower.includes(needle))) return true;
    current =
      typeof current === "object" && current !== null
        ? // SAFETY: object-guarded in the condition; `cause` is probed as unknown.
          (current as { cause?: unknown }).cause
        : undefined;
  }
  return false;
}

/* oxlint-enable anti-slop/no-runtime-typeof anti-slop/no-unknown-parameters */

/** curl exit codes → transport kind. `-w %{http_code}` keeps HTTP statuses off
 * this path; a nonzero exit here always means "no HTTP response". */
export function transportKindFromCurlExit(exitCode: number): ProviderTransportKind {
  switch (exitCode) {
    case 5: // CURLE_COULDNT_RESOLVE_PROXY
    case 6: // CURLE_COULDNT_RESOLVE_HOST
      return "offline";
    case 7: // CURLE_COULDNT_CONNECT
      return "refused";
    case 28: // CURLE_OPERATION_TIMEDOUT
      return "timeout";
    case 35: // CURLE_SSL_CONNECT_ERROR
    case 51: // CURLE_PEER_FAILED_VERIFICATION (older numbering)
    case 58: // CURLE_SSL_CERTPROBLEM
    case 59: // CURLE_SSL_CIPHER
    case 60: // CURLE_PEER_FAILED_VERIFICATION
    case 77: // CURLE_SSL_CACERT_BADFILE
    case 83: // CURLE_SSL_ISSUER_ERROR
    case 90: // CURLE_SSL_ENGINE_* / pinned pubkey
    case 91: // CURLE_SSL_INVALIDCERTSTATUS
      return "tls";
    case 52: // CURLE_GOT_NOTHING
    case 55: // CURLE_SEND_ERROR
    case 56: // CURLE_RECV_ERROR
      return "reset";
    default:
      return "unknown";
  }
}

/* ------------------------------------------------------------------------ */
/* Relayed-answer sentinel                                                  */
/* ------------------------------------------------------------------------ */

/**
 * The relay answered for this request and the answer is final. Carries the
 * upstream status through ProviderHttpError so a relayed 5xx classifies as
 * `candidate-server-error` instead of reading as a generic blip.
 */
export class ProviderRelayedUpstreamError extends ProviderHttpError {
  override readonly name = "ProviderRelayedUpstreamError";

  constructor(input: {
    readonly message: string;
    readonly providerId?: ProviderId | string;
    readonly status?: number;
    readonly code?: ResolveErrorCode;
    readonly retryable?: boolean;
  }) {
    super({
      message: input.message,
      providerId: input.providerId,
      status: input.status,
      code:
        input.code ??
        (input.status !== undefined ? httpStatusToResolveErrorCode(input.status) : "network-error"),
      retryable:
        input.retryable ??
        (input.status !== undefined ? httpStatusIsRetryable(input.status) : true),
    });
  }
}

/* ------------------------------------------------------------------------ */
/* curl plumbing                                                            */
/* ------------------------------------------------------------------------ */

const CURL_TIMEOUT_EXIT_CODE = 28;
/** curl killed by SIGINT / SIGTERM — 128 + signal number. */
const CURL_SIGINT_EXIT_CODE = 130;
const CURL_SIGTERM_EXIT_CODE = 143;

export type CurlHttpTrailer = {
  readonly body: string;
  readonly httpCode: number | null;
  /** `%{redirect_url}` when the caller's `-w` trailer carries it — set only on
   * a response whose Location curl was configured to report, never followed.
   * Undefined when the trailer format is plain `%{http_code}`. */
  readonly redirectUrl?: string;
};

/**
 * Split curl's `-w '\n%{http_code}'` (or `'\n%{http_code}\t%{redirect_url}'`)
 * trailer into `{ body, httpCode, redirectUrl }`.
 * `httpCode` is null when curl never received an HTTP response (DNS, TCP, or
 * TLS failure) — the ani-cli 5.1.4 distinction between "no HTTP response" and
 * "HTTP NNN", so a dead route is never misread as an HTTP error. curl prints
 * `000` for that case, which is a missing status, not status zero. Only one
 * trailing line is ever cut, so a body that naturally ends in `\nNNN` keeps
 * its bytes.
 */
export function splitCurlHttpTrailer(stdout: string): CurlHttpTrailer {
  const match = /\n(\d{3})(?:\t([^\n]*))?$/.exec(stdout);
  if (!match?.[1]) return { body: stdout, httpCode: null };
  const code = Number(match[1]);
  const body = stdout.slice(0, stdout.length - match[0].length);
  const redirectUrl = match[2]?.trim() || undefined;
  return { body, httpCode: code === 0 ? null : code, redirectUrl };
}

/** The request label for error messages: origin + path, never the query —
 * `/search?keyword=…` would otherwise write the user's title query into an
 * error that lands in logs.txt. */
export function providerUrlLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

export type SpawnCurlOnce = (
  args: readonly string[],
  signal?: AbortSignal,
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

/**
 * Provider API bodies are pages/JSON in the kilobytes — a flat ceiling both as
 * `--max-filesize` (kills a declared oversize before a byte flows) and as the
 * stdout reader cap (catches chunked or misdeclared bodies curl can't see).
 */
const PROVIDER_BODY_MAX_BYTES = 8 * 1024 * 1024;

export function spawnCurlOnce(
  args: readonly string[],
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([...args], { stdout: "pipe", stderr: "pipe", signal });
  return Promise.all([
    readStreamTextCapped(proc.stdout, PROVIDER_BODY_MAX_BYTES),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).then(async ([stdout, stderr, exitCode]) => {
    if (stdout === null) {
      // Over-cap stdout: the pipe stops draining, curl dies on EPIPE or we
      // stop it — either way the request is a failed transport, never a body.
      proc.kill();
      await proc.exited.catch(() => {});
      return {
        stdout: "",
        stderr: `stdout exceeded ${PROVIDER_BODY_MAX_BYTES} bytes`,
        // 63 = CURLE_FILESIZE_EXCEEDED — the transport-kind mapper reads it as
        // an ordinary network fault, which is the honest classification.
        exitCode: exitCode === 0 ? 63 : exitCode,
      };
    }
    return { stdout, stderr, exitCode };
  });
}

export type ProviderCurlRunOptions = {
  readonly signal?: AbortSignal;
  /** origin+path label for the failure message. */
  readonly urlLabel?: string;
  /** message prefix — "hianime fetch" reads as `hianime fetch connection error`. */
  readonly label: string;
  readonly providerId?: ProviderId | string;
  readonly stage?: string;
  /** Test seam — lets a test drive curl outcomes without a real binary. */
  readonly spawnOnce?: SpawnCurlOnce;
};

/** Name the failed layer first: transport (`no HTTP response`) or HTTP status. */
export function providerCurlFailureMessage(
  stdout: string,
  stderr: string,
  exitCode: number,
  options: Pick<ProviderCurlRunOptions, "label" | "urlLabel">,
): string {
  const { httpCode } = splitCurlHttpTrailer(stdout);
  const detail = httpCode !== null ? `HTTP ${httpCode}` : "no HTTP response";
  const tail = stderr.trim();
  const where = options.urlLabel ? ` from ${options.urlLabel}` : "";
  return `${options.label} connection error (${detail}; curl exit ${exitCode})${where}${tail ? `: ${tail}` : ""}`;
}

/**
 * Run curl once, retry a lone `--max-time` timeout once (transient congestion
 * earns a second shot; every other exit fails deterministically), then throw.
 *
 * Throw shapes:
 * - caller aborted / curl signalled (130/143) → the abort reason or a
 *   `cancelled` message — never a ProviderTransportError, because a quit
 *   mid-resolve is not endpoint evidence.
 * - any other nonzero exit → {@link ProviderTransportError} whose kind rides
 *   the exit code, so a curl DNS failure classifies `offline`/`candidate-network`
 *   non-retryable instead of `candidate-unknown`.
 */
export async function runProviderCurlWithRetry(
  args: readonly string[],
  options: ProviderCurlRunOptions,
): Promise<string> {
  const spawnOnce = options.spawnOnce ?? spawnCurlOnce;
  let result = await spawnOnce(args, options.signal);
  if (result.exitCode === CURL_TIMEOUT_EXIT_CODE && options.signal?.aborted !== true) {
    result = await spawnOnce(args, options.signal);
  }
  if (result.exitCode !== 0) {
    // Quitting kunai mid-resolve kills curl, and "curl exit 130" matches
    // neither "abort" nor "cancel", so the failure classifier used to read a
    // plain Ctrl-C as an unknown network fault: retryable, worth a fallback
    // provider, and logged at ERROR. Say cancelled in the one place that knows
    // the process was signalled.
    if (options.signal?.aborted === true) {
      throw options.signal.reason ?? new Error(`${options.label} cancelled`);
    }
    if (result.exitCode === CURL_SIGINT_EXIT_CODE || result.exitCode === CURL_SIGTERM_EXIT_CODE) {
      throw new Error(`${options.label} cancelled (curl exit ${result.exitCode})`);
    }
    throw new ProviderTransportError({
      message: providerCurlFailureMessage(result.stdout, result.stderr, result.exitCode, options),
      transportKind: transportKindFromCurlExit(result.exitCode),
      providerId: options.providerId,
      stage: options.stage ?? "fetch-page",
    });
  }
  return result.stdout;
}

/* ------------------------------------------------------------------------ */
/* The transport                                                            */
/* ------------------------------------------------------------------------ */

export type ProviderFetchTextPolicy = {
  readonly context?: ProviderRuntimeContext;
  readonly signal?: AbortSignal;
  readonly providerId: ProviderId | string;
  /** Message prefix — "hianime fetch" produces `hianime fetch HTTP 404 from …`. */
  readonly label?: string;
  readonly userAgent: string;
  /** Omitted entirely when absent — some sites must see no Referer (AnimeGG). */
  readonly referer?: string;
  /** Per-request headers beyond UA/Referer (e.g. a sources XHR). */
  readonly extraHeaders?: Readonly<Record<string, string>>;
  /** Deadline for the context-port and raw-fetch legs. Default 15s. */
  readonly fetchTimeoutMs?: number;
  /** curl `--max-time`. Default 12s. */
  readonly maxTimeSec?: number;
  /** ProviderHttpError stage label. Default "fetch-page". */
  readonly stage?: string;

  /**
   * A body that means an HTTP status — e.g. anidb's 200-with-"Under
   * Maintenance" page is a real 503. Checked before challenge detection so a
   * status answer always outranks a marker match.
   */
  readonly bodyAsStatus?: (text: string) => number | null;
  /**
   * Non-OK statuses worth a second shot over curl's better TLS fingerprint.
   * Default: every status — the hianime/animekai semantics. anidb passes
   * `s => s === 403 || s === 429` because an upstream 5xx or a real 404 is the
   * upstream's answer, and re-asking only doubles the latency.
   */
  readonly retryStatusViaCurl?: (status: number) => boolean;
  /**
   * Whether a *relayed* status is the upstream's final word. Default: every
   * status. anidb narrows it (`s => s !== 404 && s !== 403 && s !== 429`) —
   * a stale relay answers unknown-provider 404s of its own, and a relayed
   * challenge-status can still clear on a local impersonate fingerprint.
   */
  readonly relayedStatusIsFinal?: (status: number) => boolean;
  /** A relayed 2xx challenge page. Default final (hianime/animekai); anidb
   * sets false so curl-impersonate can clear what the relay could not. */
  readonly relayedChallengeIsFinal?: boolean;
  /** Challenge detection. Default: Cloudflare interstitial markers. */
  readonly isChallengeBody?: (text: string) => boolean;
  /** The error a challenge throws — providers with their own blocked-error
   * type (anidb's AnidbBlockedError) pass it here. */
  readonly blockedError?: (impersonated: boolean) => Error;
  /** The error a non-OK status throws — defaults to providerHttpErrorForStatus. */
  readonly statusError?: (status: number) => Error;
  /** The error a final relayed status throws — defaults to
   * ProviderRelayedUpstreamError; anidb passes AnidbHttpStatusError since a
   * faithfully proxied status IS the upstream's answer there. */
  readonly relayedStatusError?: (status: number) => Error;
  /** PATH-discovery override seam for tests. */
  readonly curlEnvironment?: Partial<CurlEnvironment>;
  /** Curl spawn seam for tests (anidb's pattern, generalized). */
  readonly spawnCurl?: SpawnCurlOnce;
};

export async function providerFetchText(
  url: string,
  policy: ProviderFetchTextPolicy,
): Promise<string> {
  const label = policy.label ?? `${String(policy.providerId)} fetch`;
  const urlLabel = providerUrlLabel(url);
  const stage = policy.stage ?? "fetch-page";
  const signal = policy.signal ?? policy.context?.signal;
  const fetchTimeoutMs = policy.fetchTimeoutMs ?? 15_000;
  const isChallenge = policy.isChallengeBody ?? isCloudflareChallengeText;
  const statusError =
    policy.statusError ??
    ((status: number) =>
      providerHttpErrorForStatus({
        status,
        message: `${label} HTTP ${status} from ${urlLabel}`,
        providerId: policy.providerId,
        stage,
      }));
  const blockedError =
    policy.blockedError ??
    ((impersonated: boolean) =>
      new Error(
        impersonated
          ? `${String(policy.providerId)} blocked by Cloudflare (curl-impersonate was already used; retry later or from another network)`
          : `${String(policy.providerId)} blocked by Cloudflare (try curl-impersonate)`,
      ));
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- a mutable open bag is the contract: Referer and caller headers are added after this literal
  const requestHeaders: Record<string, string> = { "User-Agent": policy.userAgent };
  if (policy.referer) requestHeaders.Referer = policy.referer;
  if (policy.extraHeaders) Object.assign(requestHeaders, policy.extraHeaders);

  if (policy.context?.fetch) {
    let response: Response | undefined;
    try {
      response = await policy.context.fetch.fetch(url, {
        headers: requestHeaders,
        signal: createTimeoutSignal(signal, fetchTimeoutMs),
      });
    } catch (error) {
      // A caller abort is not a transport fact — never buy a curl request with
      // it. Everything else (DNS, reset, the 15s deadline) is worth curl's shot.
      if (signal?.aborted === true) throw error;
      /* A relay-owned throw under `fallbackToDirect: false` is the user
       * saying "never touch upstream outside the relay" — retrying it over
       * curl/raw fetch would silently bypass that boundary. */
      if (isRelayOwnedError(error)) throw error;
    }
    if (response) {
      const relayed = isRelayedResponse(response);
      if (!response.ok) {
        /* Status decisions never depend on the body being readable — a
         * relayed-final status stays final even if its body disconnects,
         * otherwise the curl fallback would silently bypass the relay. */
        if (relayed) {
          if (policy.relayedStatusIsFinal?.(response.status) ?? true) {
            throw attachRetryAfter(
              policy.relayedStatusError?.(response.status) ??
                new ProviderRelayedUpstreamError({
                  message: `${label} HTTP ${response.status} from ${urlLabel} via relay`,
                  providerId: policy.providerId,
                  status: response.status,
                }),
              response.headers,
            );
          }
          // Non-final relayed status (anidb's stale-relay 404 hedge) → curl.
        } else if (!(policy.retryStatusViaCurl?.(response.status) ?? true)) {
          throw attachRetryAfter(statusError(response.status), response.headers);
        }
        // Retryable unmarked status / non-final relayed status → curl.
      } else {
        // A mid-body disconnect is the same class of fact as a failed fetch —
        // curl/impersonate settles it — *unless* the response is relay-owned:
        // re-requesting the same URL direct is exactly what the mark forbids.
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- rejection values are untyped at this boundary
        const text = await readResponseText(response).catch((error: unknown) => {
          if (signal?.aborted === true) throw error;
          if (relayed) {
            throw new ProviderTransportError({
              message: `${label} connection error (${transportMessageDetail(error)}) from ${urlLabel} via relay`,
              transportKind: transportKindFromFetchError(error),
              providerId: policy.providerId,
              stage,
              cause: error,
            });
          }
          return undefined;
        });
        if (text !== undefined) {
          const virtual = policy.bodyAsStatus?.(text);
          if (virtual !== null && virtual !== undefined) {
            throw attachRetryAfter(statusError(virtual), response.headers);
          }
          if (!isChallenge(text)) return text;
          if (relayed) {
            if (policy.relayedChallengeIsFinal !== false) {
              throw attachRetryAfter(
                new ProviderRelayedUpstreamError({
                  message: blockedError(false).message,
                  providerId: policy.providerId,
                  status: response.status,
                  code: "blocked",
                  retryable: false,
                }),
                response.headers,
              );
            }
            // Non-final relayed challenge → the local fingerprint settles it.
          }
          // Unmarked challenge → curl's fingerprint gets its shot.
        }
        // `text === undefined` means the body read failed → curl.
      }
    }
  }

  // A dead caller buys no curl request.
  if (signal?.aborted === true) throw signal.reason ?? new Error(`${label} cancelled`);

  const curl = resolveCurlCandidate(policy.curlEnvironment);
  if (!curl) {
    // No curl — raw fetch is the last resort. It is also the only leg when no
    // context port exists at all, and a direct hedge when the port failed at
    // transport level (relay down, direct fine).
    let response: Response;
    try {
      response = await guardedTransportFetch(url, {
        headers: requestHeaders,
        signal: createTimeoutSignal(signal, fetchTimeoutMs),
      });
    } catch (error) {
      // Read through a call: the signal mutates asynchronously and TS would
      // otherwise narrow `aborted` to false after the earlier check.
      if (isAborted(signal)) throw error;
      throw new ProviderTransportError({
        message: `${label} connection error (${transportMessageDetail(error)}) from ${urlLabel}`,
        transportKind: transportKindFromFetchError(error),
        providerId: policy.providerId,
        stage,
        cause: error,
      });
    }
    // Read the body before answering with the status — Cloudflare serves its
    // challenge with a 4xx as often as a 200, and there is no curl left to
    // classify it later (anidb's no-curl ordering, adopted everywhere).
    const read = await readResponseText(response).then(
      (text) => ({ ok: true as const, text }),
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- rejection values are untyped at this boundary
      (error: unknown) => ({ ok: false as const, error }),
    );
    if (!response.ok) {
      // The status is the upstream's answer even when its body dies on the
      // wire — report the status, not the disconnect.
      const partial = read.ok ? read.text : "";
      if (isChallenge(partial)) {
        throw attachRetryAfter(blockedError(false), response.headers);
      }
      throw attachRetryAfter(statusError(response.status), response.headers);
    }
    if (!read.ok) {
      // A mid-body disconnect on a 200 is not an empty page — reporting ""
      // would surface downstream as a parse/empty-catalog failure instead of
      // the transport fault it is.
      if (isAborted(signal)) throw read.error;
      throw new ProviderTransportError({
        message: `${label} connection error (${transportMessageDetail(read.error)}) from ${urlLabel}`,
        transportKind: transportKindFromFetchError(read.error),
        providerId: policy.providerId,
        stage,
        cause: read.error,
      });
    }
    const text = read.text;
    const virtual = policy.bodyAsStatus?.(text);
    if (virtual !== null && virtual !== undefined) {
      throw attachRetryAfter(statusError(virtual), response.headers);
    }
    if (isChallenge(text)) throw attachRetryAfter(blockedError(false), response.headers);
    return text;
  }

  // curl's own redirect following stays off: `-L` would chase a Location into
  // private space, a scheme downgrade, or a non-HTTP protocol with no way for
  // this process to refuse. Each hop is re-spawned instead so every target
  // clears the same literal/DNS blocklist the fetch legs answer to — hop 0 is
  // exempt like guardedDirectFetch, because provider endpoints are code-fixed
  // or user-configured; redirect hops are the attacker-controlled part.
  let curlTarget = url;
  // Referer/extraHeaders carry provider context — possibly an API key — so a
  // cross-origin hop drops them, mirroring the fetch legs' credential strip.
  let curlReferer = policy.referer;
  let curlHeaders: Record<string, string> | undefined = policy.extraHeaders
    ? { ...policy.extraHeaders }
    : undefined;
  for (let hop = 0; ; hop++) {
    const blockedReason = await curlTargetBlockReason(curlTarget, hop === 0, signal);
    if (blockedReason !== null) {
      throw new ProviderHttpError({
        message: `${label} refused unsafe target ${providerUrlLabel(curlTarget)} (${blockedReason})`,
        providerId: policy.providerId,
        stage,
        code: "blocked",
        retryable: false,
      });
    }
    const args = [
      curl.path,
      "-s",
      "-A",
      policy.userAgent,
      ...(curlReferer ? ["-H", `Referer: ${curlReferer}`] : []),
      ...Object.entries(curlHeaders ?? {}).flatMap(([name, value]) => ["-H", `${name}: ${value}`]),
      "--max-time",
      String(policy.maxTimeSec ?? 12),
      // Declared-length oversize dies before a byte flows; chunked or
      // misdeclared bodies hit the stdout reader cap in spawnCurlOnce.
      "--max-filesize",
      String(PROVIDER_BODY_MAX_BYTES),
      ...curlCipherArgs(curl.impersonates),
      "-w",
      "\n%{http_code}\t%{redirect_url}",
      // Everything after `--` is an operand, never an option — upstream JSON
      // can hand us URLs beginning with `-` (anidb's guard, adopted everywhere).
      "--",
      curlTarget,
    ];
    const { body, httpCode, redirectUrl } = splitCurlHttpTrailer(
      await runProviderCurlWithRetry(args, {
        signal,
        urlLabel,
        label,
        providerId: policy.providerId,
        stage,
        spawnOnce: policy.spawnCurl,
      }),
    );
    if (redirectUrl && httpCode !== null && httpCode >= 300 && httpCode < 400) {
      if (hop >= MAX_PROVIDER_CURL_HOPS) {
        throw new ProviderHttpError({
          message: `${label} redirect chain exceeded ${MAX_PROVIDER_CURL_HOPS} hops`,
          providerId: policy.providerId,
          stage,
          code: "blocked",
          retryable: false,
        });
      }
      let next: URL | null = null;
      try {
        next = new URL(redirectUrl, curlTarget);
      } catch {
        next = null;
      }
      // An unparseable Location is a response, not a redirect — process it.
      if (next !== null) {
        const current = new URL(curlTarget);
        if (current.protocol === "https:" && next.protocol === "http:") {
          throw new ProviderHttpError({
            message: `${label} refused https downgrade to ${providerUrlLabel(next.href)}`,
            providerId: policy.providerId,
            stage,
            code: "blocked",
            retryable: false,
          });
        }
        if (next.origin !== current.origin) {
          curlReferer = undefined;
          curlHeaders = undefined;
        }
        curlTarget = next.href;
        continue;
      }
    }
    // Challenge detection outranks the status on a non-2xx: a CF challenge
    // served at 403/404 is a block, not the route's real answer — treating it
    // as not-found would tell callers to re-search a catalogue that never
    // answered.
    if (isChallenge(body)) throw blockedError(curl.impersonates);
    if (httpCode !== null && (httpCode < 200 || httpCode > 299)) {
      throw statusError(httpCode);
    }
    const virtual = policy.bodyAsStatus?.(body);
    if (virtual !== null && virtual !== undefined) throw statusError(virtual);
    return body;
  }
}

/** Match the fetch legs' redirect ceiling — a loop must bound the same way. */
const MAX_PROVIDER_CURL_HOPS = 4;

/**
 * The blocklist verdict for one curl hop. Hop 0 mirrors guardedDirectFetch:
 * provider endpoints are code-fixed or user-configured, so a private literal
 * or DNS answer is the caller's intent, not a redirect trick. Every later hop
 * is attacker-controlled and clears both literal and DNS checks. The scheme
 * check applies on every hop including the first — `curl file:///etc/passwd`
 * is a read primitive, not a fetch.
 */
async function curlTargetBlockReason(
  target: string,
  allowInitialPrivate: boolean,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return "unparseable target";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `scheme ${parsed.protocol}`;
  }
  if (allowInitialPrivate) return null;
  const literal = blockedLiteralTargetReason(target);
  if (literal !== null) return literal;
  if (signal?.aborted === true) return null;
  return resolvedAddressBlockReason(target, signal);
}

/** JSON variant — the parse failure is typed `parse-failed`, not a raw throw. */
export async function providerFetchJson<T = unknown>(
  url: string,
  policy: ProviderFetchTextPolicy,
): Promise<T> {
  const raw = await providerFetchText(url, policy);
  try {
    // SAFETY: providerFetchJson is the raw JSON boundary by contract — each caller
    // validates the payload shape with its own parser (per the module docblock).
    return JSON.parse(raw) as T;
  } catch (cause) {
    throw new ProviderHttpError({
      message: `${policy.label ?? `${String(policy.providerId)} fetch`} returned non-JSON from ${providerUrlLabel(url)}`,
      providerId: policy.providerId,
      stage: policy.stage ?? "fetch-json",
      code: "parse-failed",
      retryable: false,
      cause,
    });
  }
}

async function readResponseText(response: Response): Promise<string> {
  // Null is over-cap or a read error — throwing keeps the two call sites'
  // contract (a thrown read falls to curl / surfaces a transport error)
  // rather than silently handing "" to challenge/status predicates.
  const text = await readResponseTextCapped(response, PROVIDER_BODY_MAX_BYTES);
  if (text === null) {
    throw new Error(`provider response body exceeds ${PROVIDER_BODY_MAX_BYTES} bytes`);
  }
  return text;
}

/**
 * Stamp the response's `Retry-After` onto whatever error a policy produced.
 * The throw site is the only place response headers still exist, and the field
 * is the duck-typed vocabulary every downstream classifier reads — attaching
 * it post-construction covers provider `statusError`/`blockedError` overrides
 * that construct their own classes without signature churn.
 */
function attachRetryAfter<T>(error: T, headers: Headers | undefined): T {
  const retryAfterMs = parseRetryAfterHeader(headers?.get("retry-after"));
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- post-construction stamp on an untyped thrown value; the duck-type IS the boundary probe
  if (retryAfterMs === undefined || typeof error !== "object" || error === null) {
    return error;
  }
  // SAFETY: object-guarded above; the field is probed as unknown before writing.
  const record = error as { retryAfterMs?: unknown };
  if (record.retryAfterMs !== undefined) return error;
  record.retryAfterMs = retryAfterMs;
  return error;
}

/** Abort checks read through this so narrowing never eats a mid-flight abort. */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/** One line of transport evidence for the failure message — the errno beats
 * `fetch failed`, which says nothing. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- probes an untyped thrown value
function transportMessageDetail(error: unknown): string {
  const code = findErrorCode(error);
  if (code) return code;
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}
