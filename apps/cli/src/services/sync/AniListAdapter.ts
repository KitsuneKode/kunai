import { openExternalUrl } from "@/infra/shell/open-external-url";

import type { SyncTokenStore } from "../persistence/SyncTokenStore";
import { resolveAniListAuth, type AniListAuthResolution } from "./auth-contract";
import { createOAuthState, startLoopbackServer, type LoopbackResult } from "./oauth-loopback";
import type { TrackerOperation } from "./operations";
import { TrackerRateLimiter } from "./rate-limit";
import {
  outcomeForAbortedRequest,
  startRequestDeadline,
  type RequestDeadline,
} from "./request-deadline";
import type { SyncAdapter, SyncConnectOptions, SyncResult } from "./SyncAdapter";
import {
  connectedConnection,
  disconnectedConnection,
  needsReauthConnection,
  syncFailed,
  syncNeedsReauth,
  syncOk,
  syncRateLimited,
  type ConnectionState,
  type SyncCapabilities,
  type SyncMutationOptions,
  type SyncOutcome,
} from "./types";

/**
 * AniList reports application-level problems as a 200 with an `errors` array,
 * so a bare `res.ok` check treats a rejected write as a success. An expired or
 * revoked token surfaces here too and must become a reauth demand rather than a
 * retry, or the queue spins against a credential the server has already refused.
 */
function outcomeForGraphQlErrors(
  errors?: { message: string; status?: number }[],
): SyncOutcome | null {
  const first = errors?.[0]?.message;
  if (!first) return null;
  // AniList also reports the limit inside the GraphQL envelope. Without this it
  // reads as a generic remote error and retries on our schedule, not theirs.
  if (errors?.[0]?.status === 429) return syncRateLimited(DEFAULT_GRAPHQL_RETRY_AFTER_MS, first);
  if (/invalid token|unauthorized|not authenticated/i.test(first)) {
    return syncNeedsReauth("token-rejected");
  }
  return syncFailed("remote-error", "remote", first.slice(0, 256));
}

/** Carries the status so callers can tell "refused" from "could not ask". */
class AniListHttpError extends Error {
  constructor(readonly status: number) {
    super(`AniList API error: ${status}`);
    this.name = "AniListHttpError";
  }
}

/** A 429 is not a failure, so it travels as its own type with the wait. */
class AniListRateLimitError extends Error {
  constructor(readonly retryAfterMs: number) {
    super("AniList rate limit reached");
    this.name = "AniListRateLimitError";
  }
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

/**
 * Say what the user must configure, without echoing any value they set. Each
 * reason names one concrete missing or malformed input, because "authorization
 * failed" sends people looking at their AniList account rather than their env.
 */
function aniListAuthMessage(
  reason: Extract<AniListAuthResolution["availability"], { available: false }>["reason"],
): string {
  switch (reason) {
    case "client-id-missing":
      return "Set KUNAI_ANILIST_CLIENT_ID to your AniList application client ID.";
    case "client-id-invalid":
      return "KUNAI_ANILIST_CLIENT_ID is empty or a placeholder.";
    case "client-secret-missing":
      return "Set KUNAI_ANILIST_CLIENT_SECRET to your AniList application client secret.";
    case "client-secret-invalid":
      return "KUNAI_ANILIST_CLIENT_SECRET is empty or a placeholder.";
    case "callback-missing":
      return "Set KUNAI_ANILIST_REDIRECT_URI to the redirect URI registered on your AniList application.";
    case "callback-not-loopback":
      return "KUNAI_ANILIST_REDIRECT_URI must be a loopback address (127.0.0.1 or localhost).";
    case "callback-invalid":
      return "KUNAI_ANILIST_REDIRECT_URI must look like http://127.0.0.1:43863/callback — http, an explicit port, and the /callback path.";
  }
}

function aniListCallbackMessage(reason: Extract<LoopbackResult, { ok: false }>["reason"]): string {
  switch (reason) {
    case "timeout":
      return "Authorization timed out.";
    case "aborted":
      return "Authorization was cancelled.";
    case "denied":
      return "Authorization was declined in the browser.";
    case "state-mismatch":
      // Refused rather than reported as a transient error: a callback whose
      // state does not match did not come from the request we started.
      return "Authorization could not be verified and was refused.";
  }
}

/**
 * Progress, planning and favourites are the three writes this adapter
 * implements. Pull and rating are deliberately false: no reader or writer for
 * either exists on this branch, and declaring them would put controls in
 * settings that do nothing.
 */
const ANILIST_CAPABILITIES: SyncCapabilities = {
  episodeProgress: true,
  watchlistMembership: true,
  favoriteMembership: true,
  pullLists: false,
  rating: false,
};

const ANILIST_GRAPHQL = "https://graphql.anilist.co";
/** AniList's documented default wait when it does not send one itself. */
const DEFAULT_GRAPHQL_RETRY_AFTER_MS = 60_000;
const OAUTH_BASE = "https://anilist.co/api/v2/oauth";
const OAUTH_TIMEOUT_MS = 90_000;
type AniListFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface ViewerResponse {
  data: { Viewer: { id: number; name: string } };
  errors?: { message: string }[];
}

interface MediaListEntryResponse {
  data: { SaveMediaListEntry: { id: number } | null };
  errors?: { message: string }[];
}

interface FavouriteLookupResponse {
  data?: { Media?: { id: number; isFavourite?: boolean } | null };
  errors?: { message: string }[];
}

interface MediaEntryLookupResponse {
  data?: { Media?: { id: number; mediaListEntry?: { id: number } | null } | null };
  errors?: { message: string }[];
}

interface ToggleFavouriteResponse {
  data?: unknown;
  errors?: { message: string }[];
}

interface DeleteEntryResponse {
  data?: { DeleteMediaListEntry?: { deleted: boolean } | null };
  errors?: { message: string }[];
}

export class AniListAdapter implements SyncAdapter {
  readonly id = "anilist" as const;
  readonly displayName = "AniList";
  readonly capabilities = ANILIST_CAPABILITIES;

