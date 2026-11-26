import { fetchProbeTarget, isGuardedPlatformFetch, isOfflineNetworkFailure } from "@kunai/core";
import {
  isJsonString,
  ProviderHttpError,
  providerHttpErrorForStatus,
  type ProviderRuntimeContext,
} from "@kunai/types";
import type { z } from "zod";

import { readBoundedTextBody } from "../shared/bounded-text-body";
import type { StreamReachabilityFetch } from "../shared/stream-reachability";
import { combineAbortSignals, createTimeoutSignal } from "../shared/timeout-signal";
import {
  scrubStremioAddonText,
  stremioAddonDisplayLabel,
  stremioAddonHasPrivateConfiguration,
  stremioStreamUrl,
  type StremioAddonRef,
} from "./addon-url";
import {
  STREMIO_ADDON_LIMITS,
  stremioManifestSchema,
  stremioStreamResponseSchema,
  type StremioContentType,
  type StremioManifest,
} from "./protocol";

/** Wall-clock bounds for one addon request, before the caller's own deadline. */
export const STREMIO_ADDON_TIMEOUTS = {
  manifestMs: 8_000,
  streamsMs: 10_000,
} as const;

export interface AddonRequestOptions {
  readonly context: ProviderRuntimeContext;
  /** Optional additional caller cancellation; combined with `context.signal`, either aborts. */
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** Resolver seam for tests; production uses the system resolver. */
  readonly resolveAddresses?: (host: string) => Promise<readonly string[]>;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** What one addon request is for, and what a good answer looks like. */
interface AddonJsonRequest<T> extends AddonRequestOptions {
  /** The addon by host, for error messages. */
  readonly label: string;
  readonly maxBytes: number;
  /** The answer is returned only after it passes this. */
  readonly schema: z.ZodType<T>;
  /** Completes "`label` …" when the answer fails the schema. */
  readonly invalidAnswer: string;
}

/**
 * One GET to an addon, and the validated JSON it answered with.
 *
 * - **HTTPS only, on every hop.** The first URL is checked by the caller's
 *   parser; a redirect to plain HTTP is refused here before it is sent.
 * - **Public hosts only.** Literal private and loopback targets are refused,
 *   and on the real network path the DNS answers are checked and the request is
 *   pinned to the checked address.
 * - **Bounded.** The body is read up to `maxBytes` and refused past it; the
 *   request is abandoned at `timeoutMs`.
 * - **Data only.** The body is parsed as JSON and checked against
 *   `options.schema` here, so no caller ever holds an unvalidated answer.
 *
 * Error messages name the addon by `label` and never include the URL: its path
 * may hold the user's own settings or tokens.
 */
async function fetchAddonJson<T>(
  url: string,
  options: AddonJsonRequest<T>,
  defaultTimeoutMs: number,
): Promise<T> {
  const { context, label, maxBytes } = options;
  const callerSignal =
    options.signal && context.signal && options.signal !== context.signal
      ? combineAbortSignals([options.signal, context.signal])
      : (options.signal ?? context.signal);
  const signal = createTimeoutSignal(callerSignal, options.timeoutMs ?? defaultTimeoutMs);
  const port = context.fetch;
  const send: StreamReachabilityFetch = port
    ? (target, init) => port.fetch(target, init)
    : (target, init) => fetch(target, init);
  const httpsOnly: StreamReachabilityFetch = (target, init) => {
    if (!target.startsWith("https://")) {
      throw new ProviderHttpError({
        message: `${label} redirected to an address that is not HTTPS; refused`,
        code: "blocked",
        retryable: false,
      });
    }
    return send(target, init);
  };

  try {
    const outcome = await fetchProbeTarget({
      fetchImpl: httpsOnly,
      url,
      init: { method: "GET", headers: { accept: "application/json" }, signal },
      // The combined signal above owns the deadline.
      remaining: () => 1,
      parentSignal: signal,
      // A fetch port that does not say where names resolve is a test or relay
      // transport that owns its destinations; the platform fetch resolves here.
      resolveNamesFor: port
        ? (port.resolvesLocally ?? (() => false))
        : () => isGuardedPlatformFetch(fetch),
      ...(options.resolveAddresses ? { resolveAddresses: options.resolveAddresses } : null),
    });
    // A caller cancel that raced a completed fetch still wins — the response
    // body is dropped unread and the caller's own reason is what propagates.
    if (callerSignal?.aborted && outcome.kind === "response") {
      await outcome.response.body?.cancel().catch(() => undefined);
    }
    callerSignal?.throwIfAborted();
    if (outcome.kind === "blocked") {
      // The guard reports a failed lookup as a block, because it never falls
      // back to an unchecked resolver. For the user that is a network failure,
      // and on an offline machine it must read as one, not as a refusal.
      if (outcome.reason.startsWith(UNRESOLVED_HOST_REASON)) {
        throw new ProviderHttpError({
          message: `${label} could not be reached: its host name did not resolve (ENOTFOUND)`,
          code: "network-error",
          retryable: false,
        });
      }
      throw new ProviderHttpError({
        message: `${label} points at a local or private address; refused`,
        code: "blocked",
        retryable: false,
      });
    }
    if (outcome.kind === "timeout") {
      throw new ProviderHttpError({
        message: `${label} did not answer in time`,
        code: "timeout",
        retryable: true,
      });
    }

    const { response } = outcome;
    if (REDIRECT_STATUSES.has(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderHttpError({
        message: `${label} redirected too many times`,
        code: "network-error",
        retryable: false,
        status: response.status,
      });
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw providerHttpErrorForStatus({
        status: response.status,
        message: `${label} answered HTTP ${response.status}`,
      });
    }

    const declaredLength = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw responseTooLarge(label, maxBytes);
    }
    const text = await readBoundedTextBody(response.body, maxBytes);
    if (text === null) throw responseTooLarge(label, maxBytes);

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      // No `cause`: a parser message can quote the secret-bearing input.
      throw new ProviderHttpError({
        message: `${label} did not answer with JSON`,
        code: "parse-failed",
        retryable: false,
      });
    }
    const parsed = options.schema.safeParse(body);
    if (!parsed.success) {
      throw new ProviderHttpError({
        message: `${label} ${options.invalidAnswer} (${describeSchemaIssues(parsed.error)})`,
        code: "parse-failed",
        retryable: false,
      });
    }
    return parsed.data;
  } catch (error) {
    // The caller cancelled: that is their decision, not a fault of the addon —
    // surface their own abort reason rather than the transport's words.
    callerSignal?.throwIfAborted();
    if (error instanceof ProviderHttpError) throw error;
    if (signal.aborted) {
      throw new ProviderHttpError({
        message: `${label} did not answer in time`,
        code: "timeout",
        retryable: true,
      });
    }
    const detail = describeTransportError(error);
    throw new ProviderHttpError({
      message: `${label} could not be reached: ${detail}`,
      code: "network-error",
      retryable: !isOfflineNetworkFailure({ code: "network-error", message: detail }),
      // No `cause`: a transport error's message can quote the request URL,
      // which may hold the addon's token.
    });
  }
}

