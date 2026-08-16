import { TMDB_API_KEY } from "@/services/catalog/tmdb-proxy";

/**
 * Whether a tracker's authorization flow can even be started, and if not, why.
 *
 * Reasons are a closed set so settings can explain the blockage without ever
 * seeing a credential: the decision travels, the secret does not.
 */
export type AniListAuthAvailability =
  | {
      readonly available: true;
      readonly redirectUri: string;
      readonly clientIdSource: "environment" | "shipped-default";
    }
  | {
      readonly available: false;
      readonly reason:
        | "client-id-invalid"
        | "callback-missing"
        | "callback-invalid"
        | "callback-not-loopback";
    };

export type TmdbAuthAvailability =
  | {
      readonly available: true;
      readonly apiKeySource: "environment" | "shipped-fallback";
    }
  | {
      readonly available: false;
      readonly reason: "api-key-missing" | "api-key-invalid";
    };

export type SyncAuthAvailability = {
  readonly anilist: AniListAuthAvailability;
  readonly tmdb: TmdbAuthAvailability;
};

export type AniListAuthResolution =
  | {
      readonly availability: Extract<AniListAuthAvailability, { available: true }>;
      readonly clientId: string;
    }
  | {
      readonly availability: Extract<AniListAuthAvailability, { available: false }>;
      readonly clientId: null;
    };

/**
 * Kunai's own AniList application.
 *
 * A client id is not a secret — it is an application identifier, published in
 * every authorization URL the user's browser visits. AniList's implicit grant
 * needs nothing else, so Kunai ships no credential at all and there is nothing
 * here that could leak.
 *
 * The redirect URI is fixed because AniList registers exactly one per
 * application and the implicit grant ignores any `redirect_uri` sent with the
 * request. A different port cannot be substituted at runtime.
 */
export const SHIPPED_ANILIST_CLIENT_ID = "48500";
export const SHIPPED_ANILIST_REDIRECT_URI = "http://127.0.0.1:43863/callback";

export type TmdbAuthResolution =
  | {
      readonly availability: Extract<TmdbAuthAvailability, { available: true }>;
      readonly apiKey: string;
    }
  | {
      readonly availability: Extract<TmdbAuthAvailability, { available: false }>;
      readonly apiKey: null;
    };

/**
 * Values that look configured but are not. Treating these as real credentials
 * defers the failure to a remote 401, where it reads as "the tracker is broken"
 * rather than "this was never filled in".
 */
const PLACEHOLDERS = new Set([
  "changeme",
  "change-me",
  "your-client-id",
  "your-api-key",
  "your-key",
  "todo",
  "xxx",
  "none",
]);

function meaningful(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return PLACEHOLDERS.has(trimmed.toLowerCase()) ? null : trimmed;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Validate the redirect URI against what AniList will accept.
 *
 * The check is deliberately exact rather than lenient. A URI that differs from
 * the registered one in scheme, host, port or path is rejected by AniList at
 * the token exchange with no useful diagnostic, so every way of being wrong is
 * caught here where it can be named.
 */
function validateCallback(
  raw: string | undefined,
): { ok: true; redirectUri: string } | { ok: false; reason: AniListCallbackReason } {
  const value = meaningful(raw);
  if (!value) return { ok: false, reason: "callback-missing" };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "callback-invalid" };
  }

  if (url.protocol !== "http:") return { ok: false, reason: "callback-invalid" };
  if (url.username || url.password) return { ok: false, reason: "callback-invalid" };
  if (url.search || url.hash) return { ok: false, reason: "callback-invalid" };
  if (url.pathname !== "/callback") return { ok: false, reason: "callback-invalid" };
  if (!LOOPBACK_HOSTS.has(url.hostname)) return { ok: false, reason: "callback-not-loopback" };

  // `URL` drops an out-of-range port by throwing, but accepts a missing one —
  // and a missing port is how the old random-port flow expressed itself.
  const port = Number(url.port);
  if (!url.port || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, reason: "callback-invalid" };
  }

  return { ok: true, redirectUri: value };
}

type AniListCallbackReason = Extract<AniListAuthAvailability, { available: false }>["reason"];

/**
 * Decide whether AniList Connect may be offered at all.
 *
 * Usually it can: Kunai ships an application id and the loopback callback
 * registered against it, so connecting takes one approval in a browser and no
 * setup. No client secret is involved — AniList's implicit grant returns the
 * token in the redirect fragment, so there is no token endpoint to authenticate
 * against and no credential for Kunai to hold.
 *
 * Overriding the client id means pointing at a *different* application, whose
 * registered callback Kunai cannot know. So an override must bring its own
 * redirect URI rather than inheriting the shipped one, which would be rejected
 * remotely with nothing useful to say about why.
 */
export function resolveAniListAuth(env: NodeJS.ProcessEnv = process.env): AniListAuthResolution {
  const unavailable = (
    reason: Extract<AniListAuthAvailability, { available: false }>["reason"],
  ): AniListAuthResolution => ({
    availability: { available: false, reason },
    clientId: null,
  });

  const override = env.KUNAI_ANILIST_CLIENT_ID;
  if (override === undefined) {
    return {
      availability: {
        available: true,
        redirectUri: SHIPPED_ANILIST_REDIRECT_URI,
        clientIdSource: "shipped-default",
      },
      clientId: SHIPPED_ANILIST_CLIENT_ID,
    };
  }

  const clientId = meaningful(override);
  if (!clientId) return unavailable("client-id-invalid");

  const callback = validateCallback(env.KUNAI_ANILIST_REDIRECT_URI);
  if (!callback.ok) return unavailable(callback.reason);

  return {
    availability: {
      available: true,
      redirectUri: callback.redirectUri,
      clientIdSource: "environment",
    },
    clientId,
  };
}

/**
 * Decide whether TMDB Connect may be offered.
 *
 * TMDB v3 uses a public application key, so Kunai ships one and this is usually
 * available. `tmdb-proxy` owns that literal — it was duplicated in bootstrap,
 * which is how two copies drift. An explicitly empty or placeholder override
 * fails closed rather than falling back, because it means the user set out to
 * configure something and did not finish.
 */
export function resolveTmdbAuth(
  env: NodeJS.ProcessEnv = process.env,
  shippedApiKey: string | null = TMDB_API_KEY,
): TmdbAuthResolution {
  const override = env.KUNAI_TMDB_API_KEY;
  if (override !== undefined) {
    const value = meaningful(override);
    if (!value) {
      return { availability: { available: false, reason: "api-key-invalid" }, apiKey: null };
    }
    return {
      availability: { available: true, apiKeySource: "environment" },
      apiKey: value,
    };
  }

  const shipped = meaningful(shippedApiKey ?? undefined);
  if (!shipped) {
    return { availability: { available: false, reason: "api-key-missing" }, apiKey: null };
  }
  return {
    availability: { available: true, apiKeySource: "shipped-fallback" },
    apiKey: shipped,
  };
}