  private username: string | undefined;
  private userId: number | undefined;
  private accessToken: string | undefined;
  private expiresAt: string | undefined;
  private readonly limiter = new TrackerRateLimiter();
  /** Set only when AniList has actually refused the token, never on a timeout. */
  private reauthReason: string | undefined;

  constructor(
    private readonly tokenStore: SyncTokenStore,
    private readonly fetchImpl: AniListFetch = (input, init) => fetch(input, init),
    /**
     * Injected by the container so the adapter never reads `process.env`
     * itself — settings needs the same decision, and two readers drift.
     */
    private readonly auth?: AniListAuthResolution,
  ) {}

  async init(): Promise<void> {
    const tokens = await this.tokenStore.load();
    if (tokens.anilist) {
      this.accessToken = tokens.anilist.accessToken;
      this.userId = tokens.anilist.userId;
      this.expiresAt = tokens.anilist.expiresAt;
    }
  }

  async refreshIdentity(options?: SyncMutationOptions): Promise<void> {
    if (!this.accessToken) return;
    await this.refreshUsername(options);
  }

  /**
   * Fetch the viewer, and treat only a refusal as a refusal.
   *
   * This used to drop the access token on any thrown error, so a startup with
   * no network silently disconnected the account and the user had to reconnect
   * for a problem that had already gone away. A 401/403 means the credential is
   * dead; anything else means we could not ask.
   */
  private async refreshUsername(options?: SyncMutationOptions): Promise<void> {
    if (!this.accessToken) return;
    const deadline = startRequestDeadline(options?.signal ?? new AbortController().signal);
    try {
      const res = await this.gql<ViewerResponse>(
        `query { Viewer { id name } }`,
        undefined,
        deadline,
      );
      const rejection = outcomeForGraphQlErrors(res.errors);
      if (rejection?.status === "needs-reauth") {
        this.reauthReason = rejection.code;
        return;
      }
      this.username = res.data.Viewer.name;
      this.userId = res.data.Viewer.id;
      this.reauthReason = undefined;
    } catch (error) {
      if (error instanceof AniListHttpError && (error.status === 401 || error.status === 403)) {
        this.reauthReason = "token-rejected";
      }
    } finally {
      deadline.release();
    }
  }

  isConnected(): boolean {
    return this.accessToken !== undefined;
  }

  getConnection(): ConnectionState {
    if (!this.accessToken) return disconnectedConnection();
    if (this.reauthReason) return needsReauthConnection(this.reauthReason, this.username);
    return connectedConnection(this.username, this.expiresAt);
  }

