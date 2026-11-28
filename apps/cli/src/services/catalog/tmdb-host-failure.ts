/** A TMDB mirror or a direct API host in the catalog walk. */
export interface TmdbHost {
  readonly base: string;
  /** Direct TMDB hosts send the API credential; mirrors must not. */
  readonly needsApiKey: boolean;
}

export type TmdbHostFailureKind =
  | "caller-abort"
  | "credential-rejected"
  | "rate-limited"
  | "definitive-upstream-4xx"
  | "host-failure";

export interface TmdbHostFailureInput {
  readonly host: TmdbHost;
  readonly status?: number;
  readonly error?: Error;
  readonly signalAborted: boolean;
  readonly contentType?: string;
}

/** How long a cold keyless-mirror walk may delay direct TMDB. */
export interface TmdbMirrorBudgetPolicy {
  readonly maxTotalMirrorWaitMs: number;
  readonly perMirrorTimeoutMs: number;
}

export const DEFAULT_TMDB_MIRROR_BUDGET: TmdbMirrorBudgetPolicy = {
  maxTotalMirrorWaitMs: 2_500,
  perMirrorTimeoutMs: 1_500,
};

const KEYLESS_HOST_FAILURE_STATUSES = new Set([401, 403, 405, 410, 451]);

function isJsonContentType(contentType: string | undefined): boolean {
  const mime = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mime === "application/json" || mime.endsWith("+json");
}

function classifyKeylessStatus(
  status: number | undefined,
  contentType: string | undefined,
): TmdbHostFailureKind {
  if (status === undefined) return "host-failure";
  if (status >= 300 && status < 400) return "host-failure";
  if (KEYLESS_HOST_FAILURE_STATUSES.has(status)) return "host-failure";
  if (status >= 400 && status < 500) {
    if ((status === 400 || status === 404) && isJsonContentType(contentType)) {
      return "definitive-upstream-4xx";
    }
    return "host-failure";
  }
  return "host-failure";
}

/**
 * What a single host's failure means for the rest of the walk.
 *
 * A keyless mirror's 401/403/405/410/451, any redirect, and any non-JSON 4xx
 * are that mirror being dead or hostile — open its breaker and try the next
 * host. Only a JSON 400 or 404 is TMDB's own answer. A keyed direct host keeps
 * credential rejection on 401 and treats other 4xx as definitive.
 */
export function classifyTmdbHostError(input: TmdbHostFailureInput): TmdbHostFailureKind {
  if (input.signalAborted) return "caller-abort";
  if (input.error?.name === "TmdbCredentialRejectedError") return "credential-rejected";
  if (input.status === 401 && input.host.needsApiKey) return "credential-rejected";
  if (input.status === 429) return "rate-limited";
  if (!input.host.needsApiKey) return classifyKeylessStatus(input.status, input.contentType);
  if (input.status !== undefined && input.status >= 400 && input.status < 500) {
    return "definitive-upstream-4xx";
  }
  return "host-failure";
}
