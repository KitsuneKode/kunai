import { lookup } from "node:dns/promises";
import {
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
  type RequestOptions,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import { RelayValidationError } from "./forward-headers";
import type {
  RelayConnectionDiagnosticCode,
  RelayDiagnosticSink,
  RelayDnsDiagnosticCode,
  RelayTransport,
  RelayTransportDiagnostic,
} from "./types";

export interface RelayResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export type RelayAddressResolver = (hostname: string) => Promise<readonly RelayResolvedAddress[]>;

export type RelayNodeRequestOptions = RequestOptions & { servername?: string };

export type RelayNodeRequest = (
  options: RelayNodeRequestOptions,
  onResponse: (response: IncomingMessage) => void,
) => ClientRequest;

export interface PinnedRelayTransportOptions {
  readonly providerId?: string;
  readonly diagnostics?: RelayDiagnosticSink;
  readonly resolveAddresses?: RelayAddressResolver;
  readonly request?: RelayNodeRequest;
  readonly maxRequestBodyBytes: number;
  readonly maxResponseBodyBytes: number;
}

interface DiagnosticProviderContext {
  providerId?: string;
}

/**
 * Build a fetch-shaped transport whose socket always dials an address from the
 * exact DNS answer set that was validated for this request. Redirects call the
 * transport again, so each hop receives a fresh all-address validation.
 */
export function createPinnedRelayTransport(options: PinnedRelayTransportOptions): RelayTransport {
  const resolveAddresses = options.resolveAddresses ?? resolveAllAddresses;
  const request = options.request ?? dispatchNodeRequest;

  return async (input, init = {}) => {
    const url = requestUrl(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new RelayValidationError(
        "protocol-not-allowed",
        "Only HTTP(S) upstream URLs are allowed",
        400,
      );
    }

    const body = await requestBodyBytes(init.body);
    if (body.byteLength > options.maxRequestBodyBytes) {
      throw new RelayValidationError("body-too-large", "Relay request body is too large", 413);
    }

    const originalHostname = stripIpv6Brackets(url.hostname);
    const literalFamily = isIP(originalHostname);
    const diagnosticHostname = literalFamily === 0 ? originalHostname : "ip-literal";
    let answers: readonly RelayResolvedAddress[];
    try {
      if (literalFamily === 4 || literalFamily === 6) {
        answers = [{ address: originalHostname, family: literalFamily }];
      } else {
        answers = await abortable(resolveAddresses(originalHostname), init.signal);
      }
    } catch (error) {
      emitDiagnostic(options.diagnostics, {
        event: "dns-failed",
        ...diagnosticProviderContext(options.providerId),
        hostname: diagnosticHostname,
        code: dnsDiagnosticCode(error),
      });
      throw error;
    }
    if (answers.length === 0) {
      emitDiagnostic(options.diagnostics, {
        event: "dns-failed",
        ...diagnosticProviderContext(options.providerId),
        hostname: diagnosticHostname,
        code: "NO_ADDRESSES",
      });
      throw new RelayValidationError("upstream-error", "Upstream host did not resolve", 502);
    }
    if (
      answers.some(
        (answer) => isIP(answer.address) !== answer.family || !isPublicRelayAddress(answer.address),
      )
    ) {
      emitDiagnostic(options.diagnostics, {
        event: "dns-rejected",
        ...diagnosticProviderContext(options.providerId),
        hostname: diagnosticHostname,
        answerCount: answers.length,
        families: [...new Set(answers.map((answer) => answer.family))].sort(),
        code: "NON_PUBLIC_ADDRESS",
      });
      throw new RelayValidationError(
        "host-not-allowed",
        "Upstream DNS returned a non-public address",
        403,
      );
    }

    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, name) => {
      headers[name] = value;
    });
    headers.host = url.host;
    const method = init.method ?? "GET";
    for (const [index, selected] of answers.entries()) {
      const requestOptions: RelayNodeRequestOptions = {
        protocol: url.protocol,
        hostname: selected.address,
        family: selected.family,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        agent: false,
        signal: init.signal ?? undefined,
      };
      if (url.protocol === "https:" && literalFamily === 0) {
        requestOptions.servername = originalHostname;
      }

      try {
        return await sendBoundedRequest(
          request,
          requestOptions,
          body,
          options.maxResponseBodyBytes,
        );
      } catch (error) {
        if (error instanceof RelayRequestAttemptError && !error.responseStarted) {
          emitDiagnostic(options.diagnostics, {
            event: "connection-failed",
            ...diagnosticProviderContext(options.providerId),
            hostname: diagnosticHostname,
            family: selected.family,
            attempt: index + 1,
            answerCount: answers.length,
            code: connectionDiagnosticCode(error.attemptCause),
          });
        }
        if (!shouldRetryAddress(error, method, index, answers.length, init.signal)) {
          throw unwrapAttemptError(error);
        }
      }
    }

    throw new RelayValidationError("upstream-error", "Upstream host did not resolve", 502);
  };
}