/** Prefix of the reason `fetchProbeTarget` gives when a host has no usable DNS answer. */
const UNRESOLVED_HOST_REASON = "No vetted DNS address";

/**
 * A fixed phrase for a transport failure — never the transport's own words,
 * whose message can quote the request URL, and the addon's path may hold a
 * token. The raw text is read locally, only to recognise an offline machine.
 */
function describeTransportError(cause: unknown): string {
  const local =
    cause instanceof Error
      ? `${"code" in cause && isJsonString(cause.code) ? `${cause.code}: ` : ""}${cause.message}`
      : "";
  return isOfflineNetworkFailure({ code: "network-error", message: local })
    ? "the host name did not resolve (ENOTFOUND)"
    : "the connection failed";
}

function responseTooLarge(label: string, maxBytes: number): ProviderHttpError {
  return new ProviderHttpError({
    message: `${label} answered with more than ${Math.round(maxBytes / 1024)} KiB; refused`,
    code: "parse-failed",
    retryable: false,
  });
}

/** Field paths and reasons only. Never the values, which may be private. */
function describeSchemaIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/**
 * The manifest as Kunai may keep and show it: every addon-supplied string
 * scrubbed of the configured URL's secret parts. A configured URL (a path
 * before `manifest.json`) may hold secrets in forms the scrubber cannot
 * recognise, so for those installs every arbitrary string — name, version,
 * description, noncanonical type words — is withheld outright and the only
 * label is `addon @ host`. Structural protocol words — the `stream` resource
 * name and the canonical `movie`/`series` types — are matched literally,
 * never treated as free text, so a token overlapping one cannot break what
 * the addon actually serves. `idPrefixes` is left as sent: it is matched,
 * not displayed.
 */