  /**
   * Run the authorization-code grant against the *registered* callback.
   *
   * AniList's token endpoint requires a client secret, so Kunai asks for the
   * user's own — from the application they registered themselves. Kunai ships
   * no credentials and keeps the secret nowhere: it is read from the
   * environment at connect time and never written to the token file.
   *
   * AniList also documents an implicit grant, which would need no secret, and
   * long-registered clients do use it. This application is answered with
   * `unsupported_grant_type` for `response_type=token`, so that path is not
   * available to a newly registered client and is not implemented.
   *
   * The redirect URI is configuration, not something Kunai can invent: AniList
   * matches it against the client registration exactly. Id, secret and callback
   * must all be valid before anything is opened or bound, so a misconfiguration
   * is reported here rather than after the user has approved in a browser.
   */
  async connect({ signal }: SyncConnectOptions): Promise<SyncResult> {
    const resolution = this.auth ?? resolveAniListAuth();
    const { availability, clientId, clientSecret } = resolution;
    if (!availability.available) {
      return { ok: false, error: aniListAuthMessage(availability.reason) };
    }
    // The resolution type pairs an available result with non-null credentials,
    // but that correlation does not survive destructuring — so these stay as
    // total guards rather than non-null assertions.
    if (clientId === null) {
      return { ok: false, error: aniListAuthMessage("client-id-invalid") };
    }
    if (clientSecret === null) {
      return { ok: false, error: aniListAuthMessage("client-secret-invalid") };
    }

    const state = createOAuthState();
    const callback = startLoopbackServer({
      redirectUri: availability.redirectUri,
      expectedState: state,
      signal,
      timeoutMs: OAUTH_TIMEOUT_MS,
      serviceName: "AniList",
    });

    try {
      const authorizeUrl =
        `${OAUTH_BASE}/authorize?client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(availability.redirectUri)}` +
        `&response_type=code&state=${encodeURIComponent(state)}`;
      void openExternalUrl(authorizeUrl);

      const result = await callback.result;
      if (!result.ok) return { ok: false, error: aniListCallbackMessage(result.reason) };

      const code = result.params.get("code");
      if (!code) return { ok: false, error: "AniList returned no authorization code." };

      return await this.exchangeCode({
        code,
        clientId,
        clientSecret,
        redirectUri: availability.redirectUri,
        signal,
      });
    } finally {
      // Frees the registered port on every path, so a retry can bind it.
      callback.close();
    }
  }