export function writeRelayDiagnostic(diagnostic: RelayTransportDiagnostic): void {
  console.warn(JSON.stringify({ scope: "kunai-relay", ...diagnostic }));
}

export function isPublicRelayAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family !== 6) return false;

  const bytes = parseIpv6(address);
  if (!bytes) return false;
  if (isIpv4Mapped(bytes)) {
    return isPublicIpv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  }

  // Public provider endpoints need globally routable unicast. Starting with
  // that allow-shape keeps unspecified, loopback, ULA, link/site-local,
  // multicast, translation, and discard-only blocks out by construction.
  const firstByte = bytes[0];
  if (firstByte === undefined || (firstByte & 0xe0) !== 0x20) return false; // 2000::/3
  return !(
    (
      hasPrefix(bytes, [0x20, 0x01, 0x00], 23) || // IETF special-purpose space
      hasPrefix(bytes, [0x20, 0x01, 0x0d, 0xb8], 32) || // documentation
      hasPrefix(bytes, [0x20, 0x02], 16) || // 6to4
      hasPrefix(bytes, [0x3f, 0xff, 0x00], 20)
    ) // documentation
  );
}

async function resolveAllAddresses(hostname: string): Promise<readonly RelayResolvedAddress[]> {
  const answers = await lookup(hostname, { all: true, verbatim: true });
  return answers.flatMap(({ address, family }) =>
    family === 4 || family === 6 ? [{ address, family }] : [],
  );
}

function dispatchNodeRequest(
  options: RelayNodeRequestOptions,
  onResponse: (response: IncomingMessage) => void,
): ClientRequest {
  return options.protocol === "https:"
    ? httpsRequest(options, onResponse)
    : httpRequest(options, onResponse);
}

function sendBoundedRequest(
  dispatch: RelayNodeRequest,
  requestOptions: RelayNodeRequestOptions,
  body: Uint8Array,
  maxResponseBodyBytes: number,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let responseStarted = false;
    const settleReject = (cause: unknown): void => {
      if (settled) return;
      settled = true;
      reject(new RelayRequestAttemptError(cause, responseStarted));
    };

    let outbound: ClientRequest;
    try {
      outbound = dispatch(requestOptions, (upstream) => {
        responseStarted = true;
        const declaredLength = parseContentLength(upstream.headers["content-length"]);
        if (declaredLength !== null && declaredLength > maxResponseBodyBytes) {
          const error = responseTooLargeError();
          settleReject(error);
          upstream.destroy(error);
          outbound.destroy(error);
          return;
        }

        const chunks: Uint8Array[] = [];
        let total = 0;
        upstream.on("data", (chunk: Buffer | string) => {
          if (settled) return;
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += bytes.byteLength;
          if (total > maxResponseBodyBytes) {
            const error = responseTooLargeError();
            settleReject(error);
            upstream.destroy(error);
            outbound.destroy(error);
            return;
          }
          chunks.push(bytes);
        });
        upstream.on("aborted", () => settleReject(new Error("Upstream response was aborted")));
        upstream.on("error", settleReject);
        upstream.on("end", () => {
          if (settled) return;
          settled = true;
          const status = upstream.statusCode ?? 502;
          const responseBody = Buffer.concat(chunks);
          resolve(
            new Response(statusAllowsBody(status) ? responseBody : null, {
              status,
              statusText: upstream.statusMessage,
              headers: nodeResponseHeaders(upstream),
            }),
          );
        });
      });
    } catch (error) {
      settleReject(error);
      return;
    }

    outbound.on("error", settleReject);
    outbound.end(body.byteLength > 0 ? body : undefined);
  });
}

class RelayRequestAttemptError extends Error {
  override readonly name = "RelayRequestAttemptError";
  readonly attemptCause: Error;

  constructor(
    cause: unknown,
    readonly responseStarted: boolean,
  ) {
    const attemptCause = normalizeRelayError(cause);
    super(attemptCause.message, { cause: attemptCause });
    this.attemptCause = attemptCause;
  }
}

function shouldRetryAddress(
  cause: unknown,
  method: string,
  index: number,
  answerCount: number,
  signal: AbortSignal | null | undefined,
): boolean {
  if (!(cause instanceof RelayRequestAttemptError) || cause.responseStarted) return false;
  if (index + 1 >= answerCount || signal?.aborted) return false;
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod !== "GET" && normalizedMethod !== "HEAD") return false;
  return isRetryableConnectionError(cause.attemptCause);
}

function isRetryableConnectionError(cause: Error): boolean {
  return connectionDiagnosticCode(cause) !== "CONNECTION_FAILED";
}