export function sanitizeStremioManifest(
  manifest: StremioManifest,
  manifestUrl: string,
): StremioManifest {
  const privateConfiguration = stremioAddonHasPrivateConfiguration(manifestUrl);
  const scrub = (text: string | null | undefined) =>
    privateConfiguration ? undefined : scrubStremioAddonText(text, manifestUrl);
  const scrubType = (type: string) =>
    type === "movie" || type === "series" ? type : (scrub(type) ?? type);
  const scrubTypes = (types: string[]) =>
    privateConfiguration
      ? types.filter((type) => type === "movie" || type === "series")
      : types.map(scrubType);
  let host = "addon";
  try {
    host = new URL(manifestUrl).host || host;
  } catch {
    // Unparseable URL: the caller's own label still names the addon.
  }
  return {
    ...manifest,
    name: scrub(manifest.name) || stremioAddonDisplayLabel({ host, manifestUrl }),
    version: scrub(manifest.version),
    description: scrub(manifest.description),
    resources: manifest.resources.map((resource) =>
      resource.name === "stream"
        ? {
            ...resource,
            types: resource.types ? scrubTypes(resource.types) : undefined,
            idPrefixes: resource.idPrefixes,
          }
        : {
            ...resource,
            name: scrub(resource.name) ?? "[redacted]",
            types: resource.types ? scrubTypes(resource.types) : undefined,
            idPrefixes: resource.idPrefixes,
          },
    ),
    types: scrubTypes(manifest.types),
  };
}

/** Fetch and validate `manifest.json`. */
export async function fetchStremioManifest(
  addon: Pick<StremioAddonRef, "manifestUrl" | "host">,
  options: AddonRequestOptions,
): Promise<StremioManifest> {
  const manifest = await fetchAddonJson(
    addon.manifestUrl,
    {
      ...options,
      label: `Addon at ${addon.host}`,
      maxBytes: STREMIO_ADDON_LIMITS.manifestBytes,
      schema: stremioManifestSchema,
      invalidAnswer: "sent a manifest that is not a valid Stremio manifest",
    },
    STREMIO_ADDON_TIMEOUTS.manifestMs,
  );
  return sanitizeStremioManifest(manifest, addon.manifestUrl);
}

export interface StremioStreamListing {
  /** Raw entries, at most {@link STREMIO_ADDON_LIMITS.streamsPerResponse}; each still unvalidated. */
  readonly entries: readonly unknown[];
  /** How many entries the addon sent beyond the ones kept. */
  readonly truncated: number;
}

/** Fetch `/stream/{type}/{id}.json` and validate its envelope. */
export async function fetchStremioStreams(
  addon: Pick<StremioAddonRef, "baseUrl" | "host">,
  type: StremioContentType,
  videoId: string,
  options: AddonRequestOptions,
): Promise<StremioStreamListing> {
  const { streams } = await fetchAddonJson(
    stremioStreamUrl(addon, type, videoId),
    {
      ...options,
      label: `Addon at ${addon.host}`,
      maxBytes: STREMIO_ADDON_LIMITS.streamResponseBytes,
      schema: stremioStreamResponseSchema,
      invalidAnswer: "sent a stream list that is not valid",
    },
    STREMIO_ADDON_TIMEOUTS.streamsMs,
  );
  return streams;
}