  /**
   * Trade the one-time code for a token.
   *
   * The failure branch reports the HTTP status and nothing else. AniList echoes
   * the request back in its error bodies, so forwarding one would put the
   * client secret into whatever surface shows the message.
   */
  private async exchangeCode(input: {
    readonly code: string;
    readonly clientId: string;
    readonly clientSecret: string;
    readonly redirectUri: string;
    readonly signal: AbortSignal;
  }): Promise<SyncResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${OAUTH_BASE}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: input.clientId,
          client_secret: input.clientSecret,
          redirect_uri: input.redirectUri,
          code: input.code,
        }),
        signal: input.signal,
      });
    } catch {
      return { ok: false, error: "Could not reach AniList to exchange the authorization code." };
    }

    if (!response.ok) {
      const hint =
        response.status === 400 || response.status === 401
          ? " Check KUNAI_ANILIST_CLIENT_SECRET and that the redirect URI matches the one registered on your AniList application exactly."
          : "";
      return {
        ok: false,
        error: `AniList rejected the token exchange (${response.status}).${hint}`,
      };
    }

    // The response also carries a refresh token. It is deliberately dropped:
    // nothing on this branch refreshes, AniList access tokens last a year, and
    // a stored credential no code path reads is a liability, not a feature.
    const payload = (await response.json().catch(() => null)) as {
      access_token?: unknown;
      expires_in?: unknown;
    } | null;
    const accessToken = typeof payload?.access_token === "string" ? payload.access_token : null;
    if (!accessToken) return { ok: false, error: "AniList returned no access token." };

    const expiresIn = typeof payload?.expires_in === "number" ? String(payload.expires_in) : null;
    return await this.persistToken(accessToken, expiresIn);
  }

  private async persistToken(accessToken: string, expiresIn: string | null): Promise<SyncResult> {
    this.accessToken = accessToken;
    // Identity doubles as validation: a token AniList will not answer for is
    // not worth persisting, and `userId` is needed by the token record anyway.
    await this.refreshUsername();

    if (!this.userId) {
      return { ok: false, error: "Could not fetch AniList user info after authorization." };
    }

    const seconds = Number(expiresIn);
    this.expiresAt =
      Number.isFinite(seconds) && seconds > 0
        ? new Date(Date.now() + seconds * 1000).toISOString()
        : undefined;
    this.reauthReason = undefined;
    await this.tokenStore.patchAniList({
      accessToken,
      userId: this.userId,
      ...(this.expiresAt ? { expiresAt: this.expiresAt } : {}),
    });

    return { ok: true };
  }

  async disconnect(): Promise<void> {
    this.accessToken = undefined;
    this.username = undefined;
    this.userId = undefined;
    this.expiresAt = undefined;
    this.reauthReason = undefined;
    await this.tokenStore.patchAniList(undefined);
  }

  /**
   * Apply one desired-state operation.
   *
   * Every branch converges on the requested state rather than moving relative
   * to the current one, because the outbox may redeliver a row whose response
   * was lost after AniList already applied it.
   */
  async apply(operation: TrackerOperation, options: SyncMutationOptions): Promise<SyncOutcome> {
    if (operation.target.tracker !== this.id) {
      return syncFailed("tracker-target-mismatch", "mapping");
    }
    if (!this.accessToken) return syncNeedsReauth("not-connected");

    const deadline = startRequestDeadline(options.signal);
    try {
      switch (operation.kind) {
        case "progress:set":
          return await this.setProgress(operation, deadline);
        case "list-membership:set":
          return await this.setWatchlistMembership(operation, deadline);
        case "favorite-membership:set":
          return await this.setFavoriteMembership(operation, deadline);
      }
    } catch (error) {
      if (error instanceof AniListRateLimitError) return syncRateLimited(error.retryAfterMs);
      return (
        outcomeForAbortedRequest(options.signal, deadline) ??
        syncFailed("request-failed", "network", errorCode(error))
      );
    } finally {
      deadline.release();
    }
  }

  /** What the last response said about the budget, for status and diagnostics. */
  getRateLimit() {
    return this.limiter.getSnapshot();
  }

  private async setProgress(
    operation: Extract<TrackerOperation, { kind: "progress:set" }>,
    deadline: RequestDeadline,
  ): Promise<SyncOutcome> {
    const res = await this.gql<MediaListEntryResponse>(
      `mutation SaveProgress($mediaId: Int, $status: MediaListStatus, $progress: Int) {
        SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress) { id }
      }`,
      {
        mediaId: operation.target.anilistId,
        status: operation.status === "completed" ? "COMPLETED" : "CURRENT",
        progress: operation.progress,
      },
      deadline,
    );
    return outcomeForGraphQlErrors(res.errors) ?? syncOk();
  }

  /**
   * Kunai's watchlist maps onto AniList's PLANNING status. Removal deletes the
   * list entry, and an already-absent entry is success, not an error — the
   * desired state is what the user asked for and it already holds.
   */
  private async setWatchlistMembership(
    operation: Extract<TrackerOperation, { kind: "list-membership:set" }>,
    deadline: RequestDeadline,
  ): Promise<SyncOutcome> {
    const mediaId = operation.target.tracker === "anilist" ? operation.target.anilistId : 0;
    if (operation.present) {
      const res = await this.gql<MediaListEntryResponse>(
        `mutation SavePlanning($mediaId: Int, $status: MediaListStatus) {
          SaveMediaListEntry(mediaId: $mediaId, status: $status) { id }
        }`,
        { mediaId, status: "PLANNING" },
        deadline,
      );
      return outcomeForGraphQlErrors(res.errors) ?? syncOk();
    }

    const current = await this.gql<MediaEntryLookupResponse>(
      `query EntryFor($mediaId: Int) { Media(id: $mediaId) { id mediaListEntry { id } } }`,
      { mediaId },
      deadline,
    );
    const entryId = current.data?.Media?.mediaListEntry?.id;
    if (entryId === undefined) return syncOk("already-absent");

    const res = await this.gql<DeleteEntryResponse>(
      `mutation RemoveEntry($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }`,
      { id: entryId },
      deadline,
    );
    return outcomeForGraphQlErrors(res.errors) ?? syncOk();
  }

  /**
   * AniList exposes only `ToggleFavourite`, which is a relative operation — so
   * membership is read first and the toggle is sent only when the remote
   * actually differs from the desired state. Toggling blind would undo the
   * user's intent whenever a response was lost in flight.
   */
  private async setFavoriteMembership(
    operation: Extract<TrackerOperation, { kind: "favorite-membership:set" }>,
    deadline: RequestDeadline,
  ): Promise<SyncOutcome> {
    const mediaId = operation.target.tracker === "anilist" ? operation.target.anilistId : 0;
    const current = await this.gql<FavouriteLookupResponse>(
      `query FavouriteFor($mediaId: Int) { Media(id: $mediaId) { id isFavourite } }`,
      { mediaId },
      deadline,
    );
    if (current.data?.Media?.isFavourite === operation.present) {
      return syncOk("already-current");
    }

    const res = await this.gql<ToggleFavouriteResponse>(
      `mutation ToggleFavourite($animeId: Int) {
        ToggleFavourite(animeId: $animeId) { anime { nodes { id } } }
      }`,
      { animeId: mediaId },
      deadline,
    );
    return outcomeForGraphQlErrors(res.errors) ?? syncOk();
  }

  private async gql<T>(
    query: string,
    variables?: Record<string, unknown>,
    deadline?: RequestDeadline,
  ): Promise<T> {
    // Ease off before asking, not after being refused.
    if (deadline) await this.limiter.waitInline(deadline.signal);

    const res = await this.fetchImpl(ANILIST_GRAPHQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: JSON.stringify({ query, variables }),
      ...(deadline ? { signal: deadline.signal } : {}),
    });
    const budget = this.limiter.observe(res);
    if (res.status === 429) {
      throw new AniListRateLimitError(budget.retryAfterMs ?? DEFAULT_GRAPHQL_RETRY_AFTER_MS);
    }
    if (!res.ok) throw new AniListHttpError(res.status);
    return res.json() as Promise<T>;
  }
}
