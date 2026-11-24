import { fetchProbeTarget, isGuardedPlatformFetch, isOfflineNetworkFailure } from "@kunai/core";
import {
  ProviderHttpError,
  providerHttpErrorForStatus,
  type ProviderRuntimeContext,
} from "@kunai/types";
import type { z } from "zod";

import { readBoundedTextBody, type StreamReachabilityFetch } from "../shared/stream-reachability";
import { createTimeoutSignal } from "../shared/timeout-signal";
import { stremioStreamUrl, type StremioAddonRef } from "./addon-url";
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
  /** Overrides `context.signal`; either one cancels the request. */
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** Resolver seam for tests; production uses the system resolver. */
  readonly resolveAddresses?: (host: string) => Promise<readonly string[]>;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * One GET to an addon, and the JSON it answered with.
 *
 * - **HTTPS only, on every hop.** The first URL is checked by the caller's
 *   parser; a redirect to plain HTTP is refused here before it is sent.
 * - **Public hosts only.** Literal private and loopback targets are refused,
 *   and on the real network path the DNS answers are checked and the request is
 *   pinned to the checked address.
 * - **Bounded.** The body is read up to `maxBytes` and refused past it; the
 *   request is abandoned at `timeoutMs`.
 * - **Data only.** The body is parsed as JSON and returned as `unknown`; the
 *   caller validates it against a schema before reading a field.
 *
 * Error messages name the addon by `label` and never include the URL: its path
 * may hold the user's own settings or tokens.
 */
async function fetchAddonJson(
  url: string,
  options: AddonRequestOptions & { readonly label: string; readonly maxBytes: number },
  defaultTimeoutMs: number,
): Promise<unknown> {
  const { context, label, maxBytes } = options;
  const callerSignal = options.signal ?? context.signal;
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

    try {
      return JSON.parse(text) as unknown;
    } catch (cause) {
      throw new ProviderHttpError({
        message: `${label} did not answer with JSON`,
        code: "parse-failed",
        retryable: false,
        cause,
      });
    }
  } catch (error) {
    if (error instanceof ProviderHttpError) throw error;
    // The caller cancelled: that is their decision, not a fault of the addon.
    if (callerSignal?.aborted) throw error;
    if (signal.aborted) {
      throw new ProviderHttpError({
        message: `${label} did not answer in time`,
        code: "timeout",
        retryable: true,
        cause: error,
      });
    }
    const detail = describeTransportError(error);
    throw new ProviderHttpError({
      message: `${label} could not be reached: ${detail}`,
      code: "network-error",
      retryable: !isOfflineNetworkFailure({ code: "network-error", message: detail }),
      cause: error,
    });
  }
}

/** Prefix of the reason `fetchProbeTarget` gives when a host has no usable DNS answer. */
const UNRESOLVED_HOST_REASON = "No vetted DNS address";

/**
 * The transport's own words, minus any URL. Offline detection reads this text
 * (`ENOTFOUND`, `EAI_AGAIN`), so it is kept; a URL in it is replaced because the
 * addon's path may hold a token.
 */
function describeTransportError(error: unknown): string {
  if (!(error instanceof Error)) return "network error";
  const code = "code" in error && typeof error.code === "string" ? `${error.code}: ` : "";
  return `${code}${error.message}`.replace(/https?:\/\/\S+/gi, "[addon address]").slice(0, 200);
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

/** Fetch and validate `manifest.json`. */
export async function fetchStremioManifest(
  addon: Pick<StremioAddonRef, "manifestUrl" | "host">,
  options: AddonRequestOptions,
): Promise<StremioManifest> {
  const label = `Addon at ${addon.host}`;
  const body = await fetchAddonJson(
    addon.manifestUrl,
    { ...options, label, maxBytes: STREMIO_ADDON_LIMITS.manifestBytes },
    STREMIO_ADDON_TIMEOUTS.manifestMs,
  );
  const parsed = stremioManifestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ProviderHttpError({
      message: `${label} sent a manifest that is not a valid Stremio manifest (${describeSchemaIssues(parsed.error)})`,
      code: "parse-failed",
      retryable: false,
    });
  }
  return parsed.data;
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
  const label = `Addon at ${addon.host}`;
  const body = await fetchAddonJson(
    stremioStreamUrl(addon, type, videoId),
    { ...options, label, maxBytes: STREMIO_ADDON_LIMITS.streamResponseBytes },
    STREMIO_ADDON_TIMEOUTS.streamsMs,
  );
  const parsed = stremioStreamResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new ProviderHttpError({
      message: `${label} sent a stream list that is not valid (${describeSchemaIssues(parsed.error)})`,
      code: "parse-failed",
      retryable: false,
    });
  }
  const all = parsed.data.streams;
  const entries = all.slice(0, STREMIO_ADDON_LIMITS.streamsPerResponse);
  return { entries, truncated: all.length - entries.length };
}