function connectionDiagnosticCode(cause: Error): RelayConnectionDiagnosticCode {
  const code = "code" in cause ? String(cause.code) : "";
  switch (code) {
    case "ECONNREFUSED":
    case "ECONNRESET":
    case "EHOSTUNREACH":
    case "ENETUNREACH":
    case "ETIMEDOUT":
      return code;
    default:
      return "CONNECTION_FAILED";
  }
}

function dnsDiagnosticCode(cause: unknown): RelayDnsDiagnosticCode {
  const error = normalizeRelayError(cause);
  const code = "code" in error ? String(error.code) : "";
  switch (code) {
    case "ABORT_ERR":
    case "EAI_AGAIN":
    case "ENOTFOUND":
      return code;
    default:
      return "DNS_LOOKUP_FAILED";
  }
}

function emitDiagnostic(
  sink: RelayDiagnosticSink | undefined,
  diagnostic: RelayTransportDiagnostic,
): void {
  sink?.(diagnostic);
}

function diagnosticProviderContext(providerId: string | undefined): DiagnosticProviderContext {
  const context: DiagnosticProviderContext = {};
  if (providerId) context.providerId = providerId;
  return context;
}

function unwrapAttemptError(cause: unknown): Error {
  return cause instanceof RelayRequestAttemptError
    ? cause.attemptCause
    : normalizeRelayError(cause);
}

function normalizeRelayError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

function requestUrl(input: string | URL): URL {
  if (input instanceof Request) {
    throw new RelayValidationError(
      "bad-request",
      "Relay transport accepts only an explicit URL and request init",
      400,
    );
  }
  return new URL(input);
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(relayAbortError(signal.reason));

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      cleanup();
      reject(relayAbortError(signal.reason));
    };
    const cleanup = (): void => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        return resolve(value);
      },
      (cause: unknown) => {
        cleanup();
        return reject(cause);
      },
    );
  });
}

function relayAbortError(cause: unknown): Error {
  return Object.assign(new Error("The operation was aborted", { cause }), {
    name: "AbortError",
    code: "ABORT_ERR",
  });
}

async function requestBodyBytes(body: RequestInit["body"]): Promise<Uint8Array> {
  if (body === undefined || body === null) return new Uint8Array();
  if (body.constructor === String) return Buffer.from(String(body));
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  throw new RelayValidationError("bad-request", "Unsupported relay request body", 400);
}

function nodeResponseHeaders(response: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

function parseContentLength(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function responseTooLargeError(): RelayValidationError {
  return new RelayValidationError(
    "response-too-large",
    "Upstream metadata response is too large",
    502,
  );
}

function statusAllowsBody(status: number): boolean {
  return status !== 204 && status !== 205 && status !== 304;
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  const value = octets.reduce((result, octet) => ((result << 8) | octet) >>> 0, 0);
  return !IPV4_NON_PUBLIC_RANGES.some(([base, bits]) => inIpv4Range(value, base, bits));
}

const IPV4_NON_PUBLIC_RANGES = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc01fc400, 24],
  [0xc034c100, 24],
  [0xc0586300, 24],
  [0xc0a80000, 16],
  [0xc0af3000, 24],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4],
] as const;

function inIpv4Range(value: number, base: number, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) >>> 0 === (base & mask) >>> 0;
}

function parseIpv6(address: string): Uint8Array | null {
  if (address.includes("%")) return null;
  let normalized = address.toLowerCase();
  const dottedTail = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(normalized)?.[1];
  if (dottedTail) {
    const octets = dottedTail.split(".").map(Number);
    if (octets.some((octet) => !Number.isInteger(octet) || octet > 255)) return null;
    const [a, b, c, d] = octets;
    if (a === undefined || b === undefined || c === undefined || d === undefined) return null;
    const replacement = `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
    normalized = `${normalized.slice(0, -dottedTail.length)}${replacement}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (const [index, group] of groups.entries()) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    const value = Number.parseInt(group, 16);
    bytes[index * 2] = value >> 8;
    bytes[index * 2 + 1] = value & 0xff;
  }
  return bytes;
}

function isIpv4Mapped(bytes: Uint8Array): boolean {
  return bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
}

function hasPrefix(address: Uint8Array, prefix: readonly number[], bits: number): boolean {
  const fullBytes = Math.floor(bits / 8);
  for (let index = 0; index < fullBytes; index++) {
    if (address[index] !== prefix[index]) return false;
  }
  const remaining = bits % 8;
  if (remaining === 0) return true;
  const addressByte = address[fullBytes];
  const prefixByte = prefix[fullBytes];
  if (addressByte === undefined || prefixByte === undefined) return false;
  const mask = 0xff << (8 - remaining);
  return (addressByte & mask) === (prefixByte & mask);
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}
